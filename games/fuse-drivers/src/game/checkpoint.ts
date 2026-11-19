import { uint32, type SeatRecord, type Stage } from "fuse-netcode";
import {
  CAPACITY,
  CONTROL_BITS,
  MAX_ROUNDS,
  MAX_WATCHERS,
  isAvatar,
  parseSettings,
  isSeriesLength,
  playerKey,
  players,
  trackNames,
  validMatchId,
  validName,
  type FuseDriversRoom,
} from "./rules.js";
import type { RaceState } from "./sim/race.js";
import { decodeRace, encodeRace } from "./race-checkpoint.js";
import {
  decodeRecentFinishes,
  encodeRecentFinishes,
  freezeFinishedRace,
} from "./result.js";
import {
  campaignVariant,
  createOffroadDriver,
  OFFROAD_SHOP,
  type OffroadDriver,
  isCampaignIndex,
  isOffroadDriver,
} from "./offroad/campaign.js";
import { offroadStartingLevel } from "./offroad/cpu.js";

/** Decode every field into a fresh room only when the snapshot is internally consistent. */
const isStage = (value: unknown): value is Stage =>
  value === "lobby" || value === "running" || value === "over";

export function encodeRoom(room: FuseDriversRoom): unknown[] {
  return [
    [
      room.matchId,
      room.round,
      room.stage,
      room.finishTick,
      room.seriesRace,
      room.seriesLength,
    ],
    players(room)
      .concat([...room.seats.values()].filter((seat) => seat.watcher))
      .map((seat) => [
        seat.id,
        seat.name,
        seat.slot,
        seat.avatarId,
        seat.connected,
        seat.watcher === true ? "watcher" : seat.bot,
        seat.generation ?? null,
        seat.away === true,
      ]),
    { ...room.settings },
    [...room.grid],
    Object.entries(room.controls),
    room.race ? encodeRace(room.race) : null,
    room.finishSeats.map((seat) => [
      seat.id,
      seat.name,
      seat.slot,
      seat.connected,
    ]),
    room.campaignIndex,
    (room.stage === "lobby" ? Object.keys(room.garage).sort() : room.grid).map(
      (id) => {
        const driver = room.garage[id]!;
        return [
          id,
          driver.cash,
          driver.careerEarnings,
          driver.credits,
          driver.nitros,
          driver.shocks,
          driver.tires,
          driver.acceleration,
          driver.topSpeed,
        ];
      },
    ),
    encodeRecentFinishes(room.recentFinishes),
  ];
}

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Before the first race, only purchases can change the opening allowance. */
function validOpeningWallet(driver: OffroadDriver): boolean {
  const fresh = createOffroadDriver();
  if (
    driver.careerEarnings !== 0 ||
    driver.nitros < fresh.nitros ||
    driver.credits > fresh.credits ||
    driver.cash >= 20
  )
    return false;
  let spent = 0;
  for (const key of Object.keys(
    OFFROAD_SHOP,
  ) as (keyof typeof OFFROAD_SHOP)[]) {
    spent += (driver[key] - fresh[key]) * OFFROAD_SHOP[key].cost;
  }
  return spent + driver.cash === 20 * (fresh.credits - driver.credits);
}

/** Control bits as a seat logs them: a bitmask with no unknown bit set. */
const controlBits = (value: unknown): value is number =>
  uint32(value) && (value & ~CONTROL_BITS) === 0;

function decodeSeat(raw: unknown): SeatRecord | undefined {
  if (!Array.isArray(raw) || raw.length !== 8) return;
  const [id, name, slot, avatarId, connected, role, generation, away] = raw;
  if (
    !playerKey(id) ||
    !validName(name) ||
    typeof connected !== "boolean" ||
    typeof away !== "boolean"
  )
    return;
  const identity = decodeSeatRole(slot, avatarId, role, generation);
  if (!identity || (away && (connected || identity.bot))) return;
  return {
    id,
    name,
    connected,
    ...identity,
    ...(away ? { away: true } : {}),
  };
}

function decodeSeatRole(
  slot: unknown,
  avatarId: unknown,
  role: unknown,
  generation: unknown,
) {
  if (role === "watcher")
    return slot === -1 && avatarId === "" && uint32(generation)
      ? { slot, avatarId, bot: false, watcher: true, generation }
      : undefined;
  if (!uint32(slot) || slot >= CAPACITY || !isAvatar(avatarId)) return;
  // A bot follows no stream; every human seat and watcher follows one.
  if (role === true && generation === null)
    return { slot, avatarId, bot: true };
  if (role === false && uint32(generation))
    return { slot, avatarId, bot: false, generation };
}

function validSeries(stage: Stage, race: number, length: number): boolean {
  return stage === "lobby"
    ? race === 0 && length === 0
    : race > 0 && (length === 0 || race <= length);
}

function decodeHeader(raw: unknown, tick: number) {
  if (!Array.isArray(raw) || raw.length !== 6) return;
  const [matchId, round, stage, finishTick, seriesRace, seriesLength] = raw;
  if (
    !validMatchId(matchId) ||
    !uint32(round) ||
    round < 1 ||
    round > MAX_ROUNDS ||
    !isStage(stage) ||
    !uint32(finishTick) ||
    !uint32(seriesRace) ||
    seriesRace > tick ||
    !isSeriesLength(seriesLength) ||
    !validSeries(stage, seriesRace, seriesLength)
  )
    return;
  if (stage === "over" ? finishTick < 1 || finishTick > tick : finishTick !== 0)
    return;
  return { matchId, round, stage, finishTick, seriesRace, seriesLength };
}

function decodeSeats(rawSeats: unknown) {
  if (!Array.isArray(rawSeats) || rawSeats.length > CAPACITY + MAX_WATCHERS)
    return;
  const seats = new Map<string, SeatRecord>(),
    slots = new Set<number>();
  let watchers = 0;
  for (const raw of rawSeats) {
    const seat = decodeSeat(raw);
    if (!seat || seats.has(seat.id)) return;
    if (seat.watcher) watchers++;
    else if (slots.has(seat.slot)) return;
    else slots.add(seat.slot);
    seats.set(seat.id, seat);
  }
  if (watchers > MAX_WATCHERS) return;
  return seats;
}

function decodeGrid(
  rawGrid: unknown,
  stage: Stage,
  seats: ReadonlyMap<string, SeatRecord>,
) {
  if (!Array.isArray(rawGrid) || rawGrid.length > CAPACITY) return;
  // The grid is formed when the race starts and never reordered. While it runs no seat can be reclaimed, so every
  // driver is still seated; once it is over a driver may have left the room with its truck still on the grid.
  const grid: string[] = [];
  for (const id of rawGrid) {
    if (!playerKey(id) || grid.includes(id)) return;
    if (stage === "running" && (!seats.has(id) || seats.get(id)?.watcher))
      return;
    grid.push(id);
  }
  return grid;
}

function decodeFinishSeats(
  rawFinishSeats: unknown,
  grid: readonly string[],
  stage: Stage,
) {
  if (!Array.isArray(rawFinishSeats) || rawFinishSeats.length > CAPACITY)
    return;
  const finishSeats: FuseDriversRoom["finishSeats"] = [];
  const finishSlots = new Set<number>();
  for (const [index, raw] of rawFinishSeats.entries()) {
    if (!Array.isArray(raw) || raw.length !== 4) return;
    const [id, name, slot, connected] = raw;
    if (
      id !== grid[index] ||
      !playerKey(id) ||
      !validName(name) ||
      !uint32(slot) ||
      slot >= CAPACITY ||
      finishSlots.has(slot) ||
      typeof connected !== "boolean"
    )
      return;
    finishSlots.add(slot);
    finishSeats.push({ id, name, slot, connected });
  }
  if (
    stage === "over"
      ? finishSeats.length !== grid.length
      : finishSeats.length > 0
  )
    return;
  return finishSeats;
}

function decodeControls(rawControls: unknown, stage: Stage) {
  if (
    !Array.isArray(rawControls) ||
    rawControls.length > (stage === "lobby" ? 0 : CAPACITY)
  )
    return;
  const controls: Record<string, number> = {};
  for (const raw of rawControls) {
    if (!Array.isArray(raw) || raw.length !== 2) return;
    const [id, bits] = raw;
    if (!playerKey(id) || Object.hasOwn(controls, id) || !controlBits(bits))
      return;
    controls[id] = bits;
  }
  return controls;
}

function decodeGarage(
  rawGarage: unknown,
  owners: readonly string[],
  opening: boolean,
) {
  if (!Array.isArray(rawGarage) || rawGarage.length !== owners.length) return;
  const garage: FuseDriversRoom["garage"] = {};
  for (const [index, raw] of rawGarage.entries()) {
    if (!Array.isArray(raw) || raw.length !== 9) return;
    const [
      id,
      cash,
      careerEarnings,
      credits,
      nitros,
      shocks,
      tires,
      acceleration,
      topSpeed,
    ] = raw;
    const driver = {
      cash,
      careerEarnings,
      credits,
      nitros,
      shocks,
      tires,
      acceleration,
      topSpeed,
    };
    if (
      id !== owners[index] ||
      !isOffroadDriver(driver) ||
      (opening && !validOpeningWallet(driver))
    )
      return;
    garage[id] = driver;
  }
  return garage;
}

function validatesRaceSetup(room: FuseDriversRoom, race: RaceState): boolean {
  const { campaignIndex, stage, settings, garage, grid } = room;
  // The room calls the match over exactly when the race ends.
  if (
    Boolean(race.battle) !== (settings.mode === "battle") ||
    race.trackName !== trackNames()[campaignVariant(campaignIndex)] ||
    (race.phase === "finished") !== (stage === "over")
  )
    return false;
  const botSlots = race.trucks.map((truck) => truck.cpu !== undefined);
  return race.trucks.every((truck) => {
    if (truck.cpu)
      return (
        truck.cpuBase ===
        offroadStartingLevel(
          race.trackName,
          truck.slot,
          botSlots,
          campaignIndex,
        )
      );
    // A finished truck keeps the setup it raced with while its driver shops.
    if (stage !== "running") return true;
    const driver = garage[grid[truck.slot]!]!;
    return (
      driver.topSpeed === truck.upgrades!.topSpeed &&
      driver.tires === truck.upgrades!.tires &&
      driver.shocks === truck.upgrades!.shocks
    );
  });
}

function validatesFinishReceipt(room: FuseDriversRoom): boolean {
  const latest = room.recentFinishes.at(-1);
  const current = freezeFinishedRace(room);
  return Boolean(
    latest &&
    current &&
    JSON.stringify(encodeRecentFinishes([latest])) ===
      JSON.stringify(encodeRecentFinishes([current])),
  );
}

export function decodeRoom(
  fields: readonly unknown[],
  tick: number,
): FuseDriversRoom | undefined {
  if (fields.length !== 10 || !uint32(tick)) return;
  const [
    rawHeader,
    rawSeats,
    rawSettings,
    rawGrid,
    rawControls,
    rawRace,
    rawFinishSeats,
    campaignIndex,
    rawGarage,
    rawRecentFinishes,
  ] = fields;
  const header = decodeHeader(rawHeader, tick);
  const settings = parseSettings(rawSettings);
  const recentFinishes = decodeRecentFinishes(rawRecentFinishes, tick);
  const seats = decodeSeats(rawSeats);
  if (!header || !settings || !recentFinishes || !seats) return;

  const { stage } = header;
  const grid = decodeGrid(rawGrid, stage, seats);
  const controls = decodeControls(rawControls, stage);
  if (!grid || !controls) return;
  const finishSeats = decodeFinishSeats(rawFinishSeats, grid, stage);
  const garageOwners =
    stage === "lobby"
      ? [...seats.values()]
          .filter((seat) => !seat.bot && !seat.watcher)
          .map((seat) => seat.id)
          .sort()
      : grid;
  const garage = decodeGarage(rawGarage, garageOwners, stage === "lobby");
  if (!finishSeats || !garage || typeof campaignIndex !== "number") return;

  const room: FuseDriversRoom = {
    ...header,
    tick,
    seats,
    settings,
    grid,
    controls,
    garage,
    campaignIndex,
    finishSeats,
    recentFinishes,
  };
  // A lobby has no race, grid, or controls. A running or completed room must carry its race.
  if (stage === "lobby")
    return rawRace === null && !grid.length && campaignIndex === -1
      ? room
      : undefined;
  if (!isCampaignIndex(campaignIndex)) return;
  const race = decodeRace(rawRace, grid, seats, tick);
  if (!race || !validatesRaceSetup(room, race)) return;

  room.race = race;
  return stage !== "over" || validatesFinishReceipt(room) ? room : undefined;
}

/** Canonical JSON (sorted keys, seats in slot then id order), then FNV-1a in two lanes: 16 hex characters. */
export function hashRoom(room: FuseDriversRoom): string {
  const seats = [...room.seats.values()].sort(
    (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const text = JSON.stringify({ ...room, seats }, (_key, value: unknown) =>
    plain(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : value,
  );
  let a = 0x811c9dc5,
    b = 0x9747b28c;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x01000193) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
