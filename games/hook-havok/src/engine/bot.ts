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
import { ledgeOf, navigate, rivals, SELF_CLEAR } from "./bot-goal.js";
export { botPads } from "./bot-goal.js";
import { dodge, gap, threatOf, type SafetyContext } from "./bot-safety.js";
import { sweep } from "./collision.js";
import { bombLaunch, bombPath, bombSpawn, touches } from "./bomb.js";
import {
  BLAST_RADIUS,
  BOMB_RADIUS,
  CARRY,
  CHARGE_TICKS,
  FULL_SPEED,
  FUSE_TICKS,
  MAX_BOMBS,
  TAP_SPEED,
} from "./bomb-rules.js";
import {
  chestOf,
  navGraph,
  physics,
  standingOn,
  TASK_NONE,
  TASK_STRIKE,
} from "./bot-nav.js";
import { BOT_LEVELS, STUCK_TICKS, noise, type Mind } from "./bot-mind.js";

/** A hesitation lasts this many log ticks (one second). */
const BLUNDER_BEATS = 20;
/** Charges a throw plan tries (ticks; a bot's hold rises three a log tick). */
const PLAN_CHARGES = [9, 18, 27, CHARGE_TICKS];

/** Where a throw's blast comes from: the fuse's end, or a cluster bomb's split point. */
function blastPoint(
  flight: ReturnType<typeof bombPath>,
  cluster: boolean,
): { x: number; y: number } | undefined {
  const { path, contact } = flight;
  if (cluster && contact >= 0) return path[contact];
  return path.length === FUSE_TICKS ? path[FUSE_TICKS - 1] : undefined;
}
/** The bomb a release now would throw is a cluster bomb. */
const throwsCluster = (k: Keeper) =>
  k.power.kind === "cluster" && k.power.charges > 0;

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
  input = bombing(k, ctx, input);
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
/** Where to shoot the hook: an orb in reach, or a rival worth knocking off. */
function strikeAim(
  k: Keeper,
  ctx: SafetyContext,
): { x: number; y: number } | undefined {
  const w = k.world,
    { platforms, ph, level, arena } = ctx,
    sx = w.x,
    sy = chestOf(w),
    reach = Math.min(ph.range - 40 * S, 480 * S);
  const lead = (x: number, y: number, vx: number, vy: number) => {
    const d = Math.sqrt((x - sx) * (x - sx) + (y - sy) * (y - sy)),
      t = d / (32 * S);
    return { d, x: x + vx * t, y: y + vy * t };
  };
  let best: { d: number; x: number; y: number } | undefined;
  if (noise(k.id, ctx.beat, 4) < level.strike + 0.3)
    for (const ball of arena.combat.balls) {
      const p = lead(ball.x, ball.y, ball.vx, ball.vy);
      if (
        p.d <= reach + BALL_RADII[ball.tier]! * S &&
        (!best || p.d < best.d) &&
        clear(platforms, sx, sy, p.x, p.y)
      )
        best = p;
    }
  if (!best)
    for (const r of rivals(k, arena)) {
      // Spawn protection lets a hook pass through; a Shield only stops blasts.
      if (r.spawnGuard) continue;
      const rw = r.world,
        p = lead(rw.x, rw.feet - 28 * S, rw.vx, rw.vy);
      if (p.d > reach || (best && p.d >= best.d)) continue;
      // Worth it next to the edge the hook would push them over, or for points.
      const ledge = standingOn(rw, platforms);
      if (ledge < 0) continue;
      const [px, , width] = platforms[ledge]!,
        edge = rw.x > w.x ? (px + width) * S - rw.x : rw.x - px * S,
        chance = noise(k.id, ctx.beat, 20 + r.slot);
      const worth =
        (edge < 70 * S && chance < level.strike) ||
        (arena.tuning.rules === "score" && chance < level.strike * 0.5) ||
        chance < level.strike * 0.1;
      if (worth && clear(platforms, sx, sy, p.x, p.y)) best = p;
    }
  return best && { x: Math.round(best.x / S), y: Math.round(best.y / S) };
}

/** Unit direction of a throw from (sx, sy) that passes (tx, ty), low or high arc; subunits. */
function ballistic(
  sx: number,
  sy: number,
  vx: number,
  vy: number,
  tx: number,
  ty: number,
  charge: number,
  arc: number,
  g: number,
): { x: number; y: number } | undefined {
  const t = Math.max(0, Math.min(1, (charge - 1) / (CHARGE_TICKS - 1))),
    speed = ((TAP_SPEED + (FULL_SPEED - TAP_SPEED) * t) * S) / 60,
    cx = vx * CARRY,
    cy = vy * CARRY;
  // Launch velocity to be at the target after n flights, less the carry.
  const need = (n: number) => ({
    x: (tx - sx) / n - cx,
    y: (ty - sy - (g * n * (n + 1)) / 2) / n - cy,
  });
  const excess = (n: number) => {
    const v = need(n);
    return Math.sqrt(v.x * v.x + v.y * v.y) - speed;
  };
  let before = excess(1),
    root = -1;
  for (let n = 2; n <= FUSE_TICKS && root < 0; n++) {
    const now = excess(n);
    if (arc ? before <= 0 && now > 0 : before > 0 && now <= 0)
      root = n - 1 + before / (before - now);
    before = now;
  }
  if (root < 0) return;
  const v = need(root),
    d = Math.sqrt(v.x * v.x + v.y * v.y);
  return d ? { x: v.x / d, y: v.y / d } : undefined;
}
interface Throw {
  aimX: number;
  aimY: number;
  x: number;
  y: number;
  miss: number;
}
/**
 * A throw at `charge` along `arc` whose blast lands on `target`: solved
 * ballistically, flown with the real launch and bomb flight (bounces and all),
 * and corrected twice for where it actually ends up. A cluster bomb's blast
 * is taken where it splits.
 */
function throwAt(
  k: Keeper,
  charge: number,
  arc: number,
  target: Keeper,
  ctx: SafetyContext,
  tries = 3,
): Throw | undefined {
  const t = ctx.arena.tuning,
    w = k.world,
    cluster = throwsCluster(k),
    sx = w.x,
    sy = chestOf(w),
    rw = target.world,
    tx = rw.x + rw.vx * 20 * ctx.level.lead,
    ledge = ledgeOf(rw, ctx),
    ty =
      (ledge >= 0 ? ctx.platforms[ledge]![1] * S : rw.feet) -
      BOMB_RADIUS * S -
      S;
  let gx = tx,
    best: Throw | undefined;
  for (let i = 0; i < tries; i++) {
    const dir = ballistic(
      sx,
      sy,
      w.vx,
      w.vy,
      gx,
      ty,
      charge,
      arc,
      ctx.ph.gravity,
    );
    if (!dir) break;
    const aimX = Math.round((sx + dir.x * 400 * S) / S),
      aimY = Math.round((sy + dir.y * 400 * S) / S),
      v = bombLaunch(charge, sx, sy, w.vx, w.vy, aimX, aimY, w.facing),
      flight = bombPath(
        { ...bombSpawn(sx, sy, t.map), vx: v.vx, vy: v.vy },
        FUSE_TICKS,
        t,
      );
    let end = blastPoint(flight, cluster);
    if (t.bomb === "impact") {
      const hit = flight.path.findIndex((p) =>
        touches(rw, p.x, p.y, BOMB_RADIUS * S),
      );
      // A cluster bomb that splits first never reaches the rival whole.
      if (hit >= 0 && !(cluster && flight.contact >= 0 && flight.contact < hit))
        end = flight.path[hit];
    }
    if (!end) break;
    const miss = gap({ x: tx, feet: rw.feet }, end.x, end.y);
    if (!best || miss < best.miss)
      best = { aimX, aimY, x: end.x, y: end.y, miss };
    if (miss <= 8 * S) break;
    gx += tx - end.x;
  }
  return best;
}
function targetsFor(k: Keeper, ctx: SafetyContext): Keeper[] {
  const w = k.world;
  return rivals(k, ctx.arena)
    .filter((r) => {
      const dx = Math.abs(r.world.x - w.x),
        dy = r.world.feet - w.feet;
      return (
        dx <= 560 * S &&
        dy >= -420 * S &&
        dy <= 360 * S &&
        dx + Math.abs(dy) > (BLAST_RADIUS + 40) * S
      );
    })
    .sort(
      (a, b) =>
        Math.abs(a.world.x - w.x) +
          Math.abs(a.world.feet - w.feet) -
          (Math.abs(b.world.x - w.x) + Math.abs(b.world.feet - w.feet)) ||
        a.slot - b.slot,
    );
}
function bombing(k: Keeper, ctx: SafetyContext, input: Input): Input {
  const w = k.world,
    m = k.mind!,
    kit = k.bomb,
    arena = ctx.arena;
  if (arena.tuning.bomb === "off") {
    m.hold = 0;
    return input;
  }
  const windUp = {
    bomb: true,
    move: 0,
    jump: false,
    drop: false,
    fire: false,
  } as const;
  if (m.hold > 0) {
    if (w.charge < m.hold) {
      // The hold never took (still cooling down): give it up.
      if (w.input.bomb && !w.charge && kit.cooldown) {
        m.hold = 0;
        return { ...input, bomb: false };
      }
      // Winding up: hold still until the charge reaches the plan.
      return { ...input, ...windUp };
    }
    m.hold = 0;
    const aim = release(k, ctx);
    return { ...input, bomb: false, aimX: aim.aimX, aimY: aim.aimY };
  }
  if (w.charge > 0) {
    // A charge without a plan (a hesitation, a dodge): throw it well.
    const aim = release(k, ctx);
    return { ...input, bomb: false, aimX: aim.aimX, aimY: aim.aimY };
  }
  if (
    kit.cooldown ||
    !w.grounded ||
    m.task !== TASK_NONE ||
    w.hook.phase !== "ready" ||
    input.fire ||
    arena.bombs.length >= MAX_BOMBS ||
    arena.bombs.some((b) => b.owner === k.id) ||
    ctx.beat % ctx.level.attack !== k.slot % ctx.level.attack
  )
    return input;
  const targets = targetsFor(k, ctx);
  const r = targets[ctx.beat % Math.min(2, targets.length || 1)];
  if (!r) return input;
  const radius = BLAST_RADIUS * S;
  let best: { charge: number; arc: number; miss: number } | undefined;
  for (const charge of PLAN_CHARGES)
    for (const arc of [1, 0]) {
      const plan = throwAt(k, charge, arc, r, ctx, 2);
      if (
        plan &&
        (!best || plan.miss < best.miss) &&
        gap(w, plan.x, plan.y) > radius + SELF_CLEAR * S
      )
        best = { charge, arc, miss: plan.miss };
    }
  if (!best || best.miss > radius * ctx.level.accept) return input;
  Object.assign(m, { hold: best.charge, arc: best.arc, rival: r.slot });
  return { ...input, ...windUp };
}
/** The aim a release uses now: at the planned rival with the level's error, or a lob away from itself. */
function release(
  k: Keeper,
  ctx: SafetyContext,
): { aimX: number; aimY: number } {
  const w = k.world,
    m = k.mind!,
    charge = Math.max(1, w.charge),
    targets = targetsFor(k, ctx),
    r = targets.find((t) => t.slot === m.rival) ?? targets[0];
  const sx = w.x,
    sy = chestOf(w);
  let aim: { aimX: number; aimY: number } | undefined;
  if (r) {
    const plan =
      throwAt(k, charge, m.arc, r, ctx) ??
      throwAt(k, charge, 1 - m.arc, r, ctx);
    if (plan && gap(w, plan.x, plan.y) > BLAST_RADIUS * S) aim = plan;
  }
  if (!aim) {
    // Nothing worth hitting: lob it toward the open side, the farther landing.
    const t = ctx.arena.tuning;
    let far = -1;
    for (const side of [-1, 1]) {
      const aimX = Math.round(sx / S + side * 200),
        aimY = Math.round(sy / S - 346),
        v = bombLaunch(charge, sx, sy, w.vx, w.vy, aimX, aimY, w.facing),
        end = blastPoint(
          bombPath(
            { ...bombSpawn(sx, sy, t.map), vx: v.vx, vy: v.vy },
            FUSE_TICKS,
            t,
          ),
          throwsCluster(k),
        ),
        // A bomb that falls out of the arena harms nobody.
        d = end ? gap(w, end.x, end.y) : Infinity;
      if (d > far) {
        far = d;
        aim = { aimX, aimY };
      }
    }
    return aim!;
  }
  // The level's error: a sideways nudge of the aim direction.
  const dx = aim.aimX * S - sx,
    dy = aim.aimY * S - sy,
    e = (noise(k.id, k.bomb.thrown, 7) * 2 - 1) * ctx.level.aimError;
  return {
    aimX: Math.round((sx + dx - dy * e) / S),
    aimY: Math.round((sy + dy + dx * e) / S),
  };
}
