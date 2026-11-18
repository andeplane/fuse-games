import encodedRoutes from "./cpu-routes.json" with { type: "json" };

interface Instruction {
  op: string;
  a: number;
  b: number;
  c: number;
}

const routes = encodedRoutes.map((line) =>
  line.split("|").map((text) => {
    const [op = "", ...args] = text.split(" ");
    const [a = 0, b = 0, c = 0] = args.map(Number);
    return { op, a, b, c };
  }),
);
function program(course: string) {
  const match = /^offroad-([1-8])(-reverse)?$/.exec(course);
  return match ? routes[Number(match[1]) - 1 + (match[2] ? 8 : 0)] : undefined;
}
export interface OffroadCpuState {
  current: number;
  next: number;
  pc: number;
  radius: number;
  pedal: number;
  level: number;
}

/** Validate route pointers before accepting a network checkpoint. */
export function isOffroadCpuState(
  raw: unknown,
  course: string,
): raw is OffroadCpuState {
  const route = program(course);
  if (!route || !raw || typeof raw !== "object") return false;
  const s = raw as Record<string, unknown>;
  const integer = (value: unknown, limit: number): value is number =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    !Object.is(value, -0) &&
    value >= 0 &&
    value <= limit;
  return (
    integer(s.current, route.length - 1) &&
    route[s.current]!.op === "point" &&
    integer(s.next, route.length - 1) &&
    route[s.next]!.op === "point" &&
    integer(s.pc, route.length - 1) &&
    s.pc === s.next + 1 &&
    integer(s.radius, 65535) &&
    integer(s.pedal, 510) &&
    integer(s.level, 17)
  );
}

const rebound = [
  19712, 19200, 18688, 17920, 16896, 15616, 14080, 10496, 7936, 5888, 4352,
  3328, 2560, 1792, 1536, 1024, 768, 512,
];
const deceleration = [
  8, 8, 8, 8, 8, 8, 12, 12, 12, 12, 12, 12, 16, 16, 16, 16, 16, 16,
];
const turn = [
  768, 800, 800, 832, 832, 896, 960, 1024, 1152, 1280, 1536, 1920, 1792, 1920,
  2048, 2048, 2176, 2304,
];
const grip = [
  78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 110, 120, 127, 127, 127, 127,
];
const tolerance = [
  2, 3, 4, 5, 6, 7, 8, 8, 9, 9, 10, 10, 11, 12, 13, 14, 15, 16,
];
const acceleration = [
  8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 32, 32,
];
const speed = [
  126, 126, 128, 128, 130, 130, 132, 134, 140, 146, 158, 166, 170, 174, 180,
  186, 190, 192,
];
const levels = speed.map((speedLimit, i) => ({
  speedLimit,
  turn: turn[i]!,
  grip: grip[i]!,
  acceleration: acceleration[i]!,
  deceleration: deceleration[i]!,
  contactTolerance: tolerance[i]!,
  rebound: rebound[i]!,
}));
export function offroadCpuStats(level: number) {
  return levels[level]!;
}
/** CS:3848 replaces the previous raw checkpoint progress in place, saturating on a repeat. */
export function offroadPaceProgress(raw: number, lapDistance: number) {
  return raw >= lapDistance ? 65535 : Math.floor((raw * 65536) / lapDistance);
}
/** CS:2353 ranks the last DOS CPU against the first human in the standings. */
export function offroadCatchupLevel(
  base: number,
  laps: number,
  progressByte: number,
  humanLaps: number,
  humanProgressByte: number,
) {
  const signedGap = ((progressByte - humanProgressByte) << 24) >> 24;
  // XLAT zero-extends its byte index, even for a negative result from SAR.
  const offsets = [8, -125, 12, 4, 7, 7, 5, 7, 0, 0, -1, -1, -1, -2, -2, -2];
  const adjustment =
    laps < humanLaps
      ? 5
      : laps > humanLaps
        ? -5
        : offsets[8 + (signedGap >> 4)]!;
  return Math.min(17, Math.max(0, ((base + adjustment) << 24) >> 24));
}
interface CpuFrame {
  x: number;
  y: number;
  heading: number;
  throttle: number;
  nitroTicks: number;
  region: number;
  difficulty?: number;
  /** Offered only to Ivan's fourth arcade slot when its pace opcode executes. */
  catchupLevel?: number;
  /** Reacquisition can encounter another pace instruction in the same update. */
  repeatedCatchupLevel?: number;
}

const inRange = (v: number, lo: number, hi: number) =>
  lo < hi ? v >= lo && v <= hi : v >= lo || v <= hi;
function distance(p: Instruction, frame: CpuFrame) {
  const dx = ((p.a - frame.x) << 16) >> 22;
  const dy = ((p.b - frame.y) << 16) >> 22;
  return (dx * dx + dy * dy) & 65535;
}

/** Integer direction estimator used by the CPU at CS:23e2. */
function direction(dx: number, dy: number) {
  const x = Math.abs(dx),
    y = Math.abs(dy);
  const ratio = Math.min(
    65535,
    Math.floor((4 * Math.max(x, y)) / Math.max(1, Math.min(x, y))),
  );
  const limits = [4, 5, 6, 8, 11, 17, 26, 81];
  let angle = 8;
  for (const limit of limits) {
    if (ratio <= limit) break;
    angle--;
  }
  if (x < y) angle = 16 - angle;
  if (dx < 0 !== dy < 0) angle = 32 - angle;
  return (
    ((angle << 1) | (((dx < 0 ? 160 : 0) ^ (dy < 0 ? 224 : 0)) << 1)) & 255
  );
}

/** Original route interpreter (CS:2189–2467). Per-call state belongs to the authoritative race. */
function cpuDecision(
  course: string,
  previous: OffroadCpuState | undefined,
  frame: CpuFrame,
  seed: number,
  initializeOnly: boolean,
) {
  const route = program(course);
  if (!route) throw new Error("Unknown Off Road CPU route");
  const nodes = route;
  const state: OffroadCpuState = previous
    ? { ...previous }
    : {
        current: 0,
        next: 0,
        pc: 0,
        radius: 0,
        pedal: 0,
        level: frame.difficulty ?? 6,
      };

  let paceCount = 0;
  function nextPoint() {
    for (let n = 0; n <= nodes.length; n++) {
      const p = nodes[state.pc++]!;
      switch (p.op) {
        case "point":
          return state.pc - 1;
        case "pedal":
          state.pedal = p.a;
          break;
        case "radius":
          state.radius = p.a;
          break;
        case "pace":
          if (frame.catchupLevel !== undefined) {
            state.level =
              paceCount === 0
                ? frame.catchupLevel
                : (frame.repeatedCatchupLevel ?? frame.catchupLevel);
            paceCount++;
          }
          break;
        case "jump":
          state.pc = p.a;
          break;
        case "region":
          if (inRange(frame.region, p.a, p.b)) state.pc = p.c;
          break;
        case "level":
          if (inRange(state.level, p.a, p.b)) state.pc = p.c;
          break;
        case "chance":
          seed = (((seed + 1) & 65535) * 171) % 30323;
          if (p.a < ((seed - 1) & 65535) >>> 8) state.pc = p.b;
          break;
        case "boosting":
          if (frame.nitroTicks !== 0) state.pc = p.a;
          break;
        // The eligible directive affects nearest-point searches only. Nitro sets
        // the truck's old control byte, overwritten by CS:1778 on this call.
      }
    }
    throw new Error("Off Road CPU route did not yield a waypoint");
  }
  function acquire() {
    let best = 65535,
      radius = 0,
      pedal = 0,
      eligible = true;
    for (const [i, p] of nodes.entries()) {
      if (p.op === "eligible") eligible = inRange(frame.region, p.a, p.b);
      else if (p.op === "radius") radius = p.a;
      else if (p.op === "pedal") pedal = p.a;
      else if (p.op === "point" && eligible) {
        const d = distance(p, frame);
        if (d < best) {
          best = d;
          state.current = i;
          state.pc = i + 1;
          state.pedal = pedal;
          state.radius = radius;
        }
      }
    }
    state.radius = Math.max(state.radius, best);
    state.next = nextPoint();
  }
  if (!previous) acquire();
  if (initializeOnly)
    return {
      input: { steer: 0 as const, gas: false, nitro: false },
      paceCount,
      state,
      seed,
    };
  let currentDistance = distance(nodes[state.current]!, frame);
  if (currentDistance >= state.radius) {
    acquire();
    // CS:219e leaves the packed waypoint word in AX on reacquisition.
    const next = nodes[state.next]!;
    currentDistance = (next.a >>> 8) | next.b;
  }
  const target = nodes[state.next]!;
  if (distance(target, frame) <= currentDistance) {
    state.current = state.next;
    state.next = nextPoint();
  }
  const error =
    ((direction(target.a - frame.x, target.b - frame.y) -
      (frame.heading >>> 8)) <<
      24) >>
    24;
  const steer: -1 | 0 | 1 = error < -8 ? -1 : error > 8 ? 1 : 0;
  return {
    input: { steer, gas: state.pedal > frame.throttle, nitro: false },
    paceCount,
    state,
    seed,
  };
}

/** Grid setup invokes only the nearest-target scan, before the first race tick. */
export function createOffroadCpu(
  course: string,
  frame: CpuFrame,
  seed: number,
) {
  const {
    state,
    seed: nextSeed,
    paceCount,
  } = cpuDecision(course, undefined, frame, seed, true);
  return { state, seed: nextSeed, paceCount };
}

export function driveOffroadCpu(
  course: string,
  previous: OffroadCpuState | undefined,
  frame: CpuFrame,
  seed: number,
) {
  return cpuDecision(course, previous, frame, seed, false);
}
