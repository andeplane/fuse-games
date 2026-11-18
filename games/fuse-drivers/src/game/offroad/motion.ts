/**
 * Horizontal truck rules from the supplied DOS GAME.EXE. Source addresses below
 * are offsets in code segment 0 (file offset +0x400). One call is one race update.
 * X/Y are unsigned words, 256 units per contour cell. Angles are unsigned words,
 * 65536 per turn, zero along +X, a quarter turn along +Y.
 */
export interface OffroadMotion {
  x: number;
  y: number;
  heading: number;
  momentum: number;
  speed: number;
  throttle: number;
  nitros: number;
  nitroTicks: number;
  backwards: boolean;
  acceleration: number;
}

export interface OffroadInput {
  steer: -1 | 0 | 1;
  gas: boolean;
  nitro: boolean;
}

export type OffroadUpgradeLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface OffroadDriveStats {
  turn: number;
  grip: number;
  deceleration: number;
  speedLimit: number;
}

export function offroadDriveStats(
  tires: OffroadUpgradeLevel = 0,
  speed: OffroadUpgradeLevel = 0,
): OffroadDriveStats {
  return {
    turn: [1536, 1664, 1792, 1920, 2048, 2176][tires]!,
    grip: [48, 54, 60, 64, 68, 72][tires]!,
    deceleration: [4, 5, 6, 7, 8, 8][tires]!,
    speedLimit: [134, 138, 142, 146, 150, 154][speed]!,
  };
}

const STOCK = offroadDriveStats();
const WORD = 0xffff;
// Signed Q14 samples read by 0x1871, first quadrant of DS:2faa.
const QUARTER = [0, 3196, 6269, 9102, 11585, 13622, 15136, 16069, 16384];

function sin32(index: number): number {
  const i = index & 15;
  const value = QUARTER[i <= 8 ? i : 16 - i]!;
  return index & 16 ? -value : value;
}

export function createOffroadMotion(
  x: number,
  y: number,
  heading: number,
  nitros = 25,
): OffroadMotion {
  return {
    x: x & WORD,
    y: y & WORD,
    heading: heading & WORD,
    momentum: heading & WORD,
    speed: 0,
    throttle: 0,
    nitros,
    nitroTicks: 0,
    backwards: false,
    // Human initialization at 0x14bf reads the acceleration upgrade into AX
    // but stores DX. DX still holds spawn Y >> 5 from 0x1401.
    acceleration: (y & WORD) >>> 5,
  };
}

/** Apply the pedal and nitro, then translate before probing this frame's terrain. */
export function advanceOffroadMotion(
  state: Readonly<OffroadMotion>,
  input: Readonly<OffroadInput>,
): OffroadMotion {
  let { speed, momentum, backwards } = state;
  let throttle = Math.min(
    256,
    Math.max(0, state.throttle + (input.gas ? 32 : -16)),
  );
  let nitros = state.nitros;
  let nitroTicks = Math.max(0, state.nitroTicks - 1);
  if (input.nitro && nitros > 0 && nitroTicks < 12) {
    nitros--;
    nitroTicks = 20;
    if (state.backwards) {
      speed = 0;
      throttle = 0;
      momentum = state.heading;
      backwards = false;
    } else {
      speed = (speed + (speed >>> 1)) & WORD;
      throttle = Math.max(64, throttle);
    }
  }

  // 0x1871 uses the old motion angle. Discard the fractional angle byte
  // before rounding the high byte UP to an eight-step boundary.
  const direction = (((momentum >>> 8) + 7) >>> 3) & 31;
  const signedSpeed = (speed << 16) >> 16;
  const x = (state.x + ((signedSpeed * sin32(direction + 8)) >> 14)) & WORD;
  const y = (state.y + ((signedSpeed * sin32(direction)) >> 14)) & WORD;
  return {
    ...state,
    x,
    y,
    momentum,
    speed,
    throttle,
    nitros,
    nitroTicks,
    backwards,
  };
}

/**
 * Run after wheel sampling and terrain response. Ground bits follow 0x1c8b.
 * Low two bits are the steering wheels and bits 2–3 are the driving wheels.
 */
export function steerOffroadMotion(
  state: Readonly<OffroadMotion>,
  input: Readonly<OffroadInput>,
  groundMask = 15,
  stats: Readonly<OffroadDriveStats> = STOCK,
): OffroadMotion {
  let { speed, heading, momentum, throttle } = state;
  const steering = groundMask & 3;
  const driving = (groundMask >>> 2) & 3;
  const error = ((heading - momentum) & WORD) >>> 8;
  let backwards = ((error + 64) & 128) !== 0;
  const folded = ((error + (backwards ? 128 : 0) + 128) & 255) - 128;
  if (steering) {
    const turn = stats.turn * input.steer;
    heading = (heading + (steering === 3 ? turn : turn >> 1)) & WORD;
    if (driving) {
      momentum =
        (momentum + folded * stats.grip * (driving === 3 ? 2 : 1)) & WORD;
    }
  }
  if (driving) {
    const limit = state.nitroTicks
      ? Math.min(240, stats.speedLimit + (stats.speedLimit >>> 1))
      : stats.speedLimit;
    const target = backwards ? 0 : (limit * throttle) >>> 8;
    if (!backwards && speed < target) {
      const gain = driving === 3 ? state.acceleration : state.acceleration >> 1;
      speed = Math.min(target, speed + gain);
    } else if (backwards || speed > target) {
      const loss = driving === 3 ? stats.deceleration : stats.deceleration >> 1;
      if (speed <= loss) {
        speed = 0;
        throttle = 0;
        momentum = heading;
        backwards = false;
      } else {
        speed = Math.max(target, speed - loss);
      }
    }
  }
  return { ...state, heading, momentum, speed, throttle, backwards };
}

/** One horizontal truck step when no intervening terrain response is needed. */
export function stepOffroadMotion(
  state: Readonly<OffroadMotion>,
  input: Readonly<OffroadInput>,
  groundMask = 15,
  stats: Readonly<OffroadDriveStats> = STOCK,
): OffroadMotion {
  return steerOffroadMotion(
    advanceOffroadMotion(state, input),
    input,
    groundMask,
    stats,
  );
}
