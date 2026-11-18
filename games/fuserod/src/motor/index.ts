/** Street Rod 2 manual drivetrain. See tests/reference for parity evidence and license. */
export type Grade = 0 | 1 | 2;
export type Direction = -1 | 0 | 1;
export interface MotorTune {
  power?: Grade;
  gearbox?: Grade;
  tires?: Grade;
}
export interface MotorControls {
  throttle: boolean;
  brake: boolean;
  steer: Direction;
  shift: Direction;
  shoulder?: boolean;
}
export interface MotorState {
  rpm: number;
  speed: number;
  gear: number;
  band: number;
  wheel: number;
  steerInput: number;
  engineWear: number;
  gearWear: number;
  limiter: number;
  broken: boolean;
  failure: number;
  steps: number;
  seed: number;
  engaged: boolean;
  position: number;
  pitPhase: number;
  pitIndex: number;
  pendingShift: Direction;
}

export function createMotor(seed = 37): MotorState {
  return {
    rpm: 1500,
    speed: 0,
    gear: 0,
    band: 0,
    wheel: 0,
    steerInput: 0,
    engineWear: 0,
    gearWear: 0,
    limiter: 0,
    broken: false,
    failure: 0,
    steps: 0,
    seed: seed >>> 0,
    engaged: false,
    position: 0,
    pitPhase: 0,
    pitIndex: 0,
    pendingShift: 0,
  };
}

const torque = [
  [500, 600, 300, 100, 70],
  [600, 700, 350, 120, 90],
  [600, 760, 380, 140, 90],
] as const;
const spread = [
  [0, 25, 50, 100, 0],
  [0, 25, 50, 75, 100],
  [0, 30, 50, 80, 100],
] as const;
const thresholds = [
  [2900, 4500],
  [2900, 5000],
  [2500, 5200],
] as const;
const roadSteps = [
  0, 8, 8, 8, 9, 9, 9, 10, 10, 11, 11, 11, 12, 12, 12, 13, 13, 14, 14, 15, 15,
  16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 23, 24, 24,
  25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 30, 30, 31, 31, 32, 32, 33, 33, 34,
  35, 36, 36, 37, 37, 38, 38, 39, 39, 40, 40, 41, 41, 42, 42, 43, 43, 44, 44,
  45, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62,
  63, 65, 67, 69, 71, 73, 75, 77, 79, 81, 83, 85, 87, 89, 91, 93, 95, 97, 99,
  101, 103, 105, 107, 109, 111, 113, 115, 117, 119, 121, 123, 125, 127, 127,
] as const;
const div = (a: number, b: number) => Math.trunc(a / b);

export function speedToStep(mph: number): number {
  return roadSteps[Math.max(0, Math.min(130, Math.trunc(mph)))]!;
}

export function motorGears(tune: MotorTune = {}): number {
  return tune.gearbox ? 4 : 3;
}

// DOS car_setup for our fresh, class-2 manual cars with standard bodywork,
// induction, exhaust and street differential. The first manual transmission is SR2 grade 1.
function carPerformance(engine: Grade, transmission: Grade) {
  const score =
    [33, 66, 100][transmission]! * 15 + (88 + 55) * 10 + engine * 50 * 25;
  return div(div(score, 100) * 30, 100) + 70;
}

function curve(state: MotorState, tune: MotorTune, performance: number) {
  const gear = state.gear;
  const peak = div(torque[tune.power ?? 0][gear]! * performance, 100);
  const low =
    div(peak, gear === 0 ? 1 : 5) *
    (gear === 1 ? (tune.tires === 2 ? 3 : 2) : 1);
  const up =
    state.band === 0
      ? low
      : state.band === 1
        ? peak
        : div(peak, gear === 0 ? 1 : 10);
  return { up, down: gear === 0 ? peak : div(peak, 5 - gear) };
}

function ratioFor(gear: number, gearbox: Grade, performance: number) {
  return div(
    570000,
    spread[gearbox][gear]! * Math.min(130, div(performance * 13, 10)) || 20,
  );
}

export function motorTopSpeed(tune: MotorTune): number {
  return Math.min(
    130,
    div(carPerformance(tune.power ?? 0, tune.gearbox ?? 0) * 13, 10),
  );
}

/** Road contacts slow the powered wheels and the connected engine together. */
export function slowMotor(
  state: MotorState,
  maximum: number,
  tune: MotorTune = {},
): MotorState {
  const speed = Math.max(0, Math.min(state.speed, Math.trunc(maximum)));
  if (speed === state.speed) return state;
  const gearbox = tune.gearbox ?? 0;
  const power = tune.power ?? 0;
  const ratio = ratioFor(state.gear, gearbox, carPerformance(power, gearbox));
  const rpm =
    state.gear === 0 ? 1500 + speed * 30 : Math.max(1500, speed * ratio);
  const [lower, upper] = thresholds[power];
  return { ...state, speed, rpm, band: rpm > upper ? 2 : rpm > lower ? 1 : 0 };
}

function physics(s: MotorState, input: MotorControls, tune: MotorTune) {
  if (s.broken) return;
  const power = tune.power ?? 0;
  const gearbox = tune.gearbox ?? 0;
  const performance = carPerformance(power, gearbox);
  let { up, down } = curve(s, tune, performance);
  s.steps++;
  if (s.rpm > 5000) {
    s.engineWear++;
    s.gearWear++;
  }
  if (((s.steps * 3) & 15) === 0) s.engineWear++;
  if (s.engineWear >= 9900) {
    s.failure |= 5;
    up = down = 0;
  }

  if (input.throttle) {
    s.rpm += up;
    if (s.rpm > 5700) {
      s.rpm = 5700;
      if (++s.limiter > 15 - div(s.engineWear, 1000)) s.failure |= 5;
    }
  } else if (s.rpm > 1500 || (s.gear > 0 && s.rpm > down)) {
    s.rpm -= down;
  }
  if (s.rpm < 5700) s.limiter = 0;

  const stall = s.speed < 5 && !input.throttle && s.gear > 0;
  if (input.shift !== 0 || stall) {
    s.gearWear += s.rpm > 5000 ? 15 : 3;
    if (s.gearWear >= 9900) s.failure |= 17;
    else if (input.throttle && s.rpm > 5000) {
      s.seed = (Math.imul(s.seed, 0x015a4e35) + 1) >>> 0;
      if (div(s.gearWear, 100) + 100 > ((s.seed >>> 16) & 32767) % 3277)
        s.failure |= 17;
    }
    s.gear = stall
      ? 0
      : Math.max(0, Math.min(motorGears(tune), s.gear + input.shift));
    s.engaged = true;
    // x86 stores the 16-bit product, including when a driver selects neutral while moving.
    s.rpm =
      ((s.speed * ratioFor(s.gear, gearbox, performance)) << 16) >> 16 || 1505;
  }
  const [lower, upper] = thresholds[power];
  s.band = s.rpm > upper ? 2 : s.rpm > lower ? 1 : 0;
  const ratio = s.engaged ? ratioFor(s.gear, gearbox, performance) : 0;
  if (input.brake || (input.shoulder && s.speed > 8)) {
    s.speed = Math.max(0, s.speed - (s.speed >> 4) - 2);
    s.rpm = Math.max(1500, ((s.speed * ratio) << 16) >> 16);
  } else if (s.gear === 0 && s.speed !== 0) {
    s.rpm = --s.speed * 30 + 1500;
  } else if (ratio !== 0) {
    s.speed = div(s.rpm, ratio);
  }
  if (s.failure) s.wheel = s.steerInput = 0;
  const dir = input.steer;
  if (dir && Math.abs(s.steerInput + dir) > Math.abs(s.steerInput)) {
    if (
      Math.abs(dir + s.wheel) === Math.abs(dir) + Math.abs(s.wheel) &&
      Math.abs(s.steerInput) < Math.abs(s.wheel)
    )
      s.steerInput = s.wheel;
    s.steerInput = Math.max(-24, Math.min(24, s.steerInput + dir * 2));
    s.wheel = s.steerInput;
  } else s.steerInput = 0;
  s.wheel -= Math.sign(s.wheel) * ((Math.abs(s.wheel) >> 2) + 1);
  s.broken = s.failure !== 0;
}

/** Advance only the driving interrupt, independently of the road / network clocks. */
export function stepMotor(
  previous: MotorState,
  input: MotorControls,
  tune: MotorTune = {},
): MotorState {
  const next = { ...previous };
  physics(next, input, tune);
  return next;
}

const PIT_DIVIDER = 16384 * 20;
/** One 20 Hz Fuse tick. The original PIT clocks drivetrain and road at different rates. */
export function advanceMotor(
  previous: MotorState,
  input: MotorControls,
  tune: MotorTune = {},
): MotorState {
  const next = { ...previous };
  if (input.shift) next.pendingShift = input.shift;
  next.pitPhase += 1193182;
  while (next.pitPhase >= PIT_DIVIDER) {
    next.pitPhase -= PIT_DIVIDER;
    next.pitIndex = (next.pitIndex + 1) % 24;
    if (next.pitIndex % 12 === 0) {
      physics(next, { ...input, shift: next.pendingShift }, tune);
      next.pendingShift = 0;
    }
    if (next.pitIndex % 8 === 0 && !next.broken)
      next.position += speedToStep(next.speed);
  }
  return next;
}

function integer(value: unknown, lo: number, hi: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= lo &&
    value <= hi
  );
}

export function isMotorState(value: unknown): value is MotorState {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    Object.keys(s).length === 18 &&
    integer(s.rpm, -32768, 32767) &&
    integer(s.speed, 0, 1000) &&
    integer(s.gear, 0, 4) &&
    integer(s.band, 0, 2) &&
    integer(s.wheel, -24, 24) &&
    integer(s.steerInput, -24, 24) &&
    integer(s.engineWear, 0, 10000) &&
    integer(s.gearWear, 0, 10020) &&
    integer(s.limiter, 0, 16) &&
    integer(s.failure, 0, 31) &&
    [0, 5, 17, 21].includes(Number(s.failure)) &&
    s.broken === (s.failure !== 0) &&
    typeof s.engaged === "boolean" &&
    (s.engaged || (s.gear === 0 && s.speed === 0 && s.position === 0)) &&
    integer(s.steps, 0, 0x7fffffff) &&
    integer(s.seed, 0, 0xffffffff) &&
    integer(s.position, 0, 0x7fffffff) &&
    integer(s.pitPhase, 0, PIT_DIVIDER - 1) &&
    integer(s.pitIndex, 0, 23) &&
    integer(s.pendingShift, -1, 1)
  );
}
