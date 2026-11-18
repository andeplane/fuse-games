import type { Intent, Position } from "./hostile.js";
import { GOOD_GUY, PRISONER, STILL, VICTIM, hunt } from "./hostile.js";

/** Only public simulation fields used by a Fuse teammate or dogfight opponent. */
interface Fighter extends Position {
  role: string;
  escort?: string | null;
  seat: string | null;
  hp: number;
  dir: number;
  lock: number;
  weapon: number;
  objectiveIndex: number | null;
  skill: { flags: number };
}
interface Prop extends Position {
  kind: string;
  hp: number;
  objectiveIndex: number | null;
  solid: boolean;
  escort: string | null;
}
interface BotWorld {
  width: number;
  height: number;
  tiles: readonly string[];
  seen: readonly string[];
  mode: string;
  outcome: string;
  actors: readonly Fighter[];
  items: readonly Prop[];
  props: readonly (Position & { impassable: boolean; w: number; h: number })[];
  objectives: readonly { done: number; required: number; kind: string }[];
  doors: readonly { x: number; y: number; key: string | null; timer: number }[];
  keys: readonly Position[];
  keyring: readonly string[];
}
const W = 16,
  H = 12;
const dist = (a: Position, b: Position) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const cell = (w: number, p: Position) =>
  Math.floor(p.y / H) * w + Math.floor(p.x / W);
const center = (w: number, i: number): Position => ({
  x: ((i % w) + 0.5) * W,
  y: (Math.floor(i / w) + 0.5) * H,
});
function walk(a: Position, b: Position): Intent {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  return {
    dx: Math.abs(dx) > 0.5 ? Math.sign(dx) : 0,
    dy: Math.abs(dy) > 0.5 ? Math.sign(dy) : 0,
    fire: false,
    special: false,
  };
}
function tile(world: BotWorld, x: number, y: number): string | undefined {
  return world.tiles[y]?.[x];
}
function doorAt(world: BotWorld, x: number, y: number) {
  return world.doors.find((door) => door.x === x && door.y === y);
}
function clearRay(world: BotWorld, a: Position, b: Position): boolean {
  const length = dist(a, b),
    n = Math.ceil(length / 4);
  for (let k = 1; k < n; k++) {
    const x = Math.floor((a.x + ((b.x - a.x) * k) / n) / W),
      y = Math.floor((a.y + ((b.y - a.y) * k) / n) / H);
    const t = tile(world, x, y);
    if (!t || t === "#" || (t === "D" && !doorAt(world, x, y)?.timer))
      return false;
  }
  return true;
}
/** Held fire stops movement. Align with one of the eight gun headings before squeezing the trigger. */
function engage(
  world: BotWorld,
  actor: Fighter,
  target: Position,
): Intent | undefined {
  const d = dist(actor, target);
  if (d > 128 || !clearRay(world, actor, target)) return;
  if (actor.weapon === 0) return walk(actor, target);
  const shot = hunt(actor, target);
  const dx = target.x - actor.x,
    dy = target.y - actor.y;
  const miss = Math.abs(dx * shot.dy - dy * shot.dx);
  if (miss > 4) {
    // Close the transverse offset until the muzzle points at the target.
    return Math.abs(dx) >= Math.abs(dy)
      ? { ...STILL, dy: Math.sign(dy) }
      : { ...STILL, dx: Math.sign(dx) };
  }
  return { ...shot, fire: true };
}
interface Goal extends Position {
  rank: number;
  attack: boolean;
}
function route(
  world: BotWorld,
  actor: Fighter,
  goals: Goal[],
  explore: boolean,
): Intent {
  const { width, height } = world;
  const start = cell(width, actor);
  const queue = new Int32Array(width * height),
    first = new Int32Array(width * height);
  first.fill(-1);
  first[start] = start;
  queue[0] = start;
  let head = 0,
    tail = 1;
  const targets = new Map<number, Goal>();
  for (const goal of goals) {
    const i = cell(width, goal),
      prev = targets.get(i);
    if (!prev || goal.rank < prev.rank) targets.set(i, goal);
  }
  const blocked = new Set(
    world.items.filter((p) => p.solid).map((p) => cell(width, p)),
  );
  // A wall-mounted fixture may be anchored away from the centre of its tile.
  // Mark every tile centre at which the player's 7×5 half-hull overlaps it.
  for (const prop of world.props) {
    if (!prop.impassable) continue;
    blocked.add(cell(width, prop));
    const rx = prop.w + 7,
      ry = prop.h + 5;
    for (
      let y = Math.max(0, Math.floor((prop.y - ry) / H));
      y <= Math.min(height - 1, Math.floor((prop.y + ry) / H));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor((prop.x - rx) / W));
        x <= Math.min(width - 1, Math.floor((prop.x + rx) / W));
        x++
      ) {
        const tile = y * width + x;
        const point = center(width, tile);
        if (
          Math.abs(point.x - Math.floor(prop.x)) < rx &&
          Math.abs(point.y - Math.floor(prop.y)) < ry
        )
          blocked.add(tile);
      }
    }
  }
  const minRank = goals.reduce(
    (best, g) => Math.min(best, g.rank),
    explore ? 0 : Infinity,
  );
  let best: Goal | undefined,
    firstStep = start;
  const deltas = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;
  while (head < tail) {
    const i = queue[head++]!,
      x = i % width,
      y = Math.floor(i / width);
    const unseen = explore && world.seen[y]?.[x] === "0";
    const goal =
      targets.get(i) ??
      (unseen ? { ...center(width, i), rank: 0, attack: false } : undefined);
    if (goal && (!best || goal.rank < best.rank)) {
      best = goal;
      firstStep = first[i]!;
      if (best.rank === minRank) break;
    }
    // Solid mission props may be the destination, but cannot be traversed.
    if (i !== start && blocked.has(i)) continue;
    for (const [dx, dy] of deltas) {
      const nx = x + dx,
        ny = y + dy,
        j = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || first[j] !== -1)
        continue;
      const t = tile(world, nx, ny);
      if (!t || t === "#" || (blocked.has(j) && !targets.has(j))) continue;
      if (t === "D") {
        const door = doorAt(world, nx, ny);
        if (door?.key && door.timer === 0 && !world.keyring.includes(door.key))
          continue;
      }
      first[j] = i === start ? j : first[i]!;
      queue[tail++] = j;
    }
  }
  if (!best) return { ...STILL };
  if (best.attack) {
    const attack = engage(world, actor, best);
    if (attack) return attack;
  }
  if (firstStep === start) return walk(actor, best);
  const here = center(width, start),
    next = center(width, firstStep);
  // Centre the narrow axis before a turn so the collision hull clears the wall.
  if (here.y === next.y && Math.abs(actor.y - here.y) > 1.5)
    return { ...STILL, dy: Math.sign(here.y - actor.y) };
  if (here.x === next.x && Math.abs(actor.x - here.x) > 2.5)
    return { ...STILL, dx: Math.sign(here.x - actor.x) };
  return walk(actor, next);
}
export function botControls(world: BotWorld, seat: string): Intent {
  const actor = world.actors.find((a) => a.seat === seat);
  if (!actor || actor.hp <= 0 || world.outcome !== "playing")
    return { ...STILL };
  const fight = world.mode === "dogfight";
  const needed = (i: number | null) =>
    i !== null &&
    (world.objectives[i]?.done ?? 0) < (world.objectives[i]?.required ?? 0);
  const enemy = (a: Fighter) =>
    a !== actor &&
    a.hp > 0 &&
    a.role !== "hostage" &&
    (fight
      ? a.seat !== null
      : a.seat === null && !(a.skill.flags & (GOOD_GUY | PRISONER | VICTIM)));
  const complete =
    !fight && world.objectives.every((o) => o.done >= o.required);
  const enemies = world.actors
    .filter(enemy)
    .sort((a, b) => dist(a, actor) - dist(b, actor));
  const goals: Goal[] = [];
  for (const captive of world.actors)
    if (
      captive.role === "hostage" &&
      captive.hp > 0 &&
      !captive.escort &&
      needed(captive.objectiveIndex)
    )
      goals.push({ ...captive, rank: 0, attack: false });
  // Once extraction is clear keep moving, except to fend off an immediate threat.
  for (const e of enemies) {
    const attack =
      dist(e, actor) < (complete ? 16 : 100)
        ? engage(world, actor, e)
        : undefined;
    if (attack && (actor.lock === 0 || fight || dist(e, actor) < 16))
      return attack;
    if (fight || needed(e.objectiveIndex))
      goals.push({ ...e, rank: 0, attack: true });
  }
  for (const prop of world.items) {
    if (prop.hp <= 0 || !needed(prop.objectiveIndex) || prop.escort) continue;
    goals.push({ ...prop, rank: 0, attack: prop.kind === "reactor" });
  }
  if (complete) {
    const exitAt = (p: Position) =>
      tile(world, Math.floor(p.x / W), Math.floor(p.y / H)) === "E";
    // The DOS follower stops within 32 pixels. A rescuer already on the near
    // rim must keep leading it across that rim before the pickup timer runs.
    const follower = exitAt(actor)
      ? world.actors.find(
          (a) => a.role === "hostage" && a.hp > 0 && a.escort && !exitAt(a),
        )
      : undefined;
    for (let y = 0; y < world.height; y++) {
      const row = world.tiles[y]!;
      for (let x = row.indexOf("E"); x >= 0; x = row.indexOf("E", x + 1)) {
        const point = { x: (x + 0.5) * W, y: (y + 0.5) * H };
        goals.push({
          ...point,
          rank: follower ? -dist(point, follower) : 0,
          attack: false,
        });
      }
    }
  }
  for (const key of world.keys) goals.push({ ...key, rank: 1, attack: false });
  const explore =
    !fight &&
    world.objectives.some(
      (o) => o.kind === "investigate" && o.done < o.required,
    );
  return route(world, actor, goals, explore);
}
