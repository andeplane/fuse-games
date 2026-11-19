import type { Point } from "./types.js";

export const ACTOR_HALF_WIDTH = 7;
export const ACTOR_HALF_HEIGHT = 5;

/** The actor-to-item reach used for solid items and pickup checks during play. */
export const ITEM_REACH_X = 12;
export const ITEM_REACH_Y = 9;

const withinReach = (dx: number, dy: number, width: number, height: number) =>
  Math.abs(dx) < width && Math.abs(dy) < height;

/** Spawning measures centre distances at their stored precision. */
export function overlapsExact(
  a: Point,
  b: Point,
  width: number,
  height: number,
): boolean {
  return withinReach(a.x - b.x, a.y - b.y, width, height);
}

/** Movement and projectile collisions use DOS pixel anchors. */
export function overlaps(
  a: Point,
  b: Point,
  width: number,
  height: number,
): boolean {
  return withinReach(
    Math.floor(a.x) - Math.floor(b.x),
    Math.floor(a.y) - Math.floor(b.y),
    width,
    height,
  );
}
