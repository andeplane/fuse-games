export const ROOM_RECONNECT_GRACE_MS = 90_000;
export const ROOM_CODE_SPACE = 36 ** 6;
export const validRoomCode = (code: string): boolean =>
  /^[A-Z0-9]{6}$/.test(code);
/** Uniform cryptographic mapping; injectable uint32 source keeps tests deterministic. */
export function generateRoomCode(
  nextUint32: () => number = () =>
    crypto.getRandomValues(new Uint32Array(1))[0]!,
): string {
  const limit = Math.floor(2 ** 32 / ROOM_CODE_SPACE) * ROOM_CODE_SPACE;
  for (let attempt = 0; attempt < 64; attempt++) {
    const value = nextUint32();
    if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** 32)
      throw new Error("Invalid random source");
    if (value >= limit) continue;
    return (value % ROOM_CODE_SPACE)
      .toString(36)
      .toUpperCase()
      .padStart(6, "0");
  }
  throw new Error("Random source rejection limit");
}
/** Reservation must be transactional. False means only a live-code collision; other errors propagate. */
export async function reserveRoomCode(
  reserve: (code: string) => Promise<boolean>,
  nextCode: () => string = generateRoomCode,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = nextCode();
    if (await reserve(code)) return code;
  }
  return undefined;
}
