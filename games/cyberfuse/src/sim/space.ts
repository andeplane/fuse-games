import {
  TILE_HEIGHT as H,
  TILE_WIDTH as W,
  type Actor,
  type MissionState,
  type Point,
} from "./types.js";

export const tileX = (p: number) => Math.floor(p / W);
export const tileY = (p: number) => Math.floor(p / H);
export const tileAt = (s: MissionState, x: number, y: number) =>
  s.tiles[tileY(y)]?.[tileX(x)] ?? "#";
export function setTile(rows: string[], x: number, y: number, value: string) {
  const row = rows[y]!;
  rows[y] = row.slice(0, x) + value + row.slice(x + 1);
}
export const solid = (ch: string) => ch === "#" || ch === "D";
export const wall = (s: MissionState, x: number, y: number) =>
  solid(tileAt(s, x, y));

/** Floor anchors use the DOS pixel footprint: seven pixels either side, five above and below. */
export function wallContact(s: MissionState, x: number, y: number): boolean {
  const left = Math.floor(x) - 7,
    right = left + 14,
    top = Math.floor(y) - 5,
    bottom = top + 10;
  return (
    wall(s, left, top) ||
    wall(s, right, top) ||
    wall(s, left, bottom) ||
    wall(s, right, bottom)
  );
}
export function overlaps(a: Point, b: Point, w: number, h: number): boolean {
  return (
    Math.abs(Math.floor(a.x) - Math.floor(b.x)) < w &&
    Math.abs(Math.floor(a.y) - Math.floor(b.y)) < h
  );
}
export function obstacle(s: MissionState, actor: Actor, x: number, y: number) {
  const p = { x, y };
  return (
    s.actors.find(
      (other) => other !== actor && other.hp > 0 && overlaps(p, other, 14, 10),
    ) ??
    s.items.find((item) => item.solid && overlaps(p, item, 12, 9)) ??
    s.props.find(
      (prop) => prop.impassable && overlaps(p, prop, 7 + prop.w, 5 + prop.h),
    )
  );
}
export function canStand(s: MissionState, actor: Actor, x: number, y: number) {
  return !wallContact(s, x, y) && !obstacle(s, actor, x, y);
}

/** Follow the DOS LOS buffer back towards the eye, one diagonal tile at a time and then axial tiles. */
export function visibleTile(
  s: MissionState,
  eye: Point,
  tx: number,
  ty: number,
): boolean {
  const cx = tileX(eye.x),
    cy = tileY(eye.y);
  if (Math.abs(tx - cx) > 10 || Math.abs(ty - cy) > 8) return false;
  while (tx !== cx || ty !== cy) {
    tx += Math.sign(cx - tx);
    ty += Math.sign(cy - ty);
    if ((tx !== cx || ty !== cy) && solid(s.tiles[ty]?.[tx] ?? "#"))
      return false;
  }
  return true;
}
export function reveal(s: MissionState, actor: Point) {
  const cx = tileX(actor.x),
    cy = tileY(actor.y);
  for (let y = Math.max(0, cy - 8); y <= Math.min(s.height - 1, cy + 8); y++) {
    const row = s.seen[y]!.split("");
    let changed = false;
    for (
      let x = Math.max(0, cx - 10);
      x <= Math.min(s.width - 1, cx + 10);
      x++
    ) {
      if (row[x] === "0" && visibleTile(s, actor, x, y)) {
        row[x] = "1";
        s.seenCount++;
        changed = true;
      }
    }
    if (changed) s.seen[y] = row.join("");
  }
}
export function nearest<T extends Point>(
  pos: Point,
  targets: readonly T[],
): T | undefined {
  let best: T | undefined,
    distance = Infinity;
  for (const p of targets) {
    const d = Math.max(Math.abs(p.x - pos.x), Math.abs(p.y - pos.y));
    if (d < distance) {
      distance = d;
      best = p;
    }
  }
  return best;
}
export function updateDoors(s: MissionState) {
  let changed = false;
  for (const door of s.doors) {
    const close =
      s.actors.some(
        (a) =>
          a.hp > 0 &&
          Math.abs(tileX(a.x) - door.x) + Math.abs(tileY(a.y) - door.y) <= 1,
      ) ||
      s.items.some(
        (a) =>
          a.escort !== null &&
          Math.abs(tileX(a.x) - door.x) + Math.abs(tileY(a.y) - door.y) <= 1,
      );
    if (close && (door.key === null || s.keyring.includes(door.key)))
      door.timer = 30;
    else if (door.timer > 0) door.timer--;
    const mark = door.timer > 0 ? "+" : "D";
    if (s.tiles[door.y]![door.x] !== mark) {
      setTile(s.tiles, door.x, door.y, mark);
      changed = true;
    }
  }
  return changed;
}
