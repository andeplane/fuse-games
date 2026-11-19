import { inPlay, type Arena, type Keeper } from "./arena.js";
import { BLAST_RADIUS } from "./bomb-rules.js";
import { REPLAN_MAX, STUCK_TICKS, noise, type LevelRules } from "./bot-mind.js";
import {
  TASK_NONE,
  drive,
  landing,
  standingOn,
  walk,
  nextEdge,
  type NavGraph,
  type Physics,
} from "./bot-nav.js";
import type { Platform } from "./maps.js";
import { padList } from "./power-ups.js";
import { S, isBallMode, type Input, type World } from "./world.js";

export interface NavigationContext {
  arena: Arena;
  platforms: readonly Platform[];
  graph: NavGraph;
  ph: Physics;
  level: LevelRules;
  beat: number;
}

/** Where a bot stands off from its rival, units: outside the blast, inside a lob. */
const STANDOFF = 200;
/** Clearance kept from a bot's own planned blast, units. */
export const SELF_CLEAR = 60;

/** Rivals a bot can do something about: in play and on the field. */
export const rivals = (k: Keeper, arena: Arena) =>
  arena.keepers.filter((r) => r !== k && inPlay(arena, r) && !r.world.respawn);
/** The ledge a keeper is on, will land on, or hangs nearest above. */
export function ledgeOf(w: World, ctx: NavigationContext): number {
  const here = standingOn(w, ctx.platforms);
  if (here >= 0) return here;
  const below = landing(w, ctx.platforms, ctx.ph);
  if (below >= 0) return below;
  let best = -1,
    d = Infinity;
  ctx.platforms.forEach(([px, py, width], i) => {
    const dx = Math.max(0, px * S - w.x, w.x - (px + width) * S),
      dy = Math.abs(py * S - w.feet),
      value = dx + dy;
    if (value < d) {
      best = i;
      d = value;
    }
  });
  return best;
}
/**
 * Power-up pads a bot may walk to, the one place bots read pads: every ready
 * pad, whatever it shows (11D), from the pads' own read.
 */
export function botPads(arena: Arena): { x: number; y: number }[] {
  return padList(arena).flatMap((pad) =>
    pad.ready ? [{ x: pad.x, y: pad.y }] : [],
  );
}
/** The ledge a pad sits on, or −1. */
function padLedge(platforms: readonly Platform[], x: number, y: number) {
  return platforms.findIndex(
    ([px, py, width]) => py >= y && py <= y + 40 && x >= px && x <= px + width,
  );
}
const inside = (p: Platform, x: number, inset = 24) =>
  Math.max(p[0] + inset, Math.min(p[0] + p[2] - inset, x));

interface Goal {
  goal: number;
  goalX: number;
  rival: number;
}

function firstReachablePad(
  ctx: NavigationContext,
  travel: (p: number, x: number) => number,
): Goal | undefined {
  for (const pad of botPads(ctx.arena)) {
    const goal = padLedge(ctx.platforms, pad.x, pad.y);
    if (goal >= 0 && travel(goal, pad.x) <= ctx.level.pads)
      return { goal, goalX: pad.x, rival: -1 };
  }
}

function ballGoal(
  k: Keeper,
  ctx: NavigationContext,
  here: number,
): Goal | undefined {
  const { arena, platforms, graph } = ctx;
  const balls = arena.combat.balls;
  if (
    !isBallMode(arena.tuning.experiment) ||
    !balls.length ||
    noise(k.id, Math.floor(ctx.beat / 40), 2) >= 0.5
  )
    return undefined;
  const w = k.world;
  const distance = (b: { x: number; y: number }) =>
    Math.abs(b.x - w.x) + Math.abs(b.y - w.feet);
  const ball = balls.reduce((a, b) => (distance(b) < distance(a) ? b : a));
  const goal = ledgeOf(
    { ...w, x: ball.x, feet: ball.y, vx: 0, vy: 0, grounded: false },
    ctx,
  );
  if (goal < 0 || !Number.isFinite(graph.dist[here]![goal]!)) return undefined;
  return {
    goal,
    goalX: Math.round(inside(platforms[goal]!, ball.x / S)),
    rival: -1,
  };
}

function chooseRival(
  k: Keeper,
  ctx: NavigationContext,
  travel: (p: number, x: number) => number,
): Keeper | undefined {
  let target: Keeper | undefined;
  let cost = Infinity;
  for (const r of rivals(k, ctx.arena)) {
    const p = ledgeOf(r.world, ctx);
    if (p < 0) continue;
    const c =
      travel(p, r.world.x / S) -
      (r.slot === k.mind!.rival ? 60 : 0) +
      noise(k.id, ctx.beat, 10 + r.slot) * (ctx.level.lead ? 60 : 240);
    if (Number.isFinite(c) && c < cost) {
      target = r;
      cost = c;
    }
  }
  return target;
}

function standoffGoal(
  k: Keeper,
  target: Keeper,
  ctx: NavigationContext,
  here: number,
): Goal | undefined {
  // Choose a reachable ledge at the preferred distance from the rival.
  const rw = target.world;
  const side = Math.sign(k.world.x - rw.x) || (k.slot % 2 ? 1 : -1);
  const px = rw.x / S + side * STANDOFF;
  const feet = rw.feet / S;
  let goal = -1;
  let goalX = 0;
  let best = Infinity;
  ctx.platforms.forEach((p, i) => {
    if (!Number.isFinite(ctx.graph.dist[here]![i]!)) return;
    const x = inside(p, px);
    const dx = x - rw.x / S;
    const dy = p[1] - feet;
    const off = Math.abs(x - px) + Math.abs(dy) * 0.5;
    const near =
      Math.sqrt(dx * dx + dy * dy) < BLAST_RADIUS + SELF_CLEAR ? 400 : 0;
    if (off + near < best) {
      goal = i;
      goalX = Math.round(x);
      best = off + near;
    }
  });
  return goal >= 0 ? { goal, goalX, rival: target.slot } : undefined;
}

function chooseGoal(k: Keeper, ctx: NavigationContext): void {
  const here = ledgeOf(k.world, ctx);
  if (here < 0) return;
  const travel = (p: number, x: number) =>
    ctx.graph.dist[here]![p]! + Math.abs(k.world.x - x * S) / ctx.ph.run;
  const nearby = firstReachablePad(ctx, travel) ?? ballGoal(k, ctx, here);
  if (nearby) {
    Object.assign(k.mind!, nearby);
    return;
  }
  const target = chooseRival(k, ctx, travel);
  const standoff = target && standoffGoal(k, target, ctx, here);
  if (standoff) Object.assign(k.mind!, standoff);
  else wander(k, ctx);
}
function wander(k: Keeper, ctx: NavigationContext): void {
  const p = Math.floor(
      noise(k.id, ctx.beat, 3) * ctx.platforms.length,
    ) as number,
    [px, , width] = ctx.platforms[p]!;
  Object.assign(k.mind!, {
    goal: p,
    goalX: Math.round(px + width / 2),
    rival: -1,
  });
}

export function navigate(k: Keeper, ctx: NavigationContext): Input {
  const w = k.world,
    m = k.mind!,
    { platforms, graph, ph } = ctx,
    here = standingOn(w, platforms);
  if (here >= 0 && m.edge >= 0 && graph.edges[m.edge]?.to === here) m.timer = 0;
  if (m.timer >= STUCK_TICKS) {
    wander(k, ctx);
    m.timer = 0;
    m.replan = Math.min(REPLAN_MAX, ctx.level.replan * 3);
  } else if (m.replan === 0 || m.goal < 0) {
    chooseGoal(k, ctx);
    m.replan = ctx.level.replan;
  }
  if (here >= 0 && m.goal >= 0) {
    if (here === m.goal) m.edge = -1;
    else if (graph.edges[m.edge]?.from !== here) {
      m.edge = nextEdge(graph, here, w.x, m.goal, ph);
      if (m.edge < 0) m.goal = -1;
    }
  }
  const input = drive(
    w,
    m,
    graph.edges,
    platforms,
    ph,
    k.power.kind === "dash",
  );
  if (here >= 0 && here === m.goal && m.task === TASK_NONE) {
    input.move = walk(w, m.goalX * S, ph);
    if (Math.abs(w.x - m.goalX * S) < 24 * S) m.timer = 0;
  }
  return input;
}
