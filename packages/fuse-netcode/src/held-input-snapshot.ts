interface HeldInputDecoderOptions {
  capacity: number;
  playerKey(value: unknown): value is string;
  isInput(value: unknown): value is number;
}

/** Restore the nonzero held inputs from checkpoint pairs, using the game's member and input rules. */
export function createHeldInputDecoder({
  capacity,
  playerKey,
  isInput,
}: HeldInputDecoderOptions): (
  raw: unknown,
) => Record<string, number> | undefined {
  return function decodeHeld(raw) {
    if (!Array.isArray(raw) || raw.length > capacity) return;
    const held: Record<string, number> = {};
    for (const pair of raw) {
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        !playerKey(pair[0]) ||
        Object.hasOwn(held, pair[0]) ||
        !isInput(pair[1]) ||
        pair[1] === 0
      )
        return;
      held[pair[0]] = pair[1];
    }
    return held;
  };
}
