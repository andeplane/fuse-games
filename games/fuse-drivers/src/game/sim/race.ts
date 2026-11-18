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
import { closestOnSegment, crosses, reaches } from "./geometry.js";
import { NEUTRAL_INPUT, type TruckInput } from "./input.js";
import type { Drone, Mine, Missile, OilSlick } from "./items.js";
import type { ItemKind, Truck } from "./truck.js";
import type { Point, Track } from "./track.js";
import { atan2, cos, hypot, sin } from "./deterministic-math.js";
import { driveTruck, placeTruck, startTruck } from "./drive.js";
import {
  getOffroadCourse,
  isOffroadCourse,
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

export { crosses } from "./geometry.js";

export type Phase = "countdown" | "racing" | "finished";

/** Plain JSON race snapshot (ADR 002). */
export interface RaceState {
  tick: number;
  phase: Phase;
  rngState: number;
  pickups: OffroadPickups;
  trackName: string;
  trucks: Truck[];
  countdownEndTick: number;
  raceEndTick: number;
  /** Slots ordered by placement, best first. */
  placements: number[];
  missiles: Missile[];
  mines: Mine[];
  oils: OilSlick[];
  drones: Drone[];
  /** Per box, per slot: tick until which that box is inert for that truck; flat [box * slots + slot]. */
  boxCooldowns: number[];
  /** Whether each slot held the item button last tick, for edge detection. */
  itemHeld: boolean[];
  nextId: number;
}

export type RaceEvent =
  | { tick: number; type: "lap"; slot: number; lap: number }
  | { tick: number; type: "finish"; slot: number; place: number }
  | { tick: number; type: "wrongWay"; slot: number }
  | { tick: number; type: "wall"; slot: number }
  | { tick: number; type: "land"; slot: number }
  | { tick: number; type: "start" }
  | { tick: number; type: "pickup"; slot: number; item: ItemKind }
  | { tick: number; type: "fire"; slot: number; item: ItemKind }
  | {
      tick: number;
      type: "hit";
      slot: number;
      by: number;
      item: ItemKind | "landing";
      absorbed: boolean;
    }
  | { tick: number; type: "kill"; slot: number; by: number };

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
): RaceState {
  let rng = seed & 0xffff;
  const trucks = stats.map((s, i) => {
    let truck = startTruck(
      track,
      i,
      s,
      botSlots[i] === true,
      drivers[i],
      gridOrder?.[i],
    );
    if (!isOffroadCourse(track.name)) return truck;
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
    if (botSlots[i]) {
      const difficulty = offroadStartingLevel(
        track.name,
        i,
        botSlots,
        campaignIndex,
      );
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
  return {
    tick: 0,
    phase: "countdown",
    rngState: rng,
    pickups: initialOffroadPickups(),
    trackName: track.name,
    trucks,
    countdownEndTick: config.countdownTicks,
    raceEndTick: 0,
    placements: trucks.map((t) => t.slot),
    missiles: [],
    mines: [],
    oils: [],
    drones: [],
    boxCooldowns: Array(track.items.length * trucks.length).fill(0),
    itemHeld: trucks.map(() => false),
    nextId: 1,
  };
}

const dot = (ax: number, ay: number, bx: number, by: number) =>
  ax * bx + ay * by;

function resolveWalls(
  t: Truck,
  from: Point,
  track: Track,
  wasTouching: boolean,
): [Truck, boolean] {
  const r = config.truck.radius;
  let x = t.x,
    y = t.y,
    touched = false;
  // A wall far from this tick's path cannot touch the truck, and rejecting it by its box costs four
  // comparisons instead of a distance and a crossing test. The margin covers the radius and the push a
  // resolved wall gives on the second pass, so the walls that resolve are the ones a full scan resolves.
  const margin = r * 4;
  const boxX0 = Math.min(from.x, x) - margin,
    boxX1 = Math.max(from.x, x) + margin;
  const boxY0 = Math.min(from.y, y) - margin,
    boxY1 = Math.max(from.y, y) + margin;
  for (let pass = 0; pass < 2; pass++) {
    for (const w of track.walls) {
      if (w.maxX < boxX0 || w.minX > boxX1 || w.maxY < boxY0 || w.minY > boxY1)
        continue;
      if ((w.under && t.onBridge) || (w.deck && !t.onBridge)) continue;
      const ex = w.b.x - w.a.x,
        ey = w.b.y - w.a.y;
      const startSide =
        Math.sign(ex * (from.y - w.a.y) - ey * (from.x - w.a.x)) || 1;
      const c = closestOnSegment({ x, y }, w);
      const dx = x - c.x,
        dy = y - c.y;
      const d = hypot(dx, dy);
      const tunneled = crosses(from, { x, y }, w);
      if (d >= r && !tunneled) continue;
      touched = true;
      const len = hypot(ex, ey) || 1;
      const nx = (-ey / len) * startSide,
        ny = (ex / len) * startSide;
      // Snap back to the start side only when the path really crossed this segment. Crossing just the infinite line beside a
      // short segment (the sharp tip of a hairpin barrier) would otherwise throw the truck through the neighbouring segments.
      if (tunneled || d < 1e-9) {
        x = c.x + nx * r;
        y = c.y + ny * r;
        continue;
      }
      x += (dx / d) * (r - d);
      y += (dy / d) * (r - d);
    }
  }
  // The 4-unit strip below the map and anything outside it counts as wall (ADR 003).
  const maxX = track.cols * track.tile,
    maxY = track.rows * track.tile;
  if (x < r || y < r || x > maxX - r || y > maxY - r) {
    touched = true;
    x = Math.max(r, Math.min(maxX - r, x));
    y = Math.max(r, Math.min(maxY - r, y));
  }
  if (!touched) return [t.x === x && t.y === y ? t : { ...t, x, y }, false];
  const speed =
    t.speed *
    (wasTouching ? config.truck.wallSlideTick : config.truck.wallFirstHit);
  return [{ ...t, x, y, speed }, true];
}

/** Entering a bridge rectangle across its entry side sets onBridge; leaving the rectangle clears it (ADR 003). */
function updateBridge(t: Truck, prev: Truck, track: Track): Truck {
  let onBridge = t.onBridge;
  for (const b of track.bridges) {
    const inside = t.x >= b.x0 && t.x <= b.x1 && t.y >= b.y0 && t.y <= b.y1;
    const wasInside =
      prev.x >= b.x0 && prev.x <= b.x1 && prev.y >= b.y0 && prev.y <= b.y1;
    if (inside && !wasInside) {
      const fromEntry =
        (b.entry === "left" && prev.x < b.x0) ||
        (b.entry === "right" && prev.x > b.x1) ||
        (b.entry === "top" && prev.y < b.y0) ||
        (b.entry === "bottom" && prev.y > b.y1);
      if (fromEntry) onBridge = true;
    } else if (!inside && wasInside) onBridge = false;
  }
  return onBridge === t.onBridge ? t : { ...t, onBridge };
}

/** Unit tangent of the nearest waypoint segment: the direction the track is meant to be driven here. */
export function trackDirectionAt(track: Track, p: Point): Point {
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
  // `best` is an index into the waypoint ring, which the parser keeps at three points or more.
  const a = wp[best]!,
    b = wp[(best + 1) % wp.length]!;
  const len = hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

export function progressOf(t: Truck, track: Track): number {
  const n = track.checkpoints.length;
  // A truck's checkpoint is always a live index into the ring, and the predecessor is that index modulo n.
  const next = track.checkpoints[t.checkpoint]!;
  const last = track.checkpoints[(t.checkpoint - 1 + n) % n]!;
  const span = hypot(next.mid.x - last.mid.x, next.mid.y - last.mid.y) || 1;
  const d = Math.max(
    0,
    Math.min(1, hypot(next.mid.x - t.x, next.mid.y - t.y) / span),
  );
  return t.laps * n + t.checkpoint + (1 - d);
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
  const course = isOffroadCourse(track.name)
    ? getOffroadCourse(track.name)
    : undefined;
  const x = (prev.motion.x + t.motion.vx) & 0xffff,
    y = (prev.motion.y + t.motion.vy) & 0xffff;
  let progress = t.progress;
  let dosProgress = t.dosProgress;
  if (!t.finishedTick) {
    const cp = track.checkpoints[t.checkpoint]!; // The truck's checkpoint indexes the ring.
    const nextDistance = course
      ? nativeRegionProgress(course.regions[t.checkpoint]!, x, y)
      : null;
    const entered = course ? nextDistance !== null : reaches(prev, t, cp);
    if (course) {
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
    }
    if (entered) {
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
    progress: course ? progress : progressOf(n2, track),
  };
}

export function respawnPose(
  t: Truck,
  track: Track,
): { x: number; y: number; heading: number } {
  const n = track.checkpoints.length;
  const last = track.checkpoints[(t.checkpoint - 1 + n) % n]!;
  const next = track.checkpoints[t.checkpoint]!;
  return {
    x: last.mid.x,
    y: last.mid.y,
    heading: atan2(next.mid.y - last.mid.y, next.mid.x - last.mid.x),
  };
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
): StepResult {
  const tick = state.tick + 1;
  const events: RaceEvent[] = [];
  let rng = state.rngState;

  if (state.phase === "countdown" && tick < state.countdownEndTick)
    return { state: { ...state, tick }, events };
  if (state.phase === "countdown") events.push({ tick, type: "start" });
  if (state.phase === "finished") return { state, events };

  const original = isOffroadCourse(track.name);
  const prev = state.trucks;
  const starting = prev.slice();
  const pickup = stepOffroadPickups(
    state.pickups,
    OFFROAD_COURSE_NAMES.indexOf(track.name) % 8,
    prev.map((t) => t.motion),
    rng,
  );
  rng = pickup.randomSeed;
  const award = pickup.award;
  if (award) {
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
        a.onBridge !== b.onBridge ||
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
    if (original && (botSlots[i] || t.cpu)) {
      const distance = getOffroadCourse(track.name).lapDistance;
      const normalize = (value: number) => offroadPaceProgress(value, distance);
      // Ivan compares against the leading human, or the last ranked CPU in an exhibition.
      const ranked =
        i === 3
          ? state.placements
              .slice()
              .sort(
                (a, b) =>
                  trucks[b]!.laps - trucks[a]!.laps ||
                  normalize(trucks[b]!.dosProgress) -
                    normalize(trucks[a]!.dosProgress),
              )
          : [];
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
    let placed = moved;
    if (!original) {
      // Tiled authoring fixtures express their walls in screen space; native courses probe their contour data.
      const [resolved, touched] = resolveWalls(
        moved,
        t,
        track,
        t.wallTicks > 0,
      );
      const wall = touched
        ? {
            ...resolved,
            wallTicks: t.wallTicks + 1,
            motion: {
              ...resolved.motion,
              x: Math.round(resolved.x * 16),
              y: Math.round(resolved.y * 16),
              speed: Math.round(
                (resolved.speed / resolved.stats.topSpeed) * 134,
              ),
            },
          }
        : resolved;
      placed = updateBridge(wall, t, track);
    }
    trucks[i] = applyCheckpoints(
      prev[i]!,
      { ...placed, contactMask: masks[i]! },
      track,
      tick,
      events,
      state,
    );
  }
  const placements = rank(trucks, state.placements);
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
      trucks,
      placements,
      raceEndTick,
      phase,
    },
    events,
  };
}
