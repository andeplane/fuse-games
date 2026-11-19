import type { LogEntry } from "./game.js";

export const UINT32_MAX = 0xffff_ffff;

/** An unsigned 32-bit integer: every seq, tick, generation and count on the wire. */
export const uint32 = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= UINT32_MAX &&
  !Object.is(value, -0);
/** The two positive wire positions shared by management and game commands. */
export const hasLogPosition = (raw: unknown): raw is LogEntry =>
  Array.isArray(raw) &&
  uint32(raw[0]) &&
  raw[0] > 0 &&
  uint32(raw[1]) &&
  raw[1] > 0;

/** A room member id as the room service issues it (and a bot id as a game names it). */
export const memberId = (value: unknown): value is string =>
  typeof value === "string" && /^[\w:.-]{1,64}$/.test(value);
