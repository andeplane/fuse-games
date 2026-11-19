// SPDX-License-Identifier: GPL-2.0-or-later
// C-Dogs, Copyright (C) 1995 Ronny Wester. TypeScript adaptation of DOS AI.C.
// The room owns random state and visibility. See ../../COPYING and reference.md.
export interface Position {
  x: number;
  y: number;
}
export interface Intent {
  dx: number;
  dy: number;
  fire: boolean;
  special: boolean;
}
export interface Brain {
  sleeping: boolean;
  delay: number;
  turns: number;
  tryRight: boolean;
  lastDir: number;
}
export function createBrain(sleeping = true): Brain {
  return { sleeping, delay: 0, turns: 0, tryRight: false, lastDir: -1 };
}
const bounded = (x: unknown, lo: number, hi: number) =>
  typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi;
export function isBrain(raw: unknown): raw is Brain {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const b = raw as Record<string, unknown>;
  return (
    Object.keys(b).length === 5 &&
    typeof b.sleeping === "boolean" &&
    typeof b.tryRight === "boolean" &&
    bounded(b.delay, 0, 65535) &&
    bounded(b.turns, 0, 3) &&
    bounded(b.lastDir, -1, 7)
  );
}
export const STILL: Readonly<Intent> = {
  dx: 0,
  dy: 0,
  fire: false,
  special: false,
};
const HEADINGS = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
] as const;
function heading(dx: number, dy: number): number {
  return HEADINGS.findIndex(([x, y]) => x === dx && y === dy);
}
export function hunt(from: Position, to: Position): Intent {
  const x = to.x - from.x,
    y = to.y - from.y;
  return {
    dx: 2 * Math.abs(x) > Math.abs(y) ? Math.sign(x) : 0,
    dy: 2 * Math.abs(y) > Math.abs(x) ? Math.sign(y) : 0,
    fire: false,
    special: false,
  };
}
function toward(dir: number): Intent {
  const [dx, dy] = HEADINGS[dir]!;
  return { dx, dy, fire: false, special: false };
}
const distance = (a: Position, b: Position) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

interface Agent extends Position {
  dir: number;
  hp: number;
  lock: number;
  brain: Brain;
}
interface Target extends Position {
  hp: number;
  fire: boolean;
}
interface Skill {
  move: number;
  track: number;
  shoot: number;
  delay: number;
  flags: number;
}
interface Perception {
  visible: boolean;
  goodGuysPresent: boolean;
  canStand(x: number, y: number): boolean;
  /** Next integer from the authoritative, checkpointed random sequence. */
  random(): number;
  difficulty?: "very easy" | "easy" | "normal" | "hard" | "very hard";
}
const ROLLS = {
  "very easy": [300, 4],
  easy: [200, 2],
  normal: [100, 1],
  hard: [75, 1],
  "very hard": [50, 1],
} as const;
export const COWARD = 1 << 16,
  GOOD_GUY = 1 << 17,
  PRISONER = 1 << 18,
  FOLLOWER = 1 << 20,
  VICTIM = 1 << 22,
  SNEAKY = 1 << 23;
function facing(actor: Agent, target: Target): boolean {
  const [x, y] = HEADINGS[actor.dir]!;
  return (
    (!x || Math.sign(target.x - actor.x) === x) &&
    (!y || Math.sign(target.y - actor.y) === y)
  );
}
/** Four-pixel probe; a diagonal remains usable if either adjacent axis allows sliding. */
function canWalk(actor: Agent, dir: number, env: Perception): boolean {
  const [dx, dy] = HEADINGS[dir]!;
  const x = actor.x + 4 * dx,
    y = actor.y + 4 * dy;
  return (
    env.canStand(x, y) ||
    (dx !== 0 &&
      dy !== 0 &&
      (env.canStand(x, actor.y) || env.canStand(actor.x, y)))
  );
}
export function chooseEnemyControl(
  actor: Agent,
  players: readonly Target[],
  stats: Skill,
  env: Perception,
) {
  const brain = { ...actor.brain };
  let dir = actor.dir,
    lock = actor.lock,
    control = { ...STILL };
  if (env.visible) brain.sleeping = false;
  if (actor.hp <= 0 || brain.sleeping || (stats.flags & PRISONER) !== 0) {
    brain.lastDir = -1;
    return { brain, dir, lock, control };
  }
  const [limit, delayMultiplier] = ROLLS[env.difficulty ?? "normal"];
  const roll = env.random() % limit;
  // The source chooses the second player on an equal distance.
  let target: Position = actor,
    closest = Infinity;
  for (const player of players) {
    const d = distance(actor, player);
    if (d <= closest) {
      closest = d;
      target = player;
    }
  }
  const track = () =>
    stats.flags & COWARD ? hunt(target, actor) : hunt(actor, target);
  const sneaky =
    !!(stats.flags & SNEAKY) && env.visible && players.some((p) => p.fire);
  if (stats.flags & FOLLOWER) {
    if (closest >= 32) {
      const dx = Math.floor(target.x) - Math.floor(actor.x),
        dy = Math.floor(target.y) - Math.floor(actor.y);
      control.dx = Math.abs(dx) > 1 ? Math.sign(dx) : 0;
      control.dy = Math.abs(dy) > 1 ? Math.sign(dy) : 0;
    }
    brain.delay = stats.delay;
  } else if (sneaky) {
    control = track();
    control.fire = true;
  } else if (brain.turns > 0) {
    if (env.visible && roll < stats.track) {
      brain.turns = 0;
      control = track();
    } else {
      const turn = brain.tryRight ? -1 : 1;
      const adjacent = (dir + turn + 8) % 8;
      if (canWalk(actor, adjacent, env)) {
        dir = adjacent;
        brain.turns--;
      } else if (!canWalk(actor, dir, env)) {
        dir = (dir - turn + 8) % 8;
        if (++brain.turns === 4) {
          brain.tryRight = false;
          brain.turns = 0;
        }
      }
      control = toward(dir);
    }
  } else if (brain.delay > 0) {
    brain.delay--;
    if (brain.lastDir >= 0) control = toward(brain.lastDir);
  } else {
    if (roll < stats.track) control = track();
    else if (roll < stats.move) control = toward(env.random() & 7);
    brain.delay = stats.delay * delayMultiplier;
  }
  if (!(sneaky && !(stats.flags & FOLLOWER))) {
    if (
      env.visible &&
      lock <= 0 &&
      roll < stats.shoot &&
      (stats.flags & GOOD_GUY ||
        env.goodGuysPresent ||
        players.some((p) => p.hp > 0 && facing(actor, p)))
    ) {
      control = { ...STILL, fire: true };
    } else {
      if (!env.visible) lock = 40;
      const desired = heading(control.dx, control.dy);
      if (desired >= 0 && !brain.turns && !canWalk(actor, desired, env)) {
        brain.turns = 1;
        dir = (Math.max(0, brain.lastDir) + (brain.tryRight ? 1 : 7)) % 8;
        control = { ...STILL };
      }
    }
  }
  brain.lastDir = heading(control.dx, control.dy);
  return { brain, dir, lock, control };
}
