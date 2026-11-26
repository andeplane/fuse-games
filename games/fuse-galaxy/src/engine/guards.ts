/** Reading untrusted values: what a command, a setup or a recorded match is checked with before it is believed. */

export const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isList = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);

/** A whole number a double holds exactly. */
export const isWhole = (value: unknown): value is number =>
  Number.isSafeInteger(value);

export const oneOf = <T extends string>(
  list: readonly T[],
  value: unknown,
): value is T =>
  typeof value === "string" && list.some((item) => item === value);
