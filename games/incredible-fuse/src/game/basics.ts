export const CAPACITY = 5;
export const MAX_WATCHERS = 8;
export const MAX_NAME = 18;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SURROGATE = /\p{Cs}/u;
export const validName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim() === value &&
  value.length > 0 &&
  [...value].length <= MAX_NAME &&
  !CONTROL.test(value) &&
  !SURROGATE.test(value);

export function seatName(raw: string): string | undefined {
  if (CONTROL.test(raw)) return;
  const name = [...raw.replace(/\p{Cs}/gu, "").trim()]
    .slice(0, MAX_NAME)
    .join("")
    .trim();
  return validName(name) ? name : undefined;
}
const avatars = [
  "robot",
  "cat",
  "fox",
  "alien",
  "astronaut",
  "skull",
  "octopus",
  "dragon",
  "owl",
  "slime",
];
export const isAvatar = (raw: unknown): raw is string =>
  typeof raw === "string" && avatars.includes(raw);
