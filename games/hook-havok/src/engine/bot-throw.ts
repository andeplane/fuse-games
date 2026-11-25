import type { Keeper } from "./arena.js";
import { S, type Input } from "./world.js";
import { chestOf, TASK_NONE } from "./bot-nav.js";
import {
  ledgeOf,
  rivals,
  SELF_CLEAR,
  type NavigationContext,
} from "./bot-goal.js";
import { gap } from "./bot-safety.js";
import { noise } from "./bot-mind.js";
import { bombLaunch, bombSpawn, predictedBlast } from "./bomb.js";
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

/** Charges a throw plan tries (ticks; a bot's hold rises three a log tick). */
const PLAN_CHARGES = [9, 18, 27, CHARGE_TICKS];

/** The bomb a release now would throw is a cluster bomb. */
const throwsCluster = (k: Keeper) =>
  k.power.kind === "cluster" && k.power.charges > 0;

/** Unit direction of a throw from (sx, sy) that passes (tx, ty), low or high arc; subunits. */
function ballistic(
  origin: { x: number; y: number; vx: number; vy: number },
  target: { x: number; y: number },
  charge: number,
  arc: number,
  gravity: number,
): { x: number; y: number } | undefined {
  const { x: sx, y: sy, vx, vy } = origin;
  const { x: tx, y: ty } = target;
  const g = gravity;
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
  ctx: NavigationContext,
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
      { x: sx, y: sy, vx: w.vx, vy: w.vy },
      { x: gx, y: ty },
      charge,
      arc,
      ctx.ph.gravity,
    );
    if (!dir) break;
    const aimX = Math.round((sx + dir.x * 400 * S) / S),
      aimY = Math.round((sy + dir.y * 400 * S) / S),
      v = bombLaunch(charge, sx, sy, w.vx, w.vy, aimX, aimY, w.facing),
      end = predictedBlast(
        { ...bombSpawn(sx, sy, t.map), vx: v.vx, vy: v.vy },
        t,
        cluster,
        t.bomb === "impact" ? rw : undefined,
      );
    if (!end) break;
    const miss = gap({ x: tx, feet: rw.feet }, end.x, end.y);
    if (!best || miss < best.miss)
      best = { aimX, aimY, x: end.x, y: end.y, miss };
    if (miss <= 8 * S) break;
    gx += tx - end.x;
  }
  return best;
}
function targetsFor(k: Keeper, ctx: NavigationContext): Keeper[] {
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
function canStartThrow(
  k: Keeper,
  ctx: NavigationContext,
  input: Input,
): boolean {
  const { world: w, bomb: kit, mind: m } = k;
  const arena = ctx.arena;
  return !(
    kit.cooldown ||
    !w.grounded ||
    m!.task !== TASK_NONE ||
    w.hook.phase !== "ready" ||
    input.fire ||
    arena.bombs.length >= MAX_BOMBS ||
    arena.bombs.some((b) => b.owner === k.id) ||
    ctx.beat % ctx.level.attack !== k.slot % ctx.level.attack
  );
}

export function planThrow(
  k: Keeper,
  ctx: NavigationContext,
  input: Input,
): Input {
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
  if (m.hold > 0 && w.charge < m.hold) {
    // The hold never took (still cooling down): give it up.
    if (w.input.bomb && !w.charge && kit.cooldown) {
      m.hold = 0;
      return { ...input, bomb: false };
    }
    return { ...input, ...windUp };
  }
  if (m.hold > 0 || w.charge > 0) {
    if (m.hold > 0) m.hold = 0;
    const aim = release(k, ctx);
    return { ...input, bomb: false, aimX: aim.aimX, aimY: aim.aimY };
  }
  if (!canStartThrow(k, ctx, input)) return input;
  const targets = targetsFor(k, ctx);
  const r = targets[ctx.beat % Math.min(2, targets.length || 1)];
  if (!r) return input;
  const best = chooseThrow(k, r, ctx);
  if (!best || best.miss > BLAST_RADIUS * S * ctx.level.accept) return input;
  Object.assign(m, { hold: best.charge, arc: best.arc, rival: r.slot });
  return { ...input, ...windUp };
}
function chooseThrow(k: Keeper, target: Keeper, ctx: NavigationContext) {
  const w = k.world;
  const radius = BLAST_RADIUS * S;
  let best: { charge: number; arc: number; miss: number } | undefined;
  for (const charge of PLAN_CHARGES)
    for (const arc of [1, 0]) {
      const plan = throwAt(k, charge, arc, target, ctx, 2);
      if (
        plan &&
        (!best || plan.miss < best.miss) &&
        gap(w, plan.x, plan.y) > radius + SELF_CLEAR * S
      )
        best = { charge, arc, miss: plan.miss };
    }
  return best;
}

/** The aim a release uses now: at the planned rival with the level's error, or a lob away from itself. */
function release(
  k: Keeper,
  ctx: NavigationContext,
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
        end = predictedBlast(
          { ...bombSpawn(sx, sy, t.map), vx: v.vx, vy: v.vy },
          t,
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
