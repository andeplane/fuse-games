import type { OffroadDriver } from "../offroad/campaign.js";
import type { OffroadCpuState } from "../offroad/cpu.js";
import { BASE_STATS, type TruckStats } from "./config.js";
import { createOffroadMotion, type OffroadMotion } from "../offroad/motion.js";
import {
  createOffroadSuspension,
  type OffroadSuspension,
} from "../offroad/suspension.js";

export type ItemKind =
  "mine" | "oil" | "nitro" | "shield" | "missile" | "drone" | "emp";

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
  armor: number;
  nitros: number;
  item: ItemKind | null;
  turnDir: -1 | 0 | 1;
  turnHeldTicks: number;
  driftDir: -1 | 0 | 1;
  driftTicks: number;
  boostUntilTick: number;
  nitroUntilTick: number;
  padUntilTick: number;
  airborneUntilTick: number;
  spinUntilTick: number;
  /** EMP: no steering until this tick. */
  stunUntilTick: number;
  oilUntilTick: number;
  shieldUntilTick: number;
  invulnerableUntilTick: number;
  lockedUntilTick: number;
  /** Tick at which a destroyed truck respawns; 0 when alive. */
  respawnAtTick: number;
  respawnedTick: number;
  toxicNextTick: number;
  landAtTick: number;
  wallTicks: number;
  prevNitro: boolean;
  /** Set while crossing a bridge deck: walls tagged `under` are ignored and the truck draws above decor (ADR 003). */
  onBridge: boolean;
  laps: number;
  checkpoint: number;
  progress: number;
  wrongWayTicks: number;
  finishedTick: number;
  kills: number;
  deaths: number;
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
    armor: stats.maxArmor,
    nitros: stats.nitros,
    item: null,
    turnDir: 0,
    turnHeldTicks: 0,
    driftDir: 0,
    driftTicks: 0,
    boostUntilTick: 0,
    nitroUntilTick: 0,
    padUntilTick: 0,
    airborneUntilTick: 0,
    spinUntilTick: 0,
    stunUntilTick: 0,
    oilUntilTick: 0,
    shieldUntilTick: 0,
    invulnerableUntilTick: 0,
    lockedUntilTick: 0,
    respawnAtTick: 0,
    respawnedTick: 0,
    toxicNextTick: 0,
    landAtTick: 0,
    wallTicks: 0,
    prevNitro: false,
    onBridge: false,
    laps: 0,
    checkpoint: 0,
    progress: 0,
    wrongWayTicks: 0,
    finishedTick: 0,
    kills: 0,
    deaths: 0,
    lapsLed: 0,
    nitrosUsed: 0,
  };
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Angle in [-pi, pi), by exact arithmetic so it is bit-identical on every platform (fmath.ts). */
export const wrapAngle = (a: number) =>
  a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI)) + 0;
