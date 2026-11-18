/** Fuserod's room uses 20 log ticks per second. */
export const CAPACITY = 5;
export const COUNTDOWN_TICKS = 60;
export const MAX_RACE_TICKS = 20 * 240;
export const ROUTES = ["strip", "aqueduct", "canyon"] as const;
export type Route = (typeof ROUTES)[number];
export type Grade = 0 | 1 | 2;
export type Direction = -1 | 0 | 1;
export interface DriveInput {
  throttle: boolean;
  brake: boolean;
  steer: Direction;
  shift: Direction;
}
export const released = (): DriveInput => ({
  throttle: false,
  brake: false,
  steer: 0,
  shift: 0,
});
export const isDirection = (v: unknown): v is Direction =>
  v === -1 || v === 0 || v === 1;
export const isGrade = (v: unknown): v is Grade =>
  v === 0 || v === 1 || v === 2;
export const isRoute = (v: unknown): v is Route => ROUTES.some((r) => r === v);
export const isBotId = (id: string) => /^bot:[1-9][0-9]{0,5}$/.test(id);
export const validName = (v: unknown): v is string =>
  typeof v === "string" &&
  v.trim() === v &&
  Array.from(v).length > 0 &&
  Array.from(v).length <= 18 &&
  !/[\u0000-\u001f\u007f]|\p{Cs}/u.test(v);
export function seatName(raw: string): string | undefined {
  const name = Array.from(raw.trim()).slice(0, 18).join("").trim();
  return validName(name) ? name : undefined;
}
export const matchId = (v: unknown): v is string =>
  typeof v === "string" && /^[\x21-\x7e]{1,64}$/.test(v);
export const validId = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[\w:.-]{1,64}$/.test(v) &&
  !(v in Object.prototype);
export function object(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
export const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;

export interface FuserodSettings {
  display: boolean;
  route: Route;
  power: Grade;
  tires: Grade;
  gearbox: Grade;
  opponent: Grade;
}
export const DEFAULT_SETTINGS: FuserodSettings = {
  display: false,
  route: "strip",
  power: 0,
  tires: 0,
  gearbox: 0,
  opponent: 0,
};
export function parseSettings(v: unknown): FuserodSettings | undefined {
  if (!object(v) || Object.keys(v).length !== 6) return;
  const { display, route, power, tires, gearbox, opponent } = v;
  if (
    typeof display !== "boolean" ||
    !isRoute(route) ||
    !isGrade(power) ||
    !isGrade(tires) ||
    !isGrade(gearbox) ||
    !isGrade(opponent)
  )
    return;
  return { display, route, power, tires, gearbox, opponent };
}
/** Original race lengths in 64ths of a track segment. The Grudge Strip is a quarter mile. */
export const FINISH: Record<Route, number> = {
  strip: 5120,
  aqueduct: 21376,
  canyon: 37760,
};
export const metres = (units: number) => (units * 402.336) / 5120;

/** Original Fuse bend profiles, sampled in integer road coordinates. Positive is a right-hand bend. */
const BENDS: Record<Route, readonly number[]> = {
  strip: [0],
  aqueduct: [0, 0, 190, 270, 40, -180, -280, -90, 120, 240, 0, 0],
  canyon: [0, 130, 460, 300, -80, -420, -480, 40, 400, 500, 80, -460, -140, 0],
};
export function roadCurve(route: Route, position: number): number {
  const nodes = BENDS[route];
  const offset =
    Math.max(0, Math.min(FINISH[route], position)) * (nodes.length - 1);
  const idx = Math.floor(offset / FINISH[route]);
  const next = nodes[Math.min(nodes.length - 1, idx + 1)]!;
  return (
    nodes[idx]! +
    Math.trunc(
      ((next - nodes[idx]!) * (offset % FINISH[route])) / FINISH[route],
    )
  );
}
