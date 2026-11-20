import type { GameMap } from "./map.js";
import { MARKS } from "./world.js";

/** The maximum exact counter and target id accepted from a command or checkpoint. */
export const MAX_ID = 0xff_ffff_ffff;

export const isInt = (
  value: unknown,
  low: number,
  high: number,
): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= low &&
  value <= high;

/** Checks tile coordinates without imposing a terrain constraint. */
export const insideMap = (map: GameMap, x: unknown, y: unknown): x is number =>
  isInt(x, 0, map.width - 1) && isInt(y, 0, map.height - 1);

/** A syntactically valid target. Callers still check its team and availability. */
export function readTarget(of: unknown, id: unknown) {
  if (!isInt(of, 0, MARKS.length - 1) || !isInt(id, 0, MAX_ID)) return;
  return { of, id };
}
