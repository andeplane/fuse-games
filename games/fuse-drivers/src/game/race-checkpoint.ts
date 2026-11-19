import { uint32, type SeatRecord } from "fuse-netcode";
import { LAPS, trackNames } from "./rules.js";
import { config, type TruckStats } from "./sim/config.js";
import type { Phase, RaceState } from "./sim/race.js";
import { decodeBattle, encodeBattle } from "./sim/battle.js";
import { createTruck, type Truck } from "./sim/truck.js";
import { getOffroadCourse } from "./offroad/course.js";
import { isOffroadCpuState, type OffroadCpuState } from "./offroad/cpu.js";
import { isOffroadPickups, type OffroadPickups } from "./offroad/pickups.js";
import type { OffroadMotion, OffroadUpgradeLevel } from "./offroad/motion.js";
import type { OffroadSuspension } from "./offroad/suspension.js";

const isRacePhase = (value: unknown): value is Phase =>
  value === "countdown" || value === "racing" || value === "finished";
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

export const encodeRace = (race: RaceState): unknown[] => [
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
  [...race.paceOrder],
  ...(race.battle ? [encodeBattle(race.battle)] : []),
];

/** A number every peer hashes the same way: finite, never `-0`, and inside a sane range. */
const real = (value: unknown, limit = MAX_COORD): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  !Object.is(value, -0) &&
  Math.abs(value) <= limit;
const count = (value: unknown, most = MAX_COUNTER): value is number =>
  uint32(value) && value <= most;
const isTuple = (value: unknown, length: number): value is readonly unknown[] =>
  Array.isArray(value) && value.length === length;
const word = (v: unknown): v is number => count(v, 65535);
const grade = (v: unknown): v is OffroadUpgradeLevel => count(v, 5);
const signedWord = (v: unknown): v is number =>
  typeof v === "number" &&
  Number.isInteger(v) &&
  !Object.is(v, -0) &&
  v >= -32768 &&
  v <= 32767;

function decodeMotion(raw: unknown): OffroadMotion | undefined {
  if (!isTuple(raw, 12)) return;
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
  if (!isTuple(raw, 3)) return;
  const [height, velocity, clearance] = raw;
  if (!word(height) || !signedWord(velocity) || !word(clearance)) return;
  return { height, velocity, clearance };
}

function decodeSuspension(raw: unknown): OffroadSuspension | undefined {
  if (!isTuple(raw, 6)) return;
  const [bodyHeight, groundHeight] = raw;
  const [a, b, c, d] = raw.slice(2).map(decodeWheel);
  if (!word(bodyHeight) || !word(groundHeight) || !a || !b || !c || !d) return;
  return { bodyHeight, groundHeight, wheels: [a, b, c, d] };
}
const turn = (value: unknown): value is -1 | 0 | 1 =>
  value === -1 || value === 1 || (value === 0 && !Object.is(value, -0));

const positiveReal = (value: unknown, limit: number): value is number =>
  real(value, limit) && value > 0;

function decodeStats(raw: unknown): TruckStats | undefined {
  if (!isTuple(raw, 7)) return;
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
    !positiveReal(topSpeed, MAX_SPEED) ||
    !positiveReal(accelTime, MAX_COUNTER) ||
    !positiveReal(turnRateHigh, MAX_ANGLE) ||
    !positiveReal(landingMul, MAX_COUNTER) ||
    !count(maxArmor) ||
    maxArmor === 0 ||
    !count(nitros, 99) ||
    !positiveReal(mass, MAX_COUNTER)
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
  if (!isTuple(raw, 6)) return;
  const [current, next, pc, radius, pedal, level] = raw;
  const cpu = { current, next, pc, radius, pedal, level };
  return isOffroadCpuState(cpu, trackName) ? cpu : undefined;
}

function decodePickups(
  raw: unknown,
  trackName: string,
): OffroadPickups | undefined {
  if (!isTuple(raw, 4)) return;
  const [waitTicks, cashLevel, nitroLevel, item] = raw;
  if (item !== null && !isTuple(item, 3)) return;
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

function decodeDriverSetup(
  rawCpu: unknown,
  cpuBase: unknown,
  rawUpgrades: unknown,
  trackName: string,
  bot: boolean | undefined,
): Pick<Truck, "cpu" | "cpuBase" | "upgrades"> | undefined {
  if (rawCpu !== null) {
    const cpu = decodeCpu(rawCpu, trackName);
    if (bot === false || !cpu || !count(cpuBase, 17) || rawUpgrades !== null)
      return;
    return { cpu, cpuBase };
  }
  if (bot === true || cpuBase !== null || !isTuple(rawUpgrades, 3)) return;
  const [topSpeed, tires, shocks] = rawUpgrades;
  if (!grade(topSpeed) || !grade(tires) || !grade(shocks)) return;
  return { upgrades: { topSpeed, tires, shocks } };
}

function decodePose(raw: unknown) {
  if (!isTuple(raw, 4)) return;
  const [x, y, heading, speed] = raw;
  if (
    !real(x) ||
    !real(y) ||
    !real(heading, MAX_ANGLE) ||
    !real(speed, MAX_SPEED)
  )
    return;
  return { x, y, heading, speed };
}

function decodeSteering(raw: unknown) {
  if (!isTuple(raw, 2)) return;
  const [turnDir, prevNitro] = raw;
  if (!turn(turnDir) || typeof prevNitro !== "boolean") return;
  return { turnDir, prevNitro };
}

function decodeEffects(raw: unknown, tick: number) {
  if (!isTuple(raw, 3)) return;
  const [nitroUntilTick, airborneUntilTick, wallTicks] = raw;
  if (
    !count(nitroUntilTick, tick + 20) ||
    !count(airborneUntilTick, tick + 1) ||
    !count(wallTicks, tick)
  )
    return;
  return { nitroUntilTick, airborneUntilTick, wallTicks };
}

function decodeProgress(raw: unknown, tick: number, trackName: string) {
  if (!isTuple(raw, 7)) return;
  const [
    laps,
    checkpoint,
    progress,
    wrongWayTicks,
    finishedTick,
    lapsLed,
    nitrosUsed,
  ] = raw;
  if (
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
    laps,
    checkpoint,
    progress,
    wrongWayTicks,
    finishedTick,
    lapsLed,
    nitrosUsed,
  };
}

function decodeTruck(
  raw: unknown,
  {
    slot,
    slots,
    tick,
    trackName,
    bot,
  }: {
    slot: number;
    slots: number;
    tick: number;
    trackName: string;
    bot: boolean | undefined;
  },
): Truck | undefined {
  if (!isTuple(raw, 14)) return;
  const [
    itsSlot,
    rawPose,
    rawStats,
    rawMotion,
    rawSuspension,
    contactMask,
    cash,
    rawCpu,
    rawSteering,
    rawEffects,
    rawProgress,
    dosProgress,
    cpuBase,
    rawUpgrades,
  ] = raw;
  if (itsSlot !== slot) return;
  const pose = decodePose(rawPose);
  const steering = decodeSteering(rawSteering);
  const effects = decodeEffects(rawEffects, tick);
  const progress = decodeProgress(rawProgress, tick, trackName);
  if (!pose || !steering || !effects || !progress) return;
  const stats = decodeStats(rawStats),
    motion = decodeMotion(rawMotion),
    suspension = decodeSuspension(rawSuspension);
  const setup = decodeDriverSetup(rawCpu, cpuBase, rawUpgrades, trackName, bot);
  if (
    !stats ||
    !motion ||
    !suspension ||
    !setup ||
    !count(contactMask, (1 << slots) - 1) ||
    (contactMask & (1 << slot)) !== 0 ||
    !count(cash, 99) ||
    !word(dosProgress)
  )
    return;
  return {
    ...createTruck(
      slot,
      pose.x,
      pose.y,
      pose.heading,
      stats,
      motion,
      suspension,
    ),
    speed: pose.speed,
    nitros: motion.nitros,
    cash,
    dosProgress,
    ...setup,
    contactMask,
    ...steering,
    ...effects,
    ...progress,
  };
}

/** Both the published order and Ivan's retained tie order rank each slot exactly once. */
function decodeOrder(raw: unknown, slots: number): number[] | undefined {
  if (!isTuple(raw, slots)) return;
  const order: number[] = [];
  for (const place of raw) {
    if (!count(place, slots - 1) || order.includes(place)) return;
    order.push(place);
  }
  return order;
}

function decodeRaceHeader(raw: readonly unknown[], roomTick: number) {
  const [tick, phase, rngState, trackName, countdownEndTick, raceEndTick] = raw;
  if (
    !count(tick, roomTick * 2) ||
    !isRacePhase(phase) ||
    !word(rngState) ||
    typeof trackName !== "string" ||
    !trackNames().includes(trackName) ||
    countdownEndTick !== config.countdownTicks ||
    (phase === "countdown") !== tick < countdownEndTick ||
    typeof raceEndTick !== "number" ||
    raceEndTick !== (phase === "finished" ? tick : 0)
  )
    return;
  return {
    tick,
    phase,
    rngState,
    trackName,
    countdownEndTick,
    raceEndTick,
  };
}

export function decodeRace(
  raw: unknown,
  grid: readonly string[],
  seats: ReadonlyMap<string, SeatRecord>,
  roomTick: number,
): RaceState | undefined {
  if (
    !Array.isArray(raw) ||
    (raw.length !== 10 && raw.length !== 11) ||
    !grid.length
  )
    return;
  const header = decodeRaceHeader(raw, roomTick);
  const [, , , , , , rawTrucks, rawPlacements, rawPickups, rawPaceOrder] = raw;
  if (!header || !isTuple(rawTrucks, grid.length)) return;
  const { tick, phase, trackName, raceEndTick } = header;
  const pickups = decodePickups(rawPickups, trackName);
  if (!pickups) return;
  const battle =
    raw.length === 11
      ? decodeBattle(raw[10], trackName, grid.length, tick)
      : undefined;
  if (raw.length === 11 && !battle) return;
  const trucks: Truck[] = [];
  for (const [slot, rawTruck] of rawTrucks.entries()) {
    const truck = decodeTruck(rawTruck, {
      slot,
      slots: grid.length,
      tick,
      trackName,
      bot: seats.get(grid[slot]!)?.bot,
    });
    if (!truck) return;
    trucks.push(truck);
  }
  const placements = decodeOrder(rawPlacements, grid.length);
  const paceOrder = decodeOrder(rawPaceOrder, grid.length);
  if (!placements || !paceOrder) return;
  if (!symmetricContacts(trucks)) return;
  const winner = trucks[placements[0]!]!;
  if (
    (phase === "finished") !== winner.finishedTick > 0 ||
    trucks.some((t) => t.finishedTick !== 0 && t.finishedTick !== raceEndTick)
  )
    return;
  return {
    ...header,
    trucks,
    placements,
    paceOrder,
    pickups,
    ...(battle ? { battle } : {}),
  };
}

/** Each pair's old contact bit must agree before either truck can exchange momentum next step. */
function symmetricContacts(trucks: readonly Truck[]): boolean {
  for (const a of trucks)
    for (const b of trucks.slice(a.slot + 1))
      if (((a.contactMask >>> b.slot) & 1) !== ((b.contactMask >>> a.slot) & 1))
        return false;
  return true;
}
