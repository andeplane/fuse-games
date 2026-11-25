/**
 * The world's randomness: a mulberry32 stream whose state the world carries (`World.rng`), so a replay draws the
 * same numbers; and FNV-1a, which turns a world into a hash that is the same on every replica.
 */
import { imul } from "./math.js";

/** One mulberry32 step: the value and the next state, both unsigned 32-bit. */
export function next(state: number): { value: number; state: number } {
  const advanced = (state + 0x6d2b79f5) >>> 0;
  let t = advanced;
  t = imul(t ^ (t >>> 15), t | 1);
  t ^= t + imul(t ^ (t >>> 7), t | 61);
  return { value: (t ^ (t >>> 14)) >>> 0, state: advanced };
}

/** A whole number below `count` from a stream the draw advances. */
export function roll(stream: { rng: number }, count: number): number {
  const draw = next(stream.rng);
  stream.rng = draw.state;
  return draw.value % count;
}

/** A seed as the stream's first state: any number folds to an unsigned 32-bit one. */
export const seedState = (seed: number): number => seed >>> 0;

/** FNV-1a over a string's UTF-16 code units from a chosen offset basis, as an unsigned 32-bit number. */
export function fnv1a(text: string, basis = 0x811c9dc5): number {
  let h = basis;
  for (let index = 0; index < text.length; index++)
    h = imul(h ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return h;
}
