import { nextOffroadSeed } from "./rng.js";

/** Fixed-point wheel contact, from GAME.EXE CS:18be–1b95 and 1d73–1de2. */
export interface OffroadWheel {
  height: number;
  velocity: number;
  clearance: number;
}

export interface OffroadSuspension {
  bodyHeight: number;
  groundHeight: number;
  /** In DOS contact order: rear pair, then front pair. */
  wheels: [OffroadWheel, OffroadWheel, OffroadWheel, OffroadWheel];
}

interface Motion {
  x: number;
  y: number;
  heading: number;
  momentum: number;
  speed: number;
  throttle: number;
  nitroTicks: number;
  backwards: boolean;
}

interface Surface {
  height: number;
  blocked: boolean;
  kind: number;
  direction: number;
  slopeX: number;
  slopeY: number;
}

export interface OffroadSuspensionSetup {
  rebound: number;
  contactTolerance: number;
  topSpeed: number;
}

const STOCK: OffroadSuspensionSetup = {
  rebound: 15360,
  contactTolerance: 2,
  topSpeed: 134,
};

const u16 = (v: number) => v & 0xffff;
const i16 = (v: number) => (v << 16) >> 16;
const i8 = (v: number) => (v << 24) >> 24;
const WHEEL_PHASE = [20, 12, 28, 4] as const;
const GRID_SIDE = 44;
// Stock polygon zero. At the observed Y row overruns the DOS row lookup
// indexes zero-filled words beyond the contour table, selecting this facet.
// Reproduce those border contacts without consulting unrelated process memory.
const BORDER_FACET: Surface = {
  height: 0,
  kind: 0,
  blocked: true,
  direction: 64,
  slopeX: 0,
  slopeY: 32,
};
/** Quarter wave of round(256 * sin(index * pi/16)). */
const QUARTER = [0, 50, 98, 142, 181, 213, 237, 251, 256] as const;
const sineOffset = (index: number): number => {
  const phase = index & 15;
  const magnitude = QUARTER[phase <= 8 ? phase : 16 - phase]!;
  return (index & 16) === 0 ? magnitude : -magnitude;
};

/** CS:190a selects a Y row, then adds the wheel's X cell to its address.
 * An X overrun can therefore reach the next row within the same contour table.
 * Keep addresses outside the table on the normal missing-contact path.
 */
function sampleWheel(
  sample: (x: number, y: number) => Surface | null,
  x: number,
  y: number,
): Surface | null {
  const col = x >>> 8;
  const row = y >>> 8;
  if (row >= GRID_SIDE) {
    const nearBorder =
      row === GRID_SIDE || row === GRID_SIDE + 1 || row === 255;
    return col < GRID_SIDE && nearBorder ? BORDER_FACET : null;
  }
  if (col < GRID_SIDE) return sample(x, y);
  const cell = row * GRID_SIDE + col;
  if (cell >= GRID_SIDE * GRID_SIDE) return null;
  return sample(
    (cell % GRID_SIDE) * 256 + (x & 255),
    Math.floor(cell / GRID_SIDE) * 256 + (y & 255),
  );
}

export function createOffroadSuspension(height = 0x8000): OffroadSuspension {
  const wheel = (): OffroadWheel => ({ height, velocity: 0, clearance: 0 });
  return {
    bodyHeight: height,
    groundHeight: height,
    wheels: [wheel(), wheel(), wheel(), wheel()],
  };
}

interface Collision<T extends Motion> {
  motion: T;
  flags: number;
  randomSeed: number;
}

/** A second wheel encountering a barrier sees the response already applied by the first. */
function hitBarrier<T extends Motion>(
  hit: Collision<T>,
  direction: number,
  topSpeed: number,
): void {
  const m = hit.motion;
  if (hit.flags) {
    const angle = ((m.momentum >>> 8) - direction) & 255;
    if (i8(angle + 64) < 0) {
      m.momentum = u16(m.momentum + ((angle >>> 1) << 8));
      hit.flags = 0x83;
    }
    return;
  }
  const reverse = m.backwards ? 128 : 0;
  const incidence = i8(((m.heading >>> 8) ^ reverse) - direction - 64);
  if (incidence < 0) {
    m.momentum = m.heading ^ (reverse << 8);
    return;
  }
  if (incidence >= 56 && incidence < 72) {
    m.speed = (160 * topSpeed) >>> 8;
    m.throttle = 0;
    m.nitroTicks = 0;
    // The shared DOS random routine at 0434:063e returns its next state minus one.
    hit.randomSeed = nextOffroadSeed(hit.randomSeed);
    const turn = ((hit.randomSeed - 1) & 32) !== 0 ? 8192 : -8192;
    m.heading = u16(m.heading + turn);
    m.backwards = !m.backwards;
    const directionByte = (m.heading >>> 8) ^ (m.backwards ? 128 : 0);
    m.momentum = (directionByte << 8) | (m.momentum & 255);
    hit.flags = 3;
    return;
  }
  const left = incidence < 56;
  m.heading = u16(m.heading + (left ? -4096 : 4096));
  m.momentum = (((direction + (left ? 64 : 192)) ^ reverse) & 255) << 8;
  // Normal sectors near a coordinate axis pin its component. Diagonal sectors can slide.
  const sector = (direction >>> 4) & 7;
  hit.flags =
    128 |
    (sector === 2 || sector === 6 ? 0 : sector >= 3 && sector <= 5 ? 2 : 1);
  if (m.throttle > 64)
    m.throttle = Math.max(64, m.throttle - (m.throttle >>> 2));
  const limit =
    m.nitroTicks > 0 ? Math.min(240, topSpeed + (topSpeed >>> 1)) : topSpeed;
  m.speed = (limit * m.throttle) >>> 8;
}

function contact(
  previous: OffroadWheel,
  surface: Surface,
  motion: Motion,
  rebound: number,
): OffroadWheel {
  const height = u16(previous.height + previous.velocity);
  const compression = i16(surface.height - height);
  if (compression <= 0) {
    return {
      height,
      velocity:
        compression < 0 ? i16(previous.velocity - 256) : previous.velocity,
      clearance: u16(-compression),
    };
  }
  const impact = Math.max(compression, -previous.velocity);
  const impulse = ((impact * rebound) >>> 16) + Math.max(0, previous.velocity);
  if (surface.kind === 1 && motion.speed > 48)
    motion.speed = Math.max(48, motion.speed - 2);
  if (surface.slopeX !== 0 || surface.slopeY !== 0) {
    const approach = i8((motion.momentum >>> 8) - surface.direction + 64);
    if (approach < 0) {
      const angle = -approach;
      const leverage = (angle < 40 ? angle : -angle & 112) >>> 4;
      motion.speed = Math.max(0, motion.speed - leverage * (impact >>> 8));
    }
  }
  return {
    height: surface.height,
    velocity: impulse < 512 ? 0 : Math.min(2048, impulse),
    clearance: 0,
  };
}

/**
 * Probe a translated candidate before engine/steering. Apply stopX and stopY to the
 * candidate's position at commit; all four probes use the original candidate centre.
 * Heading changes from earlier contacts DO rotate the remaining wheel probes.
 */
export function stepOffroadSuspension<T extends Motion>(
  previous: OffroadSuspension,
  candidate: T,
  sample: (x: number, y: number) => Surface | null,
  randomSeed: number,
  setup: OffroadSuspensionSetup = STOCK,
) {
  const hit: Collision<T> = { motion: { ...candidate }, flags: 0, randomSeed };
  const wheels: OffroadSuspension["wheels"] = [...previous.wheels];
  const grounds = [0, 0, 0, 0];
  let groundMask = 0;
  for (const [i, phase] of WHEEL_PHASE.entries()) {
    const angle = (hit.motion.heading >>> 11) + phase;
    const surface = sampleWheel(
      sample,
      u16(candidate.x + sineOffset(angle + 8)),
      u16(candidate.y + sineOffset(angle)),
    );
    let wheel: OffroadWheel;
    if (!surface || surface.blocked) {
      if (surface) hitBarrier(hit, surface.direction, setup.topSpeed);
      else hit.flags |= 3; // No course normal outside the supplied grid.
      grounds[i] = previous.groundHeight;
      wheel = {
        height: previous.bodyHeight,
        velocity: previous.wheels[i]!.velocity,
        clearance: u16(previous.bodyHeight - previous.groundHeight),
      };
    } else {
      grounds[i] = surface.height;
      wheel = contact(previous.wheels[i]!, surface, hit.motion, setup.rebound);
    }
    if (wheel.clearance <= setup.contactTolerance) groundMask |= 8 >>> i;
    wheels[i] = wheel;
  }
  const pair = (a: number, b: number) => (a >>> 1) + (b >>> 1);
  const diagonalA = pair(wheels[0].height, wheels[3].height);
  const diagonalB = pair(wheels[1].height, wheels[2].height);
  const difference = diagonalA - diagonalB;
  if (Math.abs(difference) >= 256) {
    const lowPair = difference > 0 ? [1, 2] : [0, 3];
    for (const i of lowPair)
      wheels[i]!.height = u16(wheels[i]!.height + (Math.abs(difference) >>> 1));
  }
  const suspension: OffroadSuspension = {
    wheels,
    bodyHeight: pair(diagonalA, diagonalB),
    groundHeight: pair(
      pair(grounds[0]!, grounds[1]!),
      pair(grounds[2]!, grounds[3]!),
    ),
  };
  return {
    suspension,
    motion: hit.motion,
    groundMask,
    stopX: (hit.flags & 1) !== 0,
    stopY: (hit.flags & 2) !== 0,
    randomSeed: hit.randomSeed,
  };
}
