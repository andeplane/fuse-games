import {
  offroadDriveStats,
  type OffroadDriveStats,
  type OffroadUpgradeLevel,
} from "./motion.js";
import { offroadRacePurse } from "./pickups.js";
import type { OffroadSuspensionSetup } from "./suspension.js";

/** GAME.EXE DS:01ad. A variant's low three bits select a course, bit 3 reverses it. */
const CAMPAIGN = [
  3, 6, 11, 14, 9, 3, 6, 1, 5, 11, 14, 9, 13, 15, 3, 6, 1, 5, 7, 4, 11, 14, 9,
  13, 15, 12, 8, 3, 6, 1, 5, 7, 4, 0, 2, 11, 14, 9, 13, 15, 12, 8, 10,
];

function bounded(value: unknown, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    !Object.is(value, -0) &&
    value >= 0 &&
    value <= max
  );
}

export const isCampaignIndex = (value: unknown): value is number =>
  bounded(value, CAMPAIGN.length - 1);

export function firstCampaignRace(variant: number): number {
  const index = CAMPAIGN.indexOf(variant);
  if (index < 0) throw new RangeError("Unknown Off Road variant");
  return index;
}

export function campaignVariant(index: number): number {
  if (!isCampaignIndex(index)) throw new RangeError("Invalid race index");
  return CAMPAIGN[index]!;
}

/** CS:01d5 repeats the last sixteen entries after race 43. */
export function nextCampaignRace(index: number): number {
  if (!isCampaignIndex(index)) throw new RangeError("Invalid race index");
  return index + 1 < CAMPAIGN.length ? index + 1 : 27;
}

/** Decimal values of the DOS BCD wallet, in units of $10,000 in the speed shop. */
export interface OffroadDriver {
  cash: number;
  careerEarnings: number;
  credits: number;
  nitros: number;
  shocks: OffroadUpgradeLevel;
  tires: OffroadUpgradeLevel;
  acceleration: OffroadUpgradeLevel;
  topSpeed: OffroadUpgradeLevel;
}

export function isOffroadDriver(value: unknown): value is OffroadDriver {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  return (
    Object.keys(d).length === 8 &&
    bounded(d.cash, 9999) &&
    bounded(d.careerEarnings, 9999) &&
    bounded(d.credits, 9) &&
    bounded(d.nitros, 99) &&
    bounded(d.shocks, 5) &&
    bounded(d.tires, 5) &&
    bounded(d.acceleration, 5) &&
    bounded(d.topSpeed, 5)
  );
}

/** CS:131a and CS:1388 initialize a fresh player. */
export function createOffroadDriver(): OffroadDriver {
  return {
    cash: 0,
    careerEarnings: 0,
    credits: 2,
    nitros: 25,
    shocks: 0,
    tires: 0,
    acceleration: 0,
    topSpeed: 0,
  };
}

/** Prices, field mapping and caps from DS:9508, DS:950e and DS:9514. */
export const OFFROAD_SHOP = {
  nitros: { cost: 1, cap: 99 },
  acceleration: { cost: 8, cap: 5 },
  topSpeed: { cost: 10, cap: 5 },
  shocks: { cost: 6, cap: 5 },
  tires: { cost: 4, cap: 5 },
} as const;
export type OffroadPurchase = keyof typeof OFFROAD_SHOP;

export function buyOffroadUpgrade(
  driver: OffroadDriver,
  kind: OffroadPurchase,
): OffroadDriver | null {
  const { cost, cap } = OFFROAD_SHOP[kind];
  if (driver[kind] >= cap) return null;
  // CS:2e01 consumes a single game credit for twenty cash units when needed.
  const spendCredit = driver.cash < cost;
  if (spendCredit && !driver.credits) return null;
  return {
    ...driver,
    cash: driver.cash + (spendCredit ? 20 : 0) - cost,
    credits: driver.credits - Number(spendCredit),
    [kind]: driver[kind] + 1,
  };
}

/** One-based finish place. Both four-digit BCD counters wrap in CS:376e. */
export function payOffroadDriver(
  driver: OffroadDriver,
  place: number,
  bagCash: number,
  nitrosRemaining: number,
): OffroadDriver {
  if (!bounded(place, 5) || place === 0) throw new RangeError("Invalid place");
  if (!bounded(bagCash, 99) || !bounded(nitrosRemaining, 99))
    throw new RangeError("Invalid race inventory");
  const prize = offroadRacePurse(place - 1, bagCash);
  return {
    ...driver,
    cash: (driver.cash + prize) % 10000,
    careerEarnings: (driver.careerEarnings + prize) % 10000,
    nitros: nitrosRemaining,
  };
}

export function offroadVehicleSetup(
  driver: Pick<OffroadDriver, "shocks" | "tires" | "topSpeed">,
): { drive: OffroadDriveStats; suspension: OffroadSuspensionSetup } {
  const drive = offroadDriveStats(driver.tires, driver.topSpeed);
  // CS:147c..14c6. The original loads an acceleration table entry but stores
  // the spawn-Y register instead. createOffroadMotion reproduces that behavior.
  return {
    drive,
    suspension: {
      rebound: [15360, 14080, 12800, 11520, 10496, 9472][driver.shocks]!,
      contactTolerance: [2, 3, 4, 5, 6, 8][driver.tires]!,
      topSpeed: drive.speedLimit,
    },
  };
}
