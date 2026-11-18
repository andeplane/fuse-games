import { uint32, type SeatRecord, type Stage } from "fuse-netcode";
import {
  CAPACITY,
  CONTROL_BITS,
  LAPS,
  MAX_ROUNDS,
  MAX_WATCHERS,
  isAvatar,
  parseSettings,
  playerKey,
  players,
  trackNames,
  validMatchId,
  validName,
  type FuseDriversRoom,
} from "./rules.js";
import { config, type TruckStats } from "./sim/config.js";
import type { Phase, RaceState } from "./sim/race.js";
import { createTruck, type Truck } from "./sim/truck.js";
import { getOffroadCourse } from "./offroad/course.js";
import {
  campaignVariant,
  isCampaignIndex,
  isOffroadDriver,
} from "./offroad/campaign.js";
import { isOffroadCpuState, type OffroadCpuState } from "./offroad/cpu.js";
import { isOffroadPickups, type OffroadPickups } from "./offroad/pickups.js";
import type { OffroadMotion, OffroadUpgradeLevel } from "./offroad/motion.js";
import type { OffroadSuspension } from "./offroad/suspension.js";

/**
 * The room as snapshot fields, and back. `decode` checks every field and how the fields fit together, and builds a
 * fresh room only once all of them pass: a corrupt or hostile snapshot yields `undefined`, never part of a room.
 *
 * The race is the bulk of it, and every peer hashes it: a number that is not finite, or is `-0`, would fold on to a
 * different race elsewhere, so it is refused here rather than carried into the simulation.
 */
const STAGES: readonly Stage[] = ["lobby", "running", "between", "over"];
const PHASES: readonly Phase[] = ["countdown", "racing", "finished"];
const MAX_COORD = 100_000;
const MAX_SPEED = 100_000;
const MAX_ANGLE = 1_000;
const MAX_COUNTER = 1_000_000;

const encodeTruck = (t: Truck): unknown[] => [
  t.slot,
  [t.x, t.y, t.heading, t.speed],
  [
    t.stats.topSpeed,
    t.stats.accelTime,
    t.stats.turnRateHigh,
    t.stats.landingMul,
    t.stats.maxArmor,
    t.stats.nitros,
    t.stats.mass,
  ],
  [
    t.motion.x,
    t.motion.y,
    t.motion.heading,
    t.motion.momentum,
    t.motion.speed,
    t.motion.throttle,
    t.motion.nitros,
    t.motion.nitroTicks,
    t.motion.backwards,
    t.motion.acceleration,
    t.motion.vx,
    t.motion.vy,
  ],
  [
    t.suspension.bodyHeight,
    t.suspension.groundHeight,
    ...t.suspension.wheels.map((w) => [w.height, w.velocity, w.clearance]),
  ],
  t.contactMask,
  t.cash,
  t.cpu
    ? [
        t.cpu.current,
        t.cpu.next,
        t.cpu.pc,
        t.cpu.radius,
        t.cpu.pedal,
        t.cpu.level,
      ]
    : null,
  [t.turnDir, t.prevNitro],
  [t.nitroUntilTick, t.airborneUntilTick, t.wallTicks],
  [
    t.laps,
    t.checkpoint,
    t.progress,
    t.wrongWayTicks,
    t.finishedTick,
    t.lapsLed,
    t.nitrosUsed,
  ],
  t.dosProgress,
  t.cpuBase ?? null,
  t.upgrades
    ? [t.upgrades.topSpeed, t.upgrades.tires, t.upgrades.shocks]
    : null,
];

const encodeRace = (race: RaceState): unknown[] => [
  race.tick,
  race.phase,
  race.rngState,
  race.trackName,
  race.countdownEndTick,
  race.raceEndTick,
  race.trucks.map(encodeTruck),
  [...race.placements],
  [
    race.pickups.waitTicks,
    race.pickups.cashLevel,
    race.pickups.nitroLevel,
    race.pickups.active
      ? [race.pickups.active.kind, race.pickups.active.x, race.pickups.active.y]
      : null,
  ],
];

export function encodeRoom(room: FuseDriversRoom): unknown[] {
  return [
    [room.matchId, room.round, room.stage, room.finishTick],
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
    room.grid.map((id) => {
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
    }),
  ];
}

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
/** A number every peer hashes the same way: finite, never `-0`, and inside a sane range. */
const real = (value: unknown, limit = MAX_COORD): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  !Object.is(value, -0) &&
  Math.abs(value) <= limit;
const count = (value: unknown, most = MAX_COUNTER): value is number =>
  uint32(value) && value <= most;
const word = (v: unknown): v is number => count(v, 65535);
const grade = (v: unknown): v is OffroadUpgradeLevel => count(v, 5);
const signedWord = (v: unknown): v is number =>
  typeof v === "number" &&
  Number.isInteger(v) &&
  !Object.is(v, -0) &&
  v >= -32768 &&
  v <= 32767;

function decodeMotion(raw: unknown): OffroadMotion | undefined {
  if (!Array.isArray(raw) || raw.length !== 12) return;
  const [
    x,
    y,
    heading,
    momentum,
    speed,
    throttle,
    nitros,
    nitroTicks,
    backwards,
    acceleration,
    vx,
    vy,
  ] = raw;
  if (
    // The DOS movement words wrap at the left edge. Even a committed position
    // can lie outside the terrain grid (observed on the second course).
    !word(x) ||
    !word(y) ||
    !word(heading) ||
    !word(momentum) ||
    !word(speed) ||
    !count(throttle, 256) ||
    !count(nitros, 99) ||
    !count(nitroTicks, 20) ||
    typeof backwards !== "boolean" ||
    !word(acceleration) ||
    !signedWord(vx) ||
    !signedWord(vy)
  )
    return;
  return {
    x,
    y,
    heading,
    momentum,
    speed,
    throttle,
    nitros,
    nitroTicks,
    backwards,
    acceleration,
    vx,
    vy,
  };
}

function decodeWheel(
  raw: unknown,
): OffroadSuspension["wheels"][number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 3) return;
  const [height, velocity, clearance] = raw;
  if (!word(height) || !signedWord(velocity) || !word(clearance)) return;
  return { height, velocity, clearance };
}

function decodeSuspension(raw: unknown): OffroadSuspension | undefined {
  if (!Array.isArray(raw) || raw.length !== 6) return;
  const [bodyHeight, groundHeight] = raw;
  const [a, b, c, d] = raw.slice(2).map(decodeWheel);
  if (!word(bodyHeight) || !word(groundHeight) || !a || !b || !c || !d) return;
  return { bodyHeight, groundHeight, wheels: [a, b, c, d] };
}
const turn = (value: unknown): value is -1 | 0 | 1 =>
  value === -1 || value === 1 || (value === 0 && !Object.is(value, -0));
/** Control bits as a seat logs them: a bitmask with no unknown bit set. */
const controlBits = (value: unknown): value is number =>
  uint32(value) && (value & ~CONTROL_BITS) === 0;

function decodeSeat(raw: unknown): SeatRecord | undefined {
  if (!Array.isArray(raw) || raw.length !== 8) return;
  const [id, name, slot, avatarId, connected, role, generation, away] = raw;
  const watcher = role === "watcher";
  if (
    !playerKey(id) ||
    !validName(name) ||
    !(watcher ? slot === -1 : uint32(slot) && slot < CAPACITY) ||
    !(watcher ? avatarId === "" : isAvatar(avatarId)) ||
    typeof connected !== "boolean" ||
    (!watcher && typeof role !== "boolean") ||
    typeof away !== "boolean" ||
    (away && (connected || role === true)) ||
    // A bot follows no stream; every human seat and watcher follows one.
    (role === true ? generation !== null : !uint32(generation))
  )
    return;
  return {
    id,
    name,
    slot,
    avatarId,
    connected,
    bot: role === true,
    ...(watcher ? { watcher } : {}),
    ...(generation === null ? {} : { generation }),
    ...(away ? { away: true } : {}),
  };
}

function decodeStats(raw: unknown): TruckStats | undefined {
  if (!Array.isArray(raw) || raw.length !== 7) return;
  const [
    topSpeed,
    accelTime,
    turnRateHigh,
    landingMul,
    maxArmor,
    nitros,
    mass,
  ] = raw;
  if (
    !real(topSpeed, MAX_SPEED) ||
    topSpeed <= 0 ||
    !real(accelTime, MAX_COUNTER) ||
    accelTime <= 0 ||
    !real(turnRateHigh, MAX_ANGLE) ||
    turnRateHigh <= 0 ||
    !real(landingMul, MAX_COUNTER) ||
    landingMul <= 0 ||
    !count(maxArmor) ||
    maxArmor === 0 ||
    !count(nitros, 99) ||
    !real(mass, MAX_COUNTER) ||
    mass <= 0
  )
    return;
  return {
    topSpeed,
    accelTime,
    turnRateHigh,
    landingMul,
    maxArmor,
    nitros,
    mass,
  };
}

function decodeCpu(
  raw: unknown,
  trackName: string,
): OffroadCpuState | undefined {
  if (!Array.isArray(raw) || raw.length !== 6) return;
  const [current, next, pc, radius, pedal, level] = raw;
  const cpu = { current, next, pc, radius, pedal, level };
  return isOffroadCpuState(cpu, trackName) ? cpu : undefined;
}

function decodePickups(
  raw: unknown,
  trackName: string,
): OffroadPickups | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return;
  const [waitTicks, cashLevel, nitroLevel, item] = raw;
  if (!(item === null || (Array.isArray(item) && item.length === 3))) return;
  const state = {
    waitTicks,
    cashLevel,
    nitroLevel,
    active: item === null ? null : { kind: item[0], x: item[1], y: item[2] },
  };
  return isOffroadPickups(state, trackNames().indexOf(trackName) % 8)
    ? state
    : undefined;
}

function decodeTruck(
  raw: unknown,
  slot: number,
  slots: number,
  tick: number,
  trackName: string,
  bot: boolean | undefined,
): Truck | undefined {
  if (!Array.isArray(raw) || raw.length !== 14) return;
  const [
    itsSlot,
    pose,
    rawStats,
    rawMotion,
    rawSuspension,
    contactMask,
    cash,
    rawCpu,
    steering,
    effects,
    progression,
    dosProgress,
    cpuBase,
    rawUpgrades,
  ] = raw;
  if (
    itsSlot !== slot ||
    !Array.isArray(pose) ||
    pose.length !== 4 ||
    !Array.isArray(steering) ||
    steering.length !== 2 ||
    !Array.isArray(effects) ||
    effects.length !== 3 ||
    !Array.isArray(progression) ||
    progression.length !== 7
  )
    return;
  const [x, y, heading, speed] = pose;
  const [turnDir, prevNitro] = steering;
  const [nitroUntilTick, airborneUntilTick, wallTicks] = effects;
  const [
    laps,
    checkpoint,
    progress,
    wrongWayTicks,
    finishedTick,
    lapsLed,
    nitrosUsed,
  ] = progression;
  const stats = decodeStats(rawStats),
    motion = decodeMotion(rawMotion),
    suspension = decodeSuspension(rawSuspension);
  const cpu = decodeCpu(rawCpu, trackName);
  if (
    rawUpgrades !== null &&
    (!Array.isArray(rawUpgrades) ||
      rawUpgrades.length !== 3 ||
      !grade(rawUpgrades[0]) ||
      !grade(rawUpgrades[1]) ||
      !grade(rawUpgrades[2]) ||
      cpu ||
      bot === true)
  )
    return;
  if (
    !stats ||
    !motion ||
    !suspension ||
    !real(x) ||
    !real(y) ||
    !real(heading, MAX_ANGLE) ||
    !real(speed, MAX_SPEED) ||
    !count(contactMask, (1 << slots) - 1) ||
    (contactMask & (1 << slot)) !== 0 ||
    !count(cash, 99) ||
    !word(dosProgress) ||
    (cpuBase !== null && (!cpu || !count(cpuBase, 17))) ||
    (rawCpu !== null && (!cpu || bot === false)) ||
    !turn(turnDir) ||
    typeof prevNitro !== "boolean" ||
    !count(nitroUntilTick, tick + 20) ||
    !count(airborneUntilTick, tick + 1) ||
    !count(wallTicks, tick) ||
    !count(laps, LAPS) ||
    !count(checkpoint, getOffroadCourse(trackName).regions.length - 1) ||
    !real(progress) ||
    !count(wrongWayTicks, tick) ||
    !count(finishedTick, tick) ||
    !count(lapsLed, laps) ||
    (finishedTick !== 0) !== (laps === LAPS) ||
    !count(nitrosUsed)
  )
    return;
  return {
    ...createTruck(slot, x, y, heading, stats, motion, suspension),
    speed,
    nitros: motion.nitros,
    cash,
    dosProgress,
    ...(cpuBase !== null ? { cpuBase } : {}),
    ...(rawUpgrades !== null
      ? {
          upgrades: {
            topSpeed: rawUpgrades[0],
            tires: rawUpgrades[1],
            shocks: rawUpgrades[2],
          },
        }
      : {}),
    contactMask,
    ...(cpu ? { cpu } : {}),
    turnDir,
    prevNitro,
    nitroUntilTick,
    airborneUntilTick,
    wallTicks,
    laps,
    checkpoint,
    progress,
    wrongWayTicks,
    finishedTick,
    lapsLed,
    nitrosUsed,
  };
}

function decodeRace(
  raw: unknown,
  grid: readonly string[],
  seats: ReadonlyMap<string, SeatRecord>,
  roomTick: number,
): RaceState | undefined {
  if (!Array.isArray(raw) || raw.length !== 9 || !grid.length) return;
  const [
    tick,
    phase,
    rngState,
    trackName,
    countdownEndTick,
    raceEndTick,
    rawTrucks,
    rawPlacements,
    rawPickups,
  ] = raw;
  if (
    !count(tick, roomTick * 2) ||
    !PHASES.includes(phase as Phase) ||
    !word(rngState) ||
    typeof trackName !== "string" ||
    !trackNames().includes(trackName) ||
    countdownEndTick !== config.countdownTicks ||
    (phase === "countdown") !== tick < countdownEndTick ||
    (phase === "finished" ? raceEndTick !== tick : raceEndTick !== 0) ||
    !Array.isArray(rawTrucks) ||
    rawTrucks.length !== grid.length ||
    !Array.isArray(rawPlacements) ||
    rawPlacements.length !== grid.length
  )
    return;
  const pickups = decodePickups(rawPickups, trackName);
  if (!pickups) return;
  const trucks: Truck[] = [];
  for (const [slot, rawTruck] of rawTrucks.entries()) {
    const truck = decodeTruck(
      rawTruck,
      slot,
      grid.length,
      tick,
      trackName,
      seats.get(grid[slot]!)?.bot,
    );
    if (!truck) return;
    trucks.push(truck);
  }
  const placements: number[] = [];
  for (const place of rawPlacements) {
    if (!count(place, grid.length - 1) || placements.includes(place)) return;
    placements.push(place);
  }
  // Contact entry must agree at both ends: the next step reads last frame's
  // pair bit when deciding whether to exchange the trucks' momentum.
  for (const a of trucks) {
    for (const b of trucks.slice(a.slot + 1)) {
      if (((a.contactMask >>> b.slot) & 1) !== ((b.contactMask >>> a.slot) & 1))
        return;
    }
  }
  const winner = trucks[placements[0]!]!;
  if (
    (phase === "finished") !== winner.finishedTick > 0 ||
    trucks.some((t) => t.finishedTick !== 0 && t.finishedTick !== raceEndTick)
  )
    return;
  return {
    tick,
    phase: phase as Phase,
    rngState,
    trackName,
    countdownEndTick,
    raceEndTick,
    trucks,
    placements,
    pickups,
    missiles: [],
    mines: [],
    oils: [],
    drones: [],
    boxCooldowns: [],
    itemHeld: grid.map(() => false),
    nextId: 1,
  };
}

export function decodeRoom(
  fields: readonly unknown[],
  tick: number,
): FuseDriversRoom | undefined {
  if (fields.length !== 9 || !uint32(tick)) return;
  const [
    header,
    rawSeats,
    rawSettings,
    rawGrid,
    rawControls,
    rawRace,
    rawFinishSeats,
    campaignIndex,
    rawGarage,
  ] = fields;
  if (
    !Array.isArray(header) ||
    header.length !== 4 ||
    !Array.isArray(rawSeats) ||
    rawSeats.length > CAPACITY + MAX_WATCHERS ||
    !Array.isArray(rawGrid) ||
    rawGrid.length > CAPACITY ||
    !Array.isArray(rawGarage) ||
    rawGarage.length !== rawGrid.length ||
    !Array.isArray(rawControls) ||
    rawControls.length > CAPACITY ||
    !Array.isArray(rawFinishSeats) ||
    rawFinishSeats.length > CAPACITY
  )
    return;
  const [matchId, round, stage, finishTick] = header;
  const settings = parseSettings(rawSettings);
  if (
    !validMatchId(matchId) ||
    !uint32(round) ||
    round < 1 ||
    round > MAX_ROUNDS ||
    !STAGES.includes(stage as Stage) ||
    !uint32(finishTick) ||
    (stage === "over"
      ? finishTick < 1 || finishTick > tick
      : finishTick !== 0) ||
    !settings
  )
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

  // The grid is formed when the race starts and never reordered. While it runs no seat can be reclaimed, so every
  // driver is still seated; once it is over a driver may have left the room with its truck still on the grid.
  const grid: string[] = [];
  for (const id of rawGrid) {
    if (!playerKey(id) || grid.includes(id)) return;
    if (stage === "running" && (!seats.has(id) || seats.get(id)?.watcher))
      return;
    grid.push(id);
  }
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

  const controls: Record<string, number> = {};
  for (const raw of rawControls) {
    if (!Array.isArray(raw) || raw.length !== 2) return;
    const [id, bits] = raw;
    if (!playerKey(id) || Object.hasOwn(controls, id) || !controlBits(bits))
      return;
    controls[id] = bits;
  }
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
    if (id !== grid[index] || !isOffroadDriver(driver)) return;
    garage[id] = driver;
  }

  // A race exists exactly while one is being driven or has just been decided; the lobby holds none, and drops the
  // grid, controls and garage with it.
  const racing = stage === "running" || stage === "over";
  if (rawRace === null) {
    if (racing || grid.length || rawControls.length || campaignIndex !== -1)
      return;
    return {
      tick,
      matchId,
      round,
      stage: stage as Stage,
      seats,
      settings,
      grid,
      controls,
      garage,
      campaignIndex,
      finishSeats,
      finishTick,
    };
  }
  if (!racing || !isCampaignIndex(campaignIndex)) return;
  const race = decodeRace(rawRace, grid, seats, tick);
  // The room calls the match over exactly when the race is: the fold sets one from the other.
  if (
    !race ||
    race.trackName !== trackNames()[campaignVariant(campaignIndex)] ||
    (race.phase === "finished") !== (stage === "over")
  )
    return;
  return {
    tick,
    matchId,
    round,
    stage: stage as Stage,
    seats,
    settings,
    race,
    grid,
    controls,
    garage,
    campaignIndex,
    finishSeats,
    finishTick,
  };
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
