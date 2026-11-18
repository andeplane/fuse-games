/**
 * Horizontal truck rules from the supplied DOS GAME.EXE. Source addresses below
 * are offsets in code segment 0 (file offset +0x400). One call is one race update.
 * X/Y are unsigned words, 256 units per contour cell. Angles are unsigned words,
 * 65536 per turn, zero along +X, a quarter turn along +Y.
 */
export interface OffroadMotion {
  x: number;
  y: number;
  /** Last proposed displacement, before any wall rejects the move. */
  vx: number;
  vy: number;
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
// DS:2faa, signed Q14. Motion samples every eighth direction; collision
// response searches the full 256-direction table to recover a motion angle.
const QUARTER = [
  0, 402, 803, 1205, 1605, 2005, 2404, 2801, 3196, 3589, 3980, 4369, 4756, 5139,
  5519, 5896, 6269, 6639, 7005, 7366, 7723, 8075, 8423, 8765, 9102, 9434, 9759,
  10079, 10393, 10701, 11002, 11297, 11585, 11866, 12139, 12406, 12665, 12916,
  13159, 13395, 13622, 13842, 14053, 14255, 14449, 14634, 14810, 14978, 15136,
  15286, 15426, 15557, 15678, 15790, 15892, 15985, 16069, 16142, 16206, 16260,
  16305, 16339, 16364, 16379, 16384,
];

function sine(index: number): number {
  const i = index & 127;
  const value = QUARTER[i <= 64 ? i : 128 - i]!;
  return index & 128 ? -value : value;
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
    vx: 0,
    vy: 0,
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
  const direction = ((momentum >>> 8) + 7) & 248;
  const signedSpeed = (speed << 16) >> 16;
  const vx = (signedSpeed * sine(direction + 64)) >> 14;
  const vy = (signedSpeed * sine(direction)) >> 14;
  const x = (state.x + vx) & WORD;
  const y = (state.y + vy) & WORD;
  return {
    ...state,
    x,
    y,
    vx,
    vy,
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

// DS:5302 contains eight distinct shapes; the second half-turn repeats them.
// Offsets are in eighths of a contour cell (simulation coordinates >> 5);
// widths and heights count four-unit occupancy buckets.
const COLLISION_BOUNDS = [
  [-8, 4, -4, 2],
  [-9, 4, -7, 3],
  [-8, 4, -8, 4],
  [-7, 3, -9, 4],
  [-4, 2, -8, 4],
  [-7, 3, -9, 4],
  [-8, 4, -8, 4],
  [-9, 4, -7, 3],
] as const;

function collisionBounds(truck: Readonly<OffroadMotion>) {
  const shape = (((truck.heading >>> 8) + 8) >>> 4) & 7;
  const [dx, width, dy, height] = COLLISION_BOUNDS[shape]!;
  const left = ((truck.x >>> 5) + dx) >> 2;
  const top = ((truck.y >>> 5) + dy) >> 2;
  return { left, right: left + width, top, bottom: top + height };
}

/** Overlap of DOS X and Y occupancy buckets, 0x0d97 and 0x0e25. */
export function offroadTrucksOverlap(
  a: Readonly<OffroadMotion>,
  b: Readonly<OffroadMotion>,
): boolean {
  const one = collisionBounds(a);
  const two = collisionBounds(b);
  return (
    one.left < two.right &&
    two.left < one.right &&
    one.top < two.bottom &&
    two.top < one.bottom
  );
}

function contactMotion(
  state: Readonly<OffroadMotion>,
  vx: number,
  vy: number,
): OffroadMotion {
  // 0x0f3e inverse polar conversion. DOS takes up to four integer Newton
  // steps; even a zero Y velocity can yield a heading one unit off the axis.
  let speed = 0;
  let direction = 0;
  if (vx !== 0 || vy !== 0) {
    const squared = vx * vx + vy * vy;
    speed = ((Math.abs(vx) + Math.abs(vy)) >> 1) + 16;
    for (let i = 0; i < 4; i++) {
      const quotient = Math.floor(squared / speed);
      speed = (speed + quotient) >>> 1;
      if (speed === quotient) break;
    }
    const ratio = Math.trunc((vy * 16384) / speed) & WORD;
    direction = vx < 0 ? 96 : 32;
    let delta = vx < 0 ? -16 : 16;
    if (ratio & 0x8000) direction ^= 192;
    for (let i = 0; i < 5; i++) {
      const sample = sine(direction) & WORD;
      if (ratio === sample) break;
      direction += ratio < sample ? -delta : delta;
      delta >>= 1;
    }
  }
  return {
    ...state,
    momentum: ((direction & 255) << 8) | (state.momentum & 255),
    speed,
    throttle: Math.max(state.throttle, 32),
  };
}

/**
 * First contact, 0x16dc. Exchange three quarters of the component differences
 * between the last proposed velocities. The caller owns enter/stay tracking.
 * Keep the input order: the arithmetic right shift rounds a negative difference down.
 */
export function resolveOffroadTruckContact(
  a: Readonly<OffroadMotion>,
  b: Readonly<OffroadMotion>,
): [OffroadMotion, OffroadMotion] {
  const dx = ((b.vx - a.vx) << 16) >> 16;
  const dy = ((b.vy - a.vy) << 16) >> 16;
  const transferX = dx - (dx >> 2);
  const transferY = dy - (dy >> 2);
  return [
    contactMotion(
      a,
      ((a.vx + transferX) << 16) >> 16,
      ((a.vy + transferY) << 16) >> 16,
    ),
    contactMotion(
      b,
      ((b.vx - transferX) << 16) >> 16,
      ((b.vy - transferY) << 16) >> 16,
    ),
  ];
}
