/* Altered port of OpenLieroX CWormBot.cpp:115–262,2641–2685,2814–2853
 * and src/level/FastTraceLine.h, pinned 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * Jason Boettcher, Dark Charlie, Albert Zeyer and contributors; LGPL.
 */
import { f, add, sub, mul, length2 } from "./physics-types.js";
import type { PixelTerrain } from "./terrain-types.js";

export const PX_EMPTY = 1,
  PX_DIRT = 2,
  PX_ROCK = 4;
export interface AiPoint {
  x: number;
  y: number;
}
export interface AiRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface AiTerrain {
  readonly width: number;
  readonly height: number;
  flag(x: number, y: number): number;
}
export const point = (x: number, y: number): AiPoint => ({ x: f(x), y: f(y) });
export const plus = (a: AiPoint, b: AiPoint): AiPoint =>
  point(add(a.x, b.x), add(a.y, b.y));
export const minus = (a: AiPoint, b: AiPoint): AiPoint =>
  point(sub(a.x, b.x), sub(a.y, b.y));
export const times = (a: AiPoint, scale: number): AiPoint =>
  point(mul(a.x, scale), mul(a.y, scale));
export const len2 = (p: AiPoint): number => length2(p.x, p.y);
export const len = (p: AiPoint): number => f(Math.sqrt(len2(p)));
export function normalized(p: AiPoint): AiPoint {
  const length = len(p);
  return length === 0 ? { ...p } : point(f(p.x / length), f(p.y / length));
}
export const intPoint = (p: AiPoint): AiPoint => ({
  x: Math.trunc(p.x) || 0,
  y: Math.trunc(p.y) || 0,
});
export const rectCenter = (r: AiRect): AiPoint => ({
  x: Math.trunc((r.x1 + r.x2) / 2),
  y: Math.trunc((r.y1 + r.y2) / 2),
});
export const pointOrder = (a: AiPoint, b: AiPoint): number =>
  a.y - b.y || a.x - b.x;

/** Derived row cache, local to one simulation call. Changed RLE strings invalidate it immediately. */
export function aiTerrain(terrain: PixelTerrain): AiTerrain {
  const cache = new Map<number, { source: string; pixels: Uint8Array }>();
  return {
    width: terrain.width,
    height: terrain.height,
    flag(rawX, rawY) {
      const x = Math.trunc(rawX),
        y = Math.trunc(rawY);
      if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height)
        return PX_ROCK;
      const source = terrain.rows[y]!;
      let row = cache.get(y);
      if (!row || row.source !== source) {
        const pixels = new Uint8Array(terrain.width);
        let cursor = 0;
        for (let i = 0; i < source.length; i++) {
          const code = source.charCodeAt(i) - 32,
            count = Math.floor(code / 3) + 1;
          const flags = [PX_ROCK, PX_EMPTY, PX_DIRT][code % 3]!;
          pixels.fill(flags, cursor, cursor + count);
          cursor += count;
        }
        row = { source, pixels };
        cache.set(y, row);
      }
      return row.pixels[x]!;
    },
  };
}

/** Exact FastTraceLine integer stepping. All consumers stop on the first clipped pixel. */
export function fastTrace(
  terrain: AiTerrain,
  target: AiPoint,
  start: AiPoint,
  checkFlag: number,
  collision: (x: number, y: number) => boolean,
): void {
  const dir = minus(target, start);
  if (dir.x === 0 && dir.y === 0) return;
  const sx = dir.x >= 0 ? 1 : -1,
    sy = dir.y >= 0 ? 1 : -1;
  const xDominant = sx * dir.x >= sy * dir.y;
  const quotient = f(xDominant ? dir.y / dir.x : dir.x / dir.y);
  const startX = Math.trunc(start.x),
    startY = Math.trunc(start.y);
  let x = 0,
    y = 0;
  for (;;) {
    if (xDominant) y = Math.trunc(mul(quotient, x));
    else x = Math.trunc(mul(quotient, y));
    if (sx * x > sx * Math.trunc(dir.x) || sy * y > sy * Math.trunc(dir.y))
      return;
    const px = startX + x,
      py = startY + y;
    if (px < 0 || py < 0 || px >= terrain.width || py >= terrain.height) {
      // The source continues without advancing when the callback returns true.
      // Every ported clipping callback terminates; make that precondition explicit.
      if (collision(px, py))
        throw new Error("Classic AI trace clipping callback must stop");
      return;
    }
    if (terrain.flag(px, py) & checkFlag && !collision(px, py)) return;
    if (xDominant) x += sx;
    else y += sy;
  }
}
export function hasCollision(
  terrain: AiTerrain,
  target: AiPoint,
  start: AiPoint,
  flag: number,
): boolean {
  let hit = false;
  fastTrace(terrain, target, start, flag, () => {
    hit = true;
    return false;
  });
  return hit;
}

/** Three parallel rock traces, including the native clockwise perpendicular. */
export function traceWorm(
  terrain: AiTerrain,
  target: AiPoint,
  start: AiPoint,
): { clear: boolean; collision: AiPoint } {
  const collision = { ...target };
  const dir = normalized(point(sub(target.y, start.y), sub(start.x, target.x)));
  let from = minus(start, dir),
    to = minus(target, dir),
    hit = false;
  for (let i = 0; i < 3; i++, from = plus(from, dir), to = plus(to, dir)) {
    const origin = from;
    fastTrace(terrain, to, from, PX_ROCK, (x, y) => {
      hit = true;
      if (len2(minus(collision, origin)) > len2(minus(point(x, y), origin))) {
        collision.x = x;
        collision.y = y;
      }
      return false;
    });
  }
  return { clear: !hit, collision };
}

/** Native wrapper divides two integers before converting its inverse ratio to float. */
export function traceLine(
  terrain: AiTerrain,
  target: AiPoint,
  start: AiPoint,
  divs = 5,
  checkFlag = PX_EMPTY,
): { distance: number; type: number; fraction: number } {
  let pos = { ...start };
  const delta = minus(target, pos),
    total = Math.trunc(len(delta)),
    dir = normalized(delta);
  const divisions = Math.max(1, Math.min(divs, total));
  for (let i = 0; i < total; i += divisions) {
    const flag = terrain.flag(pos.x, pos.y);
    if (!(flag & checkFlag))
      return {
        distance: i,
        type: flag,
        fraction: i ? Math.trunc(total / i) : 0,
      };
    pos = plus(pos, times(dir, divisions));
  }
  return { distance: total, type: PX_EMPTY, fraction: total ? 1 : 0 };
}

/** Cyclic down/left/up/right expansion, exactly as getMaxFreeArea. */
export function maxFreeArea(
  terrain: AiTerrain,
  raw: AiPoint,
  checkFlag = PX_ROCK,
): AiRect {
  const p = intPoint(raw),
    r: AiRect = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  if (p.x < 0 || p.y < 0 || p.x >= terrain.width || p.y >= terrain.height)
    return r;
  let blocked = 0,
    dir = 1;
  while (blocked !== 15) {
    do {
      dir <<= 1;
      if (dir > 8) dir = 1;
    } while (blocked & dir);
    let x = dir === 1 ? r.x2 + 1 : dir === 4 ? r.x1 - 1 : r.x1;
    let y = dir === 2 ? r.y2 + 1 : dir === 8 ? r.y1 - 1 : r.y1;
    if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height) {
      blocked |= dir;
      continue;
    }
    while (dir === 1 || dir === 4 ? y <= r.y2 : x <= r.x2) {
      if (terrain.flag(x, y) & checkFlag) {
        blocked |= dir;
        break;
      }
      if (dir === 1 || dir === 4) y++;
      else x++;
    }
    if (!(blocked & dir)) {
      if (dir === 1) r.x2++;
      else if (dir === 2) r.y2++;
      else if (dir === 4) r.x1--;
      else r.y1--;
    }
  }
  return r;
}

export function simpleTrace(
  terrain: AiTerrain,
  start: AiPoint,
  dist: AiPoint,
): boolean {
  let { x, y } = start;
  if (Math.abs(dist.x) >= Math.abs(dist.y)) {
    if (dist.x < 0) x += dist.x;
    const end = x + Math.abs(dist.x);
    if (x < 0 || end >= terrain.width || y < 0 || y >= terrain.height)
      return false;
    for (; x <= end; x++) if (terrain.flag(x, y) & PX_ROCK) return false;
  } else {
    if (dist.y < 0) y += dist.y;
    const end = y + Math.abs(dist.y);
    if (y < 0 || end >= terrain.height || x < 0 || x >= terrain.width)
      return false;
    for (; y <= end; y++) if (terrain.flag(x, y) & PX_ROCK) return false;
  }
  return true;
}
