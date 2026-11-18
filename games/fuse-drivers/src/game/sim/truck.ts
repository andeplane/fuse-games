import type { OffroadDriver } from "../offroad/campaign.js";
import type { OffroadCpuState } from "../offroad/cpu.js";
import { BASE_STATS, type TruckStats } from "./config.js";
import { createOffroadMotion, type OffroadMotion } from "../offroad/motion.js";
import {
  createOffroadSuspension,
  type OffroadSuspension,
} from "../offroad/suspension.js";

/** Plain JSON truck record. Timers are absolute ticks; 0 means inactive (ADR 002). */
export interface Truck {
  slot: number;
  motion: OffroadMotion;
  suspension: OffroadSuspension;
  contactMask: number;
  cash: number;
  cpu?: OffroadCpuState;
  cpuBase?: number;
  upgrades?: Pick<OffroadDriver, "topSpeed" | "tires" | "shocks">;
  dosProgress: number;
  x: number;
  y: number;
  /** Radians, 0 = +x, clockwise positive (y down). */
  heading: number;
  speed: number;
  stats: TruckStats;
  nitros: number;
  turnDir: -1 | 0 | 1;
  nitroUntilTick: number;
  airborneUntilTick: number;
  wallTicks: number;
  prevNitro: boolean;
  laps: number;
  checkpoint: number;
  progress: number;
  wrongWayTicks: number;
  finishedTick: number;
  lapsLed: number;
  nitrosUsed: number;
}

export function createTruck(
  slot: number,
  x: number,
  y: number,
  heading: number,
  stats: TruckStats = BASE_STATS,
  motion = createOffroadMotion(
    Math.round(x * 16),
    Math.round(y * 16),
    Math.round((heading * 65536) / (2 * Math.PI)) & 0xffff,
    stats.nitros,
  ),
  suspension = createOffroadSuspension(),
): Truck {
  return {
    slot,
    motion,
    suspension,
    contactMask: 0,
    cash: 0,
    dosProgress: 0,
    x,
    y,
    heading,
    speed: 0,
    stats,
    nitros: stats.nitros,
    turnDir: 0,
    nitroUntilTick: 0,
    airborneUntilTick: 0,
    wallTicks: 0,
    prevNitro: false,
    laps: 0,
    checkpoint: 0,
    progress: 0,
    wrongWayTicks: 0,
    finishedTick: 0,
    lapsLed: 0,
    nitrosUsed: 0,
  };
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Angle in [-pi, pi), by exact arithmetic so it is bit-identical on every platform (fmath.ts). */
export const wrapAngle = (a: number) =>
  a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI)) + 0;
