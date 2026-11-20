/**
 * AI keepers (11C). Once per log tick, before the fold steps the arena, each
 * bot's ordinary Input is computed from the arena alone: where to go (a rival,
 * a pad, a ball), how to get there (the navigation graph and its pilot), when
 * to throw (a ballistic solve checked against the real bomb flight), when to
 * hook (a rival near an edge, an orb) and how to get out of a blast (the
 * bot's own body flown through the real keeper step). Bots get no privileged
 * physics, and nothing here is kept outside the room: what a bot remembers is
 * its checkpointed mind, and its chance is noise hashed from its id and the
 * tick. Every peer computes the same inputs; no peer sends them.
 */
import { inPlay, type Arena, type Keeper } from "./arena.js";
import { NEUTRAL, S, BALL_RADII, type Input } from "./world.js";
import { MAPS, type Platform } from "./maps.js";
import { navigate, rivals } from "./bot-goal.js";
import { dodge, threatOf, type SafetyContext } from "./bot-safety.js";
import { planThrow } from "./bot-throw.js";
import { sweep } from "./collision.js";
import {
  chestOf,
  navGraph,
  physics,
  standingOn,
  TASK_NONE,
  TASK_STRIKE,
} from "./bot-nav.js";
import { BOT_LEVELS, STUCK_TICKS, noise, type Mind } from "./bot-mind.js";

export { botPads } from "./bot-goal.js";

/** A hesitation lasts this many log ticks (one second). */
const BLUNDER_BEATS = 20;
/**
 * The inputs every connected bot plays this log tick, by keeper id. Call once
 * per log tick, before stepping; it updates each bot's mind.
 */
export function planBots(arena: Arena): Map<string, Input> {
  const out = new Map<string, Input>(),
    bots = arena.keepers.filter((k) => k.mind);
  if (!bots.length) return out;
  const t = arena.tuning,
    ctx: SafetyContext = {
      arena,
      platforms: MAPS[t.map].platforms,
      graph: navGraph(t),
      ph: physics(t),
      level: BOT_LEVELS[t.botLevel],
      threats: arena.bombs.map((b) => threatOf(b, t)),
      beat: Math.floor(arena.tick / 3),
    };
  for (const k of bots) out.set(k.id, sanitize(think(k, ctx)));
  return out;
}

/** An Input the room would accept: integer aim in bounds, never a reset. */
function sanitize(i: Input): Input {
  const aim = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : 0)));
  return {
    move: i.move > 0 ? 1 : i.move < 0 ? -1 : 0,
    jump: !!i.jump,
    drop: !!i.drop,
    fire: !!i.fire,
    bomb: !!i.bomb,
    cancelBomb: false,
    reset: false,
    aimX: aim(i.aimX, -2000, 3600),
    aimY: aim(i.aimY, -4000, 3000),
  };
}
/** Forget a manoeuvre; a bot out of play starts over when it returns. */
function settle(m: Mind): void {
  Object.assign(m, {
    edge: -1,
    hop: -1,
    task: TASK_NONE,
    hold: 0,
    goal: -1,
    replan: 0,
  });
}

function think(k: Keeper, ctx: SafetyContext): Input {
  const w = k.world,
    m = k.mind!,
    idle: Input = { ...NEUTRAL, aimX: w.input.aimX, aimY: w.input.aimY };
  if (!inPlay(ctx.arena, k) || w.respawn) {
    settle(m);
    return idle;
  }
  m.replan = Math.max(0, m.replan - 1);
  m.timer = Math.min(STUCK_TICKS, m.timer + 1);
  // A hesitation: nothing new, though a wound-up bomb stays held.
  if (noise(k.id, Math.floor(ctx.beat / BLUNDER_BEATS), 1) < ctx.level.blunder)
    return { ...idle, bomb: w.input.bomb && w.charge > 0 };
  let input = navigate(k, ctx);
  input = hookShot(k, ctx, input);
  input = planThrow(k, ctx, input);
  return dodge(k, ctx, input);
}

/** Line of sight for a hook from (x, y) to (tx, ty), subunits. */
const clear = (
  platforms: readonly Platform[],
  x: number,
  y: number,
  tx: number,
  ty: number,
) => !sweep(x, y, tx - x, ty - y, false, platforms);
function hookShot(k: Keeper, ctx: SafetyContext, input: Input): Input {
  const w = k.world,
    m = k.mind!,
    h = w.hook;
  if (m.task === TASK_STRIKE) {
    if (h.phase === "flying") return { ...input, fire: true };
    m.task = TASK_NONE;
    return { ...input, fire: false };
  }
  if (
    m.task !== TASK_NONE ||
    h.phase !== "ready" ||
    w.input.fire ||
    input.fire ||
    w.charge ||
    m.hold ||
    !w.grounded ||
    ctx.beat % ctx.level.attack !== k.slot % ctx.level.attack
  )
    return input;
  const aim = strikeAim(k, ctx);
  if (!aim) return input;
  m.task = TASK_STRIKE;
  return { ...input, fire: true, aimX: aim.x, aimY: aim.y };
}
interface HookAim {
  d: number;
  x: number;
  y: number;
}
interface HookSight {
  reach: number;
  lead(x: number, y: number, vx: number, vy: number): HookAim;
  clear(aim: HookAim): boolean;
}

/** Orb targets take precedence over keepers, and equal distances keep first sight. */
function strikeAim(
  k: Keeper,
  ctx: SafetyContext,
): { x: number; y: number } | undefined {
  const sx = k.world.x;
  const sy = chestOf(k.world);
  const sight: HookSight = {
    reach: Math.min(ctx.ph.range - 40 * S, 480 * S),
    lead(x, y, vx, vy) {
      const d = Math.sqrt((x - sx) * (x - sx) + (y - sy) * (y - sy));
      const t = d / (32 * S);
      return { d, x: x + vx * t, y: y + vy * t };
    },
    clear: (aim) => clear(ctx.platforms, sx, sy, aim.x, aim.y),
  };
  const best = orbAim(k, ctx, sight) ?? rivalAim(k, ctx, sight);
  return best && { x: Math.round(best.x / S), y: Math.round(best.y / S) };
}

function orbAim(
  k: Keeper,
  ctx: SafetyContext,
  sight: HookSight,
): HookAim | undefined {
  if (noise(k.id, ctx.beat, 4) >= ctx.level.strike + 0.3) return undefined;
  let best: HookAim | undefined;
  for (const ball of ctx.arena.combat.balls) {
    const aim = sight.lead(ball.x, ball.y, ball.vx, ball.vy);
    if (
      aim.d <= sight.reach + BALL_RADII[ball.tier]! * S &&
      (!best || aim.d < best.d) &&
      sight.clear(aim)
    )
      best = aim;
  }
  return best;
}

function worthwhileRival(
  k: Keeper,
  rival: Keeper,
  ctx: SafetyContext,
): boolean {
  const rw = rival.world;
  const ledge = standingOn(rw, ctx.platforms);
  if (ledge < 0) return false;
  const [px, , width] = ctx.platforms[ledge]!;
  const edge = rw.x > k.world.x ? (px + width) * S - rw.x : rw.x - px * S;
  const chance = noise(k.id, ctx.beat, 20 + rival.slot);
  return (
    (edge < 70 * S && chance < ctx.level.strike) ||
    (ctx.arena.tuning.rules === "score" && chance < ctx.level.strike * 0.5) ||
    chance < ctx.level.strike * 0.1
  );
}

function rivalAim(
  k: Keeper,
  ctx: SafetyContext,
  sight: HookSight,
): HookAim | undefined {
  let best: HookAim | undefined;
  for (const rival of rivals(k, ctx.arena)) {
    // Spawn protection lets a hook pass through; a Shield only stops blasts.
    if (rival.spawnGuard) continue;
    const rw = rival.world;
    const aim = sight.lead(rw.x, rw.feet - 28 * S, rw.vx, rw.vy);
    if (aim.d > sight.reach || (best && aim.d >= best.d)) continue;
    if (worthwhileRival(k, rival, ctx) && sight.clear(aim)) best = aim;
  }
  return best;
}
