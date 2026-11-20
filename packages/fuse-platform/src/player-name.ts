/** The common 18-code-point name contract for player seats and accounts. */
export const MAX_PLAYER_NAME = 18;
const CONTROL = /[\u0000-\u001f\u007f]/;
const LONE_SURROGATE = /\p{Cs}/u;

/** Check a name that is already in its canonical form. */
export function validPlayerName(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PLAYER_NAME * 2 ||
    value !== value.trim() ||
    CONTROL.test(value) ||
    LONE_SURROGATE.test(value)
  )
    return false;
  // Each UTF-16 code unit contributes at most one code point.
  if (value.length <= MAX_PLAYER_NAME) return true;
  let length = 0;
  for (const _codePoint of value) {
    length++;
    if (length > MAX_PLAYER_NAME) return false;
  }
  return true;
}

/** Apply the common seat editor rule to a name the player has entered. */
export function seatPlayerName(raw: string): string | undefined {
  if (CONTROL.test(raw)) return;
  const name = Array.from(raw.replace(/\p{Cs}/gu, "").trim())
    .slice(0, MAX_PLAYER_NAME)
    .join("")
    .trim();
  return validPlayerName(name) ? name : undefined;
}
