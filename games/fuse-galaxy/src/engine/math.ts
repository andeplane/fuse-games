/**
 * Integer arithmetic for the rules. Every quantity the engine computes is a whole number, so a replay folds to the
 * same bits on every device: + − × and the truncating division below only, and no `Math` at all.
 */

/** What a percentage is out of. */
export const PERCENT = 100;

export const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

export const min = (a: number, b: number): number => (a < b ? a : b);

export const max = (a: number, b: number): number => (a > b ? a : b);

/** Integer division rounded toward zero, for whole-number operands. */
export const div = (a: number, b: number): number => (a - (a % b)) / b;

/** Integer division rounded up, for non-negative `a` and positive `b`. */
export const ceilDiv = (a: number, b: number): number => div(a + b - 1, b);

/** `percent` hundredths of `value`, rounded down. */
export const percentOf = (value: number, percent: number): number =>
  div(value * percent, PERCENT);

/** The low 32 bits of a × b as a signed integer, exactly as `Math.imul`. */
export function imul(a: number, b: number): number {
  const al = a & 0xffff,
    ah = (a >>> 16) & 0xffff,
    bl = b & 0xffff,
    bh = (b >>> 16) & 0xffff;
  return (al * bl + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
}

/** The whole square root of a non-negative whole number, rounded down (Newton's method in integers). */
export function isqrt(n: number): number {
  if (n < 2) return n;
  let x = n,
    y = div(n + 1, 2);
  while (y < x) {
    x = y;
    y = div(x + div(n, x), 2);
  }
  return x;
}
