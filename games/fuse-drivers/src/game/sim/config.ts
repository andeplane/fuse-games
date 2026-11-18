/** VGA refresh (70 Hz), with one simulation frame every three retraces. */
export const TICK_RATE = 70 / 3;
export const DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;
const deg = (d: number) => (d * Math.PI) / 180;

/** Screen-space stats retained in the room snapshot. Native driving upgrades live in offroad/campaign. */
export interface TruckStats {
  topSpeed: number;
  accelTime: number;
  turnRateHigh: number;
  landingMul: number;
  maxArmor: number;
  nitros: number;
  mass: number;
}

export const BASE_STATS: TruckStats = {
  topSpeed: 200,
  accelTime: 1.2,
  turnRateHigh: deg(180),
  landingMul: 0.85,
  maxArmor: 4,
  nitros: 25,
  mass: 1,
};

export const config = {
  /** Simulation world in units (map plus the 4 u strip below it, ADR 003). */
  world: { width: 1024, height: 516 },
  /** Canvas size; the race camera zooms the world to fill it below the HUD strip. */
  screen: { width: 1600, height: 900 },
  tile: 32,
  laps: 4,
  countdownTicks: 40,
  truck: { wrongWayTicks: 30 },
} as const;
