import { boostOf, type Arena, type Keeper } from "./arena.js";
import { BODY, HALF, NEUTRAL, S, type Input, type World } from "./world.js";
import { blastRadius, bombPath, touches, type Bomb } from "./bomb.js";
import { BLAST_RADIUS, BOMB_RADIUS, BOMBLET_FUSE } from "./bomb-rules.js";
import { chestOf, landing, standingOn } from "./bot-nav.js";
import { noise } from "./bot-mind.js";
import { step } from "./step.js";
import { tickPower } from "./power-ups.js";
import type { CombatContext } from "./combat.js";
import type { NavigationContext } from "./bot-goal.js";

export interface SafetyContext extends NavigationContext {
  threats: readonly Threat[];
}

interface Threat {
  id: number;
  owner: string;
  fuse: number;
  /** Blast radius, units. */
  radius: number;
  /** The bomb after each of its remaining flights. */
  path: readonly { x: number; y: number }[];
}
/**
 * A live bomb as a blast to get clear of. A cluster bomb splits on its first
 * contact and its bomblets go off BOMBLET_FUSE later near there, so its blast
 * is taken at that point, with a whole bomb's radius for their spread.
 */
export function threatOf(b: Bomb, t: Arena["tuning"]): Threat {
  const { path, contact } = bombPath(b, b.fuse, t),
    base = { id: b.id, owner: b.owner, radius: blastRadius(b.kind) };
  if (b.kind !== "cluster" || contact < 0)
    return { ...base, fuse: b.fuse, path };
  const at = path[contact]!,
    fuse = contact + 1 + BOMBLET_FUSE;
  return {
    ...base,
    fuse,
    path: Array.from({ length: fuse }, (_, i) =>
      i <= contact ? path[i]! : at,
    ),
  };
}
/** Distance from a point to a keeper's body box, subunits. */
export function gap(
  w: Pick<World, "x" | "feet">,
  x: number,
  y: number,
): number {
  const dx = x - Math.max(w.x - HALF, Math.min(w.x + HALF, x)),
    dy = y - Math.max(w.feet - BODY, Math.min(w.feet, y));
  return Math.sqrt(dx * dx + dy * dy);
}
const QUIET: CombatContext = { rivals: [], hit() {} };
/**
 * The bot detached from the room for a trial. Every object `step` and the
 * power's tick write is copied: the body with its inputs and hook, the power
 * (kind, timer, cluster charges), the bomb kit; scalars such as the dash
 * timer, bonus jumps and spawn guard are copied by the spread. Its combat is
 * an empty one and it has no mind. Tuning is only read. Nothing a trial does
 * reaches shared state.
 */
function ghost(k: Keeper): Keeper {
  const w = k.world;
  return {
    ...k,
    mind: null,
    power: { ...k.power },
    bomb: { ...k.bomb },
    world: {
      ...w,
      input: { ...w.input },
      previous: { ...w.previous },
      hook: { ...w.hook },
      combat: {
        target: null,
        balls: [],
        hits: 0,
        falls: 0,
        impact: { tick: 0, x: 0, y: 0 },
      },
    },
  };
}
type Script = (beat: number, g: World) => Input;
/**
 * How close the nearest blast comes to the bot if it plays `script` (units of
 * clearance beyond the radius; negative is caught), whether it falls to its
 * death, and whether it ends on or over a ledge. The ghost moves as the fold
 * moves the bot: with its power's boost (Triple jump, Dash bump) until the
 * power runs out.
 */
function trial(
  k: Keeper,
  script: Script,
  threats: readonly Threat[],
  ctx: SafetyContext,
): { clearance: number; dead: boolean; safe: boolean } {
  const gk = ghost(k),
    g = gk.world,
    jumpMode = ctx.arena.tuning.jumpMode,
    horizon = Math.max(...threats.map((t) => t.fuse)),
    impact = ctx.arena.tuning.bomb === "impact";
  let clearance = Infinity;
  for (let s = 1; s <= horizon; s++) {
    if ((s - 1) % 3 === 0) g.input = script((s - 1) / 3, g);
    step(g, QUIET, boostOf(gk, jumpMode));
    if (g.respawn) return { clearance: -Infinity, dead: true, safe: false };
    tickPower(gk);
    for (const t of threats) {
      if (s > t.fuse) continue;
      const p = t.path[s - 1]!;
      if (s === t.fuse)
        clearance = Math.min(clearance, gap(g, p.x, p.y) - t.radius * S);
      else if (
        impact &&
        t.owner !== k.id &&
        touches(g, p.x, p.y, BOMB_RADIUS * S)
      )
        clearance = Math.min(clearance, -BLAST_RADIUS * S);
    }
  }
  const standing =
    standingOn(g, ctx.platforms) >= 0 || landing(g, ctx.platforms, ctx.ph) >= 0;
  return { clearance, dead: false, safe: standing };
}
export function dodge(k: Keeper, ctx: SafetyContext, input: Input): Input {
  const w = k.world,
    { level, ph } = ctx,
    reach = (level.margin + BLAST_RADIUS + 64) * S;
  const threats = ctx.threats.filter((t) => {
    // Spawn guard runs down before bombs go off, so it covers a blast
    // `fuse` steps away only while it is longer than that.
    if (t.fuse > level.react || t.path.length < t.fuse || k.spawnGuard > t.fuse)
      return false;
    // Its own bomb it always knows about; a rival's it may miss altogether.
    if (t.owner !== k.id && noise(k.id, t.id, 5) >= level.notice) return false;
    const p = t.path[t.fuse - 1]!;
    return gap(w, p.x, p.y) <= reach + ph.run * t.fuse;
  });
  if (!threats.length) return input;
  const margin = level.margin * S,
    first = threats.reduce((a, b) => (b.fuse < a.fuse ? b : a)),
    blast = first.path[first.fuse - 1]!,
    away = (Math.sign(w.x - blast.x) || w.facing) as -1 | 1;
  const held = { ...input };
  // A jump that rises, lets go at the top and uses an air jump (a power's too).
  const jumping = (beat: number, g: World) =>
    beat === 0
      ? !w.input.jump
      : g.vy < 0
        ? g.input.jump
        : (g.airJump || g.bonusJumps > 0) && !g.input.jump;
  // Holding Dash bump, a jumping escape's air jump dashes up and away from
  // where the body is then. This tick keeps the planned aim unless it can
  // dash now and releases no bomb, so a throw still goes where it was aimed.
  const dashing = k.power.kind === "dash",
    planned = { aimX: input.aimX, aimY: input.aimY },
    dashAim = (move: -1 | 0 | 1, body: World) => ({
      aimX: Math.round(body.x / S) + (move || away) * 120,
      aimY: Math.round(chestOf(body) / S) - 200,
    }),
    firstAim = (move: -1 | 0 | 1) =>
      dashing && !w.grounded && !(w.charge && !input.bomb)
        ? dashAim(move, w)
        : planned;
  const make =
    (move: -1 | 0 | 1, jump: boolean, drop = false): Script =>
    (beat, g) => ({
      ...NEUTRAL,
      ...(!jump
        ? planned
        : beat === 0
          ? firstAim(move)
          : dashing
            ? dashAim(move, g)
            : planned),
      bomb: input.bomb,
      move,
      jump: jump && jumping(beat, g),
      drop: drop && beat === 0 && !w.input.drop,
    });
  const options: { script: Script; first: Partial<Input> }[] = [
    { script: () => held, first: {} },
    {
      script: make(away, false),
      first: { move: away, jump: false, drop: false, fire: false },
    },
    {
      script: make(away, true),
      first: {
        ...firstAim(away),
        move: away,
        jump: !w.input.jump,
        drop: false,
        fire: false,
      },
    },
    {
      script: make(-away as -1 | 1, true),
      first: {
        ...firstAim(-away as -1 | 1),
        move: -away as -1 | 1,
        jump: !w.input.jump,
        drop: false,
        fire: false,
      },
    },
    {
      script: make(0, true),
      first: {
        ...firstAim(0),
        move: 0,
        jump: !w.input.jump,
        drop: false,
        fire: false,
      },
    },
    ...(w.grounded
      ? [
          {
            script: make(away, false, true),
            first: {
              move: away,
              jump: false,
              drop: !w.input.drop,
              fire: false,
            },
          },
        ]
      : []),
    {
      script: make(-away as -1 | 1, false),
      first: { move: -away as -1 | 1, jump: false, drop: false, fire: false },
    },
  ];
  let best = options[0]!,
    score = -Infinity;
  for (const option of options) {
    const r = trial(k, option.script, threats, ctx);
    if (!r.dead && r.safe && r.clearance >= margin)
      return { ...input, ...option.first };
    const value = r.dead ? -Infinity : r.clearance + (r.safe ? 0 : -40 * S);
    if (value > score) {
      best = option;
      score = value;
    }
  }
  return { ...input, ...best.first };
}
