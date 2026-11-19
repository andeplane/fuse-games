/**
 * The diagnostic hash used by games that serialize their checkpoint as JSON.
 * Arrays retain their order. Object keys are sorted before JSON visits their values.
 * Keep the encoding and 16-digit digest stable so mixed builds agree on the same state.
 */
export function hashCheckpointJson(
  checkpoint: readonly unknown[] | Readonly<Record<string, unknown>>,
): string {
  const text = JSON.stringify(checkpoint, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : value,
  );
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x01000193);
    b ^= b >>> 13;
  }
  return (
    (a >>> 0).toString(16).padStart(8, "0") +
    (b >>> 0).toString(16).padStart(8, "0")
  );
}
