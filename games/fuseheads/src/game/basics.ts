export const CAPACITY = 2;
export const MAX_WATCHERS = 8;

export function validName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    Array.from(value).length <= 18 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}

export function seatName(raw: string): string | undefined {
  const name = Array.from(raw.trim()).slice(0, 18).join("").trim();
  return validName(name) ? name : undefined;
}

export const validMatchId = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7e]{1,64}$/.test(value);

export const isAvatar = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(value);
