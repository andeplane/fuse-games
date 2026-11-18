import {
  ACTION,
  BOT,
  PRESENCE,
  SPECTATOR,
  applyManagementTick,
  isManagementEntry,
  memberId,
  uint32,
  type LifecycleHooks,
  type ManagedRoom,
  type ManagementEntry,
  type ManagementOrigin,
  type SeatRecord,
  type Stage,
  type StreamEntries,
} from "fuse-netcode";
import { CAPACITY, MAX_ROUNDS, MAX_WATCHERS, validName } from "./basics.js";
import { BASE_STATS } from "./sim/config.js";
import {
  freezeFinishedRace,
  RETAINED_FINISHES,
  type FinishedRace,
} from "./result.js";
import { NEUTRAL_INPUT, type TruckInput } from "./sim/input.js";
import { createRace, step, type RaceState } from "./sim/race.js";
import type { Track } from "./sim/track.js";
import {
  getOffroadCourse,
  isOffroadCourse,
  OFFROAD_COURSE_NAMES,
} from "./offroad/course.js";
import {
  buyOffroadUpgrade,
  campaignVariant,
  createOffroadDriver,
  firstCampaignRace,
  nextCampaignRace,
  OFFROAD_SHOP,
  payOffroadDriver,
  type OffroadDriver,
  type OffroadPurchase,
} from "./offroad/campaign.js";

export * from "./basics.js";

export const trackNames = (): readonly string[] => OFFROAD_COURSE_NAMES;
export const trackFor = (name: string): Track =>
  getOffroadCourse(isOffroadCourse(name) ? name : DEFAULT_SETTINGS.track).track;

/** The game's own entry kinds; 10-16 are the shared management ones. */
export const CONTROLS = 0;
export const PURCHASE = 1;

/**
 * Left, right, gas and nitro share one mask. Brake and both item bits retain their replay positions.
 * Each seat logs a change only when its held controls differ from its previous entry.
 */
export const LEFT = 1,
  RIGHT = 2,
  BRAKE = 4,
  NITRO = 8,
  ITEM = 16,
  ITEM_ALT = 32,
  GAS = 64;
export const CONTROL_BITS =
  LEFT | RIGHT | BRAKE | NITRO | ITEM | ITEM_ALT | GAS;

export const packControls = (input: TruckInput): number =>
  (input.gas ? GAS : 0) |
  (input.left ? LEFT : 0) |
  (input.right ? RIGHT : 0) |
  (input.brake ? BRAKE : 0) |
  (input.nitro ? NITRO : 0) |
  (input.item ? ITEM : 0) |
  (input.itemAlt ? ITEM_ALT : 0);

export const unpackControls = (bits: number): TruckInput => ({
  gas: (bits & GAS) !== 0,
  left: (bits & LEFT) !== 0,
  right: (bits & RIGHT) !== 0,
  brake: (bits & BRAKE) !== 0,
  nitro: (bits & NITRO) !== 0,
  item: (bits & ITEM) !== 0,
  itemAlt: (bits & ITEM_ALT) !== 0,
});

export type ControlsEntry = [
  seq: number,
  tick: number,
  kind: typeof CONTROLS,
  matchId: string,
  round: number,
  bits: number,
];
export type PurchaseEntry = [
  seq: number,
  tick: number,
  kind: typeof PURCHASE,
  matchId: string,
  round: number,
  finishTick: number,
  item: OffroadPurchase,
  cash: number,
  credits: number,
  quantity: number,
];
export type FuseDriversEntry =
  ManagementEntry<FuseDriversSettings> | ControlsEntry | PurchaseEntry;

export type FuseDriversEvent =
  | { type: "pickup"; id: string }
  | { type: "lap"; id: string; lap: number }
  | { type: "finish"; id: string; place: number };

export interface FuseDriversSettings {
  /** Which committed map the next race runs on. */
  track: string;
  /** One screen with phones as controllers. */
  display: boolean;
  /** Races in a series. Zero keeps the original repeating campaign. */
  races: number;
  mode: "classic" | "battle";
}
export const MAX_SERIES_RACES = 8;
export const isSeriesLength = (value: unknown): value is number =>
  uint32(value) && value <= MAX_SERIES_RACES;
export const DEFAULT_SETTINGS: FuseDriversSettings = {
  track: "offroad-4", // Sidewinder opens the DOS campaign.
  display: false,
  races: 3,
  mode: "classic",
};

export interface FuseDriversRoom extends ManagedRoom<FuseDriversSettings> {
  recentFinishes: FinishedRace[];
  /** -1 in the lobby. Each subsequent race follows the original schedule from the selected opener. */
  campaignIndex: number;
  /** Ordinal within the active series; independent of DOS course order and the receipt's round. */
  seriesRace: number;
  /** Locked at the first start; later setting changes configure the next series. Zero in the lobby. */
  seriesLength: number;
  /** Immutable snapshots keyed by the grid's member IDs. A reclaimed slot cannot inherit its wallet. */
  garage: Record<string, OffroadDriver>;
  /** Roster at the finish, retained even when a driver leaves or renames afterwards. */
  finishSeats: FinishSeat[];
  /** Log tick that decided the result; later lobby management cannot delay its confirmation. */
  finishTick: number;
  /** The log tick, which is the netcode's clock; the race keeps its own simulation tick. */
  tick: number;
  matchId: string;
  round: number;
  stage: Stage;
  /** The seeded race, or undefined in the lobby before the first start. */
  race?: RaceState;
  /** Which seat drives which truck slot, by slot index. */
  grid: string[];
  /** The controls each seat last logged, so a seat that logs nothing keeps driving as it was. */
  controls: Record<string, number>;
}

export interface FinishSeat {
  id: string;
  name: string;
  slot: number;
  connected: boolean;
}

export const isAvatar = (value: unknown): value is string =>
  ["robot", "fox", "cat", "alien", "ghost"].includes(value as string);

/** A member id safe to use as a record key: never an inherited Object property name. */
export const playerKey = (value: unknown): value is string =>
  memberId(value) && !(value in Object.prototype);

export const validMatchId = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7e]{1,64}$/.test(value);

export function seatName(raw: string): string | undefined {
  const name = Array.from(raw.replace(/\p{Cs}/gu, "").trim())
    .slice(0, 18)
    .join("")
    .trim();
  return validName(name) ? name : undefined;
}

export function parseSettings(raw: unknown): FuseDriversSettings | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
  const keys = Object.keys(raw);
  const { track, display, races, mode } = raw as Partial<FuseDriversSettings>;
  if (
    !keys.includes("track") ||
    !keys.includes("display") ||
    keys.some(
      (key) =>
        key !== "track" &&
        key !== "display" &&
        key !== "races" &&
        key !== "mode",
    )
  )
    return;
  if (typeof display !== "boolean") return;
  if (typeof track !== "string" || !isOffroadCourse(track)) return;
  const length = keys.includes("races") ? races : DEFAULT_SETTINGS.races;
  const raceMode = keys.includes("mode") ? mode : DEFAULT_SETTINGS.mode;
  if (raceMode !== "classic" && raceMode !== "battle") return;
  return isSeriesLength(length)
    ? { track, display, races: length, mode: raceMode }
    : undefined;
}

export const seriesComplete = (room: FuseDriversRoom): boolean =>
  room.stage === "over" &&
  room.seriesLength > 0 &&
  room.seriesRace >= room.seriesLength;

const payloads = {
  name: validName,
  avatar: isAvatar,
  settings: (value: unknown) => parseSettings(value) !== undefined,
  capacity: CAPACITY,
};

export function isFuseDriversEntry(raw: unknown): raw is FuseDriversEntry {
  if (isManagementEntry(raw, payloads)) {
    if (raw[2] === ACTION) return validMatchId(raw[4]);
    const at =
      raw[2] === BOT || raw[2] === SPECTATOR ? 4 : raw[2] <= PRESENCE ? 3 : -1;
    return at < 0 || playerKey((raw as unknown[])[at]);
  }
  if (
    Array.isArray(raw) &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    validMatchId(raw[3]) &&
    uint32(raw[4]) &&
    raw[4] > 0 &&
    raw[4] <= MAX_ROUNDS
  ) {
    if (raw[2] === CONTROLS)
      return (
        raw.length === 6 && uint32(raw[5]) && (raw[5] & ~CONTROL_BITS) === 0
      );
    if (raw[2] === PURCHASE) {
      const item: unknown = raw[6];
      return (
        raw.length === 10 &&
        uint32(raw[5]) &&
        raw[5] > 0 &&
        raw[5] < raw[1] &&
        typeof item === "string" &&
        Object.hasOwn(OFFROAD_SHOP, item) &&
        uint32(raw[7]) &&
        raw[7] <= 9999 &&
        uint32(raw[8]) &&
        raw[8] <= 9 &&
        uint32(raw[9]) &&
        raw[9] <= OFFROAD_SHOP[item as OffroadPurchase].cap
      );
    }
  }
  return false;
}

/** Seats in an order derived from the room alone, never from map insertion or packet arrival. */
export function players(room: FuseDriversRoom): SeatRecord[] {
  return [...room.seats.values()]
    .filter((seat) => !seat.watcher)
    .sort(
      (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

export function createRoom(
  matchId: string,
  settings: FuseDriversSettings,
): FuseDriversRoom {
  return {
    tick: 0,
    matchId,
    round: 1,
    stage: "lobby",
    recentFinishes: [],
    campaignIndex: -1,
    seriesRace: 0,
    seriesLength: 0,
    garage: {},
    seats: new Map(),
    settings: { ...DEFAULT_SETTINGS, ...settings },
    grid: [],
    controls: {},
    finishSeats: [],
    finishTick: 0,
  };
}

/** Seeds a race from the match id, so every peer lines up the same grid on the same map. */
function startRace(
  room: FuseDriversRoom,
  matchId: string,
  continuing: boolean,
): void {
  room.matchId = matchId;
  room.seriesRace = continuing ? room.seriesRace + 1 : 1;
  if (!continuing) room.seriesLength = room.settings.races;
  const grid = players(room);
  const previousOrder =
    continuing && room.race
      ? room.race.placements
          .map((slot) => room.grid[slot])
          .filter((id) => grid.some((seat) => seat.id === id))
      : [];
  const ranked = [
    ...previousOrder,
    ...grid.map((seat) => seat.id).filter((id) => !previousOrder.includes(id)),
  ];
  const gridOrder = continuing
    ? grid.map((seat) => ranked.indexOf(seat.id))
    : undefined;
  room.campaignIndex = continuing
    ? nextCampaignRace(room.campaignIndex)
    : firstCampaignRace(OFFROAD_COURSE_NAMES.indexOf(room.settings.track));
  room.garage = Object.fromEntries(
    grid.map((seat) => [
      seat.id,
      (continuing ? room.garage[seat.id] : undefined) ?? createOffroadDriver(),
    ]),
  );
  room.grid = grid.map((seat) => seat.id);
  room.controls = {};
  room.finishSeats = [];
  room.finishTick = 0;
  let seed = 0x811c9dc5;
  for (let i = 0; i < matchId.length; i++)
    seed = Math.imul(seed ^ matchId.charCodeAt(i), 0x01000193) >>> 0;
  room.race = createRace(
    trackFor(OFFROAD_COURSE_NAMES[campaignVariant(room.campaignIndex)]!),
    seed,
    grid.map(() => BASE_STATS),
    grid.map((seat) => seat.bot),
    room.campaignIndex,
    grid.map((seat) => (seat.bot ? undefined : room.garage[seat.id])),
    gridOrder,
    continuing
      ? room.race?.battle
        ? "battle"
        : "classic"
      : room.settings.mode,
  );
}

export const lifecycle: LifecycleHooks<FuseDriversRoom, FuseDriversSettings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: "robot",
  start(room, matchId) {
    room.round = 1;
    startRace(room, matchId, false);
    room.stage = "running";
  },
  rematch(room, matchId) {
    if (seriesComplete(room)) return;
    // Fuse keeps the room's racers together for the next heat. The DOS continue
    // countdown could retire a human here; credits in this room fund shop purchases.
    room.round = 1;
    startRace(room, matchId, true);
    room.stage = "running";
  },
  lobby(room, matchId) {
    room.matchId = matchId;
    room.round = 1;
    room.stage = "lobby";
    room.campaignIndex = -1;
    room.seriesRace = 0;
    room.seriesLength = 0;
    room.garage = {};
    delete room.race;
    room.grid = [];
    room.controls = {};
    room.finishSeats = [];
    room.finishTick = 0;
  },
};

/** A seat's entries for this tick, read from the stream generation that seat follows. */
function seatEntries(
  seat: SeatRecord,
  streams: ReadonlyMap<string, StreamEntries<FuseDriversEntry>>,
  tick: number,
): FuseDriversEntry[] {
  const stream = streams.get(seat.id);
  const source =
    stream?.generation === seat.generation
      ? stream
      : stream?.retired?.find((old) => old.generation === seat.generation);
  return (source?.entries ?? []).filter((entry) => entry[1] === tick);
}

function shop(
  room: FuseDriversRoom,
  streams: ReadonlyMap<string, StreamEntries<FuseDriversEntry>>,
  tick: number,
  closing?: ManagementOrigin,
): void {
  if (seriesComplete(room)) return;
  for (const seat of players(room)) {
    if (!seat.connected || seat.bot || !room.garage[seat.id]) continue;
    const purchases = seatEntries(seat, streams, tick)
      .filter((entry): entry is PurchaseEntry => entry[2] === PURCHASE)
      .sort((a, b) => a[0] - b[0]);
    for (const [
      seq,
      ,
      ,
      match,
      round,
      finish,
      item,
      cash,
      credits,
      quantity,
    ] of purchases) {
      const driver = room.garage[seat.id]!;
      if (
        (closing?.author === seat.id &&
          (seat.generation !== closing.generation || seq >= closing.seq)) ||
        match !== room.matchId ||
        round !== room.round ||
        finish !== room.finishTick ||
        driver.cash !== cash ||
        driver.credits !== credits ||
        driver[item] !== quantity
      )
        continue;
      const next = buyOffroadUpgrade(driver, item);
      if (next) room.garage = { ...room.garage, [seat.id]: next };
    }
  }
}

/**
 * One log tick: management first, then each seat's control changes, then the race steps.
 *
 * The 20 Hz log runs seven simulation steps per six ticks. The renderer uses the same schedule.
 */
export function foldTick(
  room: FuseDriversRoom,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<FuseDriversEntry>>,
): FuseDriversEvent[] {
  const tick = room.tick + 1;
  const events: FuseDriversEvent[] = [];
  const generations = new Map(
    [...room.seats.values()].map((seat) => [seat.id, seat.generation]),
  );
  const hooks =
    room.stage === "over"
      ? {
          ...lifecycle,
          rematch(r: FuseDriversRoom, id: string, origin?: ManagementOrigin) {
            // The host's own earlier buys precede NEXT. Other active drivers have
            // until this closing tick; all still have to quote the closing finish.
            shop(r, streams, tick, origin);
            lifecycle.rematch(r, id);
          },
        }
      : lifecycle;
  applyManagementTick(room, tick, creatorId, streams, hooks);

  // Held input belongs to the page generation that logged it. Admission of a new
  // page must release the previous page even when no disconnect was received.
  for (const id of Object.keys(room.controls)) {
    const seat = room.seats.get(id);
    if (!seat || seat.watcher || generations.get(id) !== seat.generation)
      room.controls[id] = 0;
  }

  const race = room.race;
  // The mode is a series rule: only a lobby can change it, including in a tick
  // that contains both the selection and START.
  if (race) {
    const mode = race.battle ? "battle" : "classic";
    if (room.settings.mode !== mode) room.settings = { ...room.settings, mode };
  }
  if (room.stage === "over") shop(room, streams, tick);
  if (race && room.stage === "running") {
    const grid = players(room);
    const pressed = new Set<string>();
    for (const seat of grid) {
      if (seat.bot) continue;
      for (const entry of seatEntries(seat, streams, tick))
        if (
          entry[2] === CONTROLS &&
          entry[3] === room.matchId &&
          entry[4] === room.round
        ) {
          if (
            seat.connected &&
            entry[5] & ITEM &&
            !((room.controls[seat.id] ?? 0) & ITEM)
          )
            pressed.add(seat.id);
          room.controls[seat.id] = entry[5];
        }
      if (!seat.connected) room.controls[seat.id] = 0;
    }
    const inputs: TruckInput[] = room.grid.map((id) => {
      const seat = room.seats.get(id);
      if (!seat || !seat.bot) return unpackControls(room.controls[id] ?? 0);
      return NEUTRAL_INPUT;
    });
    const botSlots = room.grid.map((id) => room.seats.get(id)?.bot === true);
    const itemPresses = pressed.size
      ? room.grid.map((id) => pressed.has(id))
      : undefined;
    const track = trackFor(race.trackName);
    let next = race;
    for (let s = 0; s < stepsForTick(tick); s++) {
      const result = step(
        next,
        inputs,
        track,
        botSlots,
        s === 0 ? itemPresses : undefined,
      );
      next = result.state;
      for (const event of result.events) {
        const id = "slot" in event ? (room.grid[event.slot] ?? "") : "";
        if (event.type === "lap")
          events.push({ type: "lap", id, lap: event.lap });
        else if (event.type === "finish")
          events.push({ type: "finish", id, place: event.place });
        else if (event.type === "pickup") events.push({ type: "pickup", id });
      }
    }
    room.race = next;
    if (next.phase === "finished") {
      const garage = { ...room.garage };
      for (const [place, slot] of next.placements.entries()) {
        const id = room.grid[slot]!,
          truck = next.trucks[slot]!;
        if (room.seats.get(id)?.bot === false)
          garage[id] = payOffroadDriver(
            garage[id]!,
            place + 1,
            truck.cash,
            truck.motion.nitros,
          );
      }
      room.garage = garage;
      room.finishTick = tick;
      room.finishSeats = room.grid.flatMap((id) => {
        const seat = room.seats.get(id);
        return seat
          ? [
              {
                id,
                name: seat.name,
                slot: seat.slot,
                connected: seat.connected,
              },
            ]
          : [];
      });
      room.stage = "over";
      const finish = freezeFinishedRace(room);
      if (finish)
        room.recentFinishes = [
          ...room.recentFinishes.slice(1 - RETAINED_FINISHES),
          finish,
        ];
    }
  }

  room.tick = tick;
  return events;
}

/** The VGA game advances once per three retraces, approximately 70/3 updates per second. */
export const stepsForTick = (tick: number): number => (tick % 6 === 0 ? 2 : 1);
