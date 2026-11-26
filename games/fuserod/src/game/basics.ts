import { nativeCourseSample } from "../course/geometry.js";
import { isCarCalibration, type CarCalibration } from "../motor/calibration.js";
/** Fuserod's room uses 20 log ticks per second. */
export const CAPACITY = 5;
export const COUNTDOWN_TICKS = 60;
export const MAX_RACE_TICKS = 20 * 240;
export const ROUTES = ["strip", "aqueduct", "canyon"] as const;
export type Route = (typeof ROUTES)[number];
export type RaceVariant = "street" | "timed" | "grudge" | "duel";
export const validVariant = (route: Route, v: unknown): v is RaceVariant =>
  route === "strip"
    ? v === "street" || v === "timed" || v === "grudge"
    : v === "duel";
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
  calibration?: CarCalibration;
  display: boolean;
  variant: RaceVariant;
  automatic: boolean;
  dialInTicks: number;
  king: boolean;
  route: Route;
  power: Grade;
  tires: Grade;
  gearbox: Grade;
  opponent: Grade;
}
export const DEFAULT_SETTINGS: FuserodSettings = {
  display: false,
  variant: "street",
  automatic: false,
  dialInTicks: 0,
  king: false,
  route: "strip",
  power: 0,
  tires: 0,
  gearbox: 0,
  opponent: 0,
};
export function parseSettings(v: unknown): FuserodSettings | undefined {
  if (!object(v)) return;
  const calibrated = Object.hasOwn(v, "calibration");
  const calibration = isCarCalibration(v.calibration)
    ? v.calibration
    : undefined;
  if (
    Object.keys(v).length !== (calibrated ? 11 : 10) ||
    (calibrated && !calibration)
  )
    return;
  const {
    display,
    route,
    power,
    tires,
    gearbox,
    opponent,
    variant,
    automatic,
    dialInTicks,
    king,
  } = v;
  if (
    typeof display !== "boolean" ||
    typeof automatic !== "boolean" ||
    !isRoute(route) ||
    !validVariant(route, variant) ||
    !integer(dialInTicks, 0, 1600) ||
    (variant !== "grudge" && dialInTicks !== 0) ||
    typeof king !== "boolean" ||
    !isGrade(power) ||
    !isGrade(tires) ||
    !isGrade(gearbox) ||
    !isGrade(opponent)
  )
    return;
  return {
    ...(calibration && { calibration: structuredClone(calibration) }),
    display,
    route,
    power,
    tires,
    gearbox,
    opponent,
    variant,
    automatic,
    dialInTicks,
    king,
  };
}
/** Original race lengths in 64ths of a track segment. The Grudge Strip is a quarter mile. */
export const FINISH: Record<Route, number> = {
  strip: 5120,
  aqueduct: 21376,
  canyon: 37760,
};
export function finishUnits(route: Route, variant: RaceVariant): number {
  return variant === "street" ? 11520 : FINISH[route];
}
export const metres = (units: number) => (units * 402.336) / 5120;

/** Translate native heading deltas into the signed steering scale used by the Fuse controls. */
export function roadCurve(route: Route, position: number, layout = 0): number {
  return Math.max(
    -500,
    Math.min(
      500,
      Math.round((nativeCourseSample(route, position, layout).bend * 500) / 7),
    ),
  );
}
export function courseLayout(route: Route, seed: number): number {
  return route === "canyon" ? seed % 10 : 0;
}
