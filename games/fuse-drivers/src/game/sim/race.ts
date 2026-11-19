import type { OffroadDriver } from "../offroad/campaign.js";
import {
  createOffroadCpu,
  driveOffroadCpu,
  offroadCpuStats,
  offroadStartingLevel,
  offroadPaceProgress,
  offroadCatchupLevel,
} from "../offroad/cpu.js";
import { BASE_STATS, config, type TruckStats } from "./config.js";
import { closestOnSegment } from "./geometry.js";
import { NEUTRAL_INPUT, type TruckInput } from "./input.js";
import type { Truck } from "./truck.js";
import type { Point, Track } from "./track.js";
import { cos, hypot, sin } from "./deterministic-math.js";
import { driveTruck, placeTruck, startTruck } from "./drive.js";
import { createBattle, stepBattle, type BattleState } from "./battle.js";
import {
  getOffroadCourse,
  nativeRegionProgress,
  OFFROAD_COURSE_NAMES,
} from "../offroad/course.js";
import {
  offroadTrucksOverlap,
  resolveOffroadTruckContact,
} from "../offroad/motion.js";

import {
  initialOffroadPickups,
  stepOffroadPickups,
  type OffroadPickups,
} from "../offroad/pickups.js";

export type Phase = "countdown" | "racing" | "finished";

/** Plain JSON race snapshot (ADR 002). */
export interface RaceState {
  tick: number;
  phase: Phase;
  rngState: number;
  pickups: OffroadPickups;
  battle?: BattleState;
  trackName: string;
  trucks: Truck[];
  countdownEndTick: number;
  raceEndTick: number;
  /** Slots ordered by placement, best first. */
  placements: number[];
  /** Stable DOS order, last sorted by a CPU pace command or final classification. */
  paceOrder: number[];
}

export type RaceEvent =
  | { tick: number; type: "lap"; slot: number; lap: number }
  | { tick: number; type: "finish"; slot: number; place: number }
  | { tick: number; type: "wrongWay"; slot: number }
  | { tick: number; type: "wall"; slot: number }
  | { tick: number; type: "land"; slot: number }
  | { tick: number; type: "start" }
  | { tick: number; type: "pickup"; slot: number };

export interface StepResult {
  state: RaceState;
  events: RaceEvent[];
}

export function createRace(
  track: Track,
  seed: number,
  stats: TruckStats[] = [BASE_STATS],
  botSlots: readonly boolean[] = [],
  campaignIndex = 0,
  drivers: readonly (OffroadDriver | undefined)[] = [],
  gridOrder?: readonly number[],
  mode: "classic" | "battle" = "classic",
): RaceState {
  let rng = seed & 0xffff;
  const trucks = stats.map((s, i) => {
    const difficulty = botSlots[i]
      ? offroadStartingLevel(track.name, i, botSlots, campaignIndex)
      : undefined;
    let truck = startTruck(track, i, s, difficulty, drivers[i], gridOrder?.[i]);
    const course = getOffroadCourse(track.name);
    const distance = nativeRegionProgress(
      course.regions[0]!,
      truck.motion.x,
      truck.motion.y,
    );
    if (distance !== null)
      truck = {
        ...truck,
        checkpoint: 1,
        progress: distance / course.lapDistance,
        dosProgress: distance,
      };
    if (difficulty !== undefined) {
      const result = createOffroadCpu(
        track.name,
        { ...truck.motion, region: truck.checkpoint, difficulty },
        rng,
      );
      rng = result.seed;
      truck = {
        ...truck,
        cpu: result.state,
        cpuBase: difficulty,
        motion: {
          ...truck.motion,
          acceleration: offroadCpuStats(difficulty).acceleration,
        },
      };
    }
    return truck;
  });
  const gridRank = (slot: number) =>
    gridOrder?.[slot] ?? (slot < 4 ? 3 - slot : slot);
  return {
    tick: 0,
    phase: "countdown",
    rngState: rng,
    pickups: initialOffroadPickups(),
    ...(mode === "battle"
      ? { battle: createBattle(track.name, trucks.length) }
      : {}),
    trackName: track.name,
    trucks,
    countdownEndTick: config.countdownTicks,
    raceEndTick: 0,
    placements: trucks.map((t) => t.slot),
    paceOrder: trucks
      .map((t) => t.slot)
      .sort((a, b) => gridRank(a) - gridRank(b)),
  };
}

const dot = (ax: number, ay: number, bx: number, by: number) =>
  ax * bx + ay * by;

function trackDirectionAt(track: Track, p: Point): Point {
  const wp = track.waypoints;
  let best = 0,
    bestD = Infinity;
  for (let i = 0; i < wp.length; i++) {
    const c = closestOnSegment(p, { a: wp[i]!, b: wp[(i + 1) % wp.length]! });
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  // `best` is an index into the waypoint ring, which each native course supplies.
  const a = wp[best]!,
    b = wp[(best + 1) % wp.length]!;
  const len = hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

function applyCheckpoints(
  prev: Truck,
  t: Truck,
  track: Track,
  tick: number,
  events: RaceEvent[],
  state: RaceState,
): Truck {
  const n = track.checkpoints.length;
  let n2 = t;
  const course = getOffroadCourse(track.name);
  const x = (prev.motion.x + t.motion.vx) & 0xffff,
    y = (prev.motion.y + t.motion.vy) & 0xffff;
  let progress = t.progress;
  let dosProgress = t.dosProgress;
  if (!t.finishedTick) {
    const nextDistance = nativeRegionProgress(
      course.regions[t.checkpoint]!,
      x,
      y,
    );
    const distance =
      nextDistance ??
      nativeRegionProgress(
        course.regions[Math.max(0, t.checkpoint - 1)]!,
        x,
        y,
      );
    if (distance !== null) {
      dosProgress = distance;
      progress = t.laps + distance / course.lapDistance;
    }
    if (nextDistance !== null) {
      if (t.checkpoint === n - 1) {
        const laps = t.laps + 1;
        progress = laps;
        dosProgress = 0;
        n2 = { ...t, laps, checkpoint: 0 };
        events.push({ tick, type: "lap", slot: t.slot, lap: laps });
        if (state.placements[0] === t.slot)
          n2 = { ...n2, lapsLed: n2.lapsLed + 1 };
        if (laps >= config.laps) n2 = { ...n2, finishedTick: tick };
      } else {
        n2 = { ...t, checkpoint: t.checkpoint + 1 };
      }
    }
  }
  const along = trackDirectionAt(track, n2);
  const facing = dot(cos(n2.heading), sin(n2.heading), along.x, along.y);
  const wrongWayTicks =
    facing < 0 && !n2.finishedTick ? n2.wrongWayTicks + 1 : 0;
  if (wrongWayTicks === config.truck.wrongWayTicks)
    events.push({ tick, type: "wrongWay", slot: n2.slot });
  return {
    ...n2,
    wrongWayTicks,
    dosProgress,
    progress,
  };
}

/** CS:3848 and CS:38c2. A repeat normalization can saturate a distance, so
 * equal distances must retain the last DOS order (distinct from the live HUD). */
function nativeOrder(
  trucks: Truck[],
  before: number[],
  lapDistance: number,
): number[] {
  return before
    .slice()
    .sort(
      (a, b) =>
        trucks[b]!.laps - trucks[a]!.laps ||
        offroadPaceProgress(trucks[b]!.dosProgress, lapDistance) -
          offroadPaceProgress(trucks[a]!.dosProgress, lapDistance),
    );
}

function rank(trucks: Truck[], previous: number[]): number[] {
  return previous
    .map((slot) => trucks[slot]!)
    .sort((a, b) => {
      if (a.finishedTick && b.finishedTick)
        return a.finishedTick - b.finishedTick || a.slot - b.slot;
      if (a.finishedTick !== b.finishedTick) return a.finishedTick ? -1 : 1;
      return b.progress - a.progress;
    })
    .map((t) => t.slot);
}

/** One deterministic tick (ADR 002). Never mutates `state`. */
export function step(
  state: RaceState,
  inputs: readonly TruckInput[],
  track: Track,
  botSlots: readonly boolean[] = [],
  itemPresses?: readonly boolean[],
): StepResult {
  const tick = state.tick + 1;
  const events: RaceEvent[] = [];
  let rng = state.rngState;

  if (state.phase === "countdown" && tick < state.countdownEndTick)
    return { state: { ...state, tick }, events };
  if (state.phase === "countdown") events.push({ tick, type: "start" });
  if (state.phase === "finished") return { state, events };

  const prev = state.trucks;
  let paceOrder = state.paceOrder;
  const starting = prev.slice();
  const battle =
    state.battle &&
    stepBattle(state.battle, starting, inputs, tick, itemPresses);
  const pickup = stepOffroadPickups(
    state.pickups,
    OFFROAD_COURSE_NAMES.indexOf(track.name) % 8,
    prev.map((t) => t.motion),
    rng,
  );
  rng = pickup.randomSeed;
  const award = pickup.award;
  if (award) {
    events.push({ tick, type: "pickup", slot: award.slot });
    const owner = starting[award.slot]!;
    if (award.kind === "cash")
      starting[award.slot] = {
        ...owner,
        cash: (owner.cash + award.amount) % 100,
      };
    else {
      const nitros = Math.min(99, owner.motion.nitros + award.amount);
      starting[award.slot] = {
        ...owner,
        nitros,
        motion: { ...owner.motion, nitros },
      };
    }
  }
  const masks = starting.map(() => 0);
  for (let i = 0; i < starting.length; i++) {
    for (let j = i + 1; j < starting.length; j++) {
      const a = starting[i]!,
        b = starting[j]!;
      if (
        a.finishedTick ||
        b.finishedTick ||
        !offroadTrucksOverlap(a.motion, b.motion)
      )
        continue;
      masks[i] = masks[i]! | (1 << j);
      masks[j] = masks[j]! | (1 << i);
      if (!(a.contactMask & (1 << j))) {
        const [first, second] = resolveOffroadTruckContact(a.motion, b.motion);
        starting[i] = placeTruck(track, a, first);
        starting[j] = placeTruck(track, b, second);
      }
    }
  }
  const trucks = starting;
  for (let i = 0; i < trucks.length; i++) {
    let t = trucks[i]!;
    if (t.finishedTick) continue;
    let input = inputs[i] ?? NEUTRAL_INPUT;
    if (botSlots[i] || t.cpu) {
      const distance = getOffroadCourse(track.name).lapDistance;
      const normalize = (value: number) => offroadPaceProgress(value, distance);
      // Ivan compares against the leading human, or the last ranked CPU in an exhibition.
      const ranked = i === 3 ? nativeOrder(trucks, paceOrder, distance) : [];
      const challenger =
        ranked.find((slot) => !botSlots[slot] && !trucks[slot]!.cpu) ??
        ranked.at(-1);
      const leader = challenger === undefined ? undefined : trucks[challenger];
      const base = t.cpuBase ?? offroadStartingLevel(track.name, i, botSlots);
      const cpu = driveOffroadCpu(
        track.name,
        t.cpu,
        {
          ...t.motion,
          region: t.checkpoint,
          difficulty: base,
          ...(leader && i === 3
            ? {
                catchupLevel: offroadCatchupLevel(
                  base,
                  t.laps,
                  normalize(t.dosProgress) >>> 8,
                  leader.laps,
                  normalize(leader.dosProgress) >>> 8,
                ),
                repeatedCatchupLevel: offroadCatchupLevel(
                  base,
                  t.laps,
                  normalize(normalize(t.dosProgress)) >>> 8,
                  leader.laps,
                  normalize(normalize(leader.dosProgress)) >>> 8,
                ),
              }
            : {}),
        },
        rng,
      );
      rng = cpu.seed;
      if (i === 3 && leader) {
        if (cpu.paceCount) paceOrder = ranked;
        for (let pace = 0; pace < cpu.paceCount; pace++) {
          for (let j = 0; j < trucks.length; j++)
            trucks[j] = {
              ...trucks[j]!,
              dosProgress: normalize(trucks[j]!.dosProgress),
            };
        }
      }
      t = { ...trucks[i]!, cpu: cpu.state, cpuBase: base };
      input = {
        ...NEUTRAL_INPUT,
        gas: cpu.input.gas,
        nitro: cpu.input.nitro,
        left: cpu.input.steer < 0,
        right: cpu.input.steer > 0,
      };
    }
    const [moved, nextSeed] = driveTruck(track, t, input, tick, rng);
    rng = nextSeed;
    if (moved.wallTicks === 1)
      events.push({ tick, type: "wall", slot: t.slot });
    if (t.airborneUntilTick && !moved.airborneUntilTick)
      events.push({ tick, type: "land", slot: t.slot });
    trucks[i] = applyCheckpoints(
      prev[i]!,
      { ...moved, contactMask: masks[i]! },
      track,
      tick,
      events,
      state,
    );
  }
  const finishing = trucks.some((t) => t.finishedTick === tick);
  if (finishing)
    paceOrder = nativeOrder(
      trucks,
      paceOrder,
      getOffroadCourse(track.name).lapDistance,
    );
  const placements = finishing ? paceOrder : rank(trucks, state.placements);
  let raceEndTick = state.raceEndTick;
  for (const t of trucks) {
    if (t.finishedTick === tick) {
      events.push({
        tick,
        type: "finish",
        slot: t.slot,
        place: placements.indexOf(t.slot) + 1,
      });
      if (!raceEndTick) raceEndTick = tick;
    }
  }
  const phase: Phase = raceEndTick ? "finished" : "racing";

  return {
    state: {
      ...state,
      tick,
      rngState: rng,
      pickups: pickup.state,
      ...(battle ? { battle } : {}),
      trucks,
      placements,
      paceOrder,
      raceEndTick,
      phase,
    },
    events,
  };
}
