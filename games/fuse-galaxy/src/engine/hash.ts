/**
 * A world as a short string that is the same wherever the same match was played: its canonical JSON (keys sorted,
 * so the order objects were built in does not matter) folded through FNV-1a twice from two starting values.
 * Two worlds with the same hash are, for a replay check, the same world.
 */
import { fnv1a } from "./rng.js";
import type { World } from "./world.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

const SECOND_BASIS = 0x9747b28c;

const hex = (value: number): string => value.toString(16).padStart(8, "0");

export function hashWorld(world: World): string {
  const text = canonical(world);
  return hex(fnv1a(text)) + hex(fnv1a(text, SECOND_BASIS));
}
