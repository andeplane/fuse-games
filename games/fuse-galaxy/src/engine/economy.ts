/**
 * Prices, durations and income: pure functions of a planet and the rules. The command check, the tick and the view
 * helpers all call these, so a price shown to a player is the price the engine charges.
 */
import { PERCENT, ceilDiv, div, isqrt, max, min, percentOf } from "./math.js";
import type { Rules } from "./rules.js";
import {
  RESOURCE_IDS,
  SHIP_CLASSES,
  STRUCTURE_IDS,
  type BranchId,
  type DeepReadonly,
  type Planet,
  type ResourceId,
  type Resources,
  type ShipClass,
  type ShipCounts,
  type StructureId,
} from "./world.js";

type PlanetState = DeepReadonly<Planet>;

/** A resource record built one resource at a time. */
export const resourcesFrom = (
  amount: (resource: ResourceId) => number,
): Resources => ({
  metal: amount("metal"),
  crystal: amount("crystal"),
  eonium: amount("eonium"),
});

export const canAfford = (
  have: Readonly<Resources>,
  cost: Readonly<Resources>,
): boolean =>
  RESOURCE_IDS.every((resource) => have[resource] >= cost[resource]);

export const totalOf = (amounts: Readonly<Resources>): number =>
  amounts.metal + amounts.crystal + amounts.eonium;

/** How many times `unit` fits in `have`, at most `limit`. */
export function affordableCount(
  have: Readonly<Resources>,
  unit: Readonly<Resources>,
  limit: number,
): number {
  let count = limit;
  for (const resource of RESOURCE_IDS)
    if (unit[resource] > 0)
      count = min(count, div(have[resource], unit[resource]));
  return count;
}

/** What the next asteroid of a resource costs a planet that already owns `owned` of it. */
export function asteroidCost(owned: number, rules: Rules): Resources {
  // n² + 3n + 2, written as its factors.
  const shape = (owned + 1) * (owned + 2);
  return resourcesFrom((resource) =>
    div(
      rules.asteroid.costNumerator[resource] * shape,
      rules.asteroid.costDenominator,
    ),
  );
}

/** A price that grows by `growthPercent` of the base with each of the `steps` taken before it. */
const grown = (
  base: Readonly<Resources>,
  growthPercent: number,
  steps: number,
): Resources =>
  resourcesFrom((resource) =>
    percentOf(base[resource], PERCENT + growthPercent * steps),
  );

/** A duration shortened by every copy of a structure past the first, never below one tick. */
const quickened = (
  ticks: number,
  copies: number,
  speedPercent: number,
  maxSpeedPercent: number,
): number =>
  max(
    1,
    div(
      ticks * PERCENT,
      PERCENT + min(maxSpeedPercent, max(0, copies - 1) * speedPercent),
    ),
  );

/** How many of a structure the planet has built or ordered. */
export const structureCopies = (
  planet: PlanetState,
  structure: StructureId,
): number =>
  planet.construction.reduce(
    (count, job) => count + (job.structure === structure ? 1 : 0),
    planet.structures[structure],
  );

/** What the planet's next copy of a structure costs. */
export const structureCost = (
  planet: PlanetState,
  structure: StructureId,
  rules: Rules,
): Resources =>
  grown(
    rules.structures[structure].cost,
    rules.structures[structure].costGrowthPercent,
    structureCopies(planet, structure),
  );

/** The level a branch is at once everything queued for it is done. */
export const pendingLevel = (planet: PlanetState, branch: BranchId): number =>
  planet.researchQueue.reduce(
    (level, job) => level + (job.branch === branch ? 1 : 0),
    planet.research[branch],
  );

/** What the planet's next level of a branch costs. */
export const researchCost = (
  planet: PlanetState,
  branch: BranchId,
  rules: Rules,
): Resources =>
  grown(
    rules.research.branches[branch].cost,
    rules.research.branches[branch].costGrowthPercent,
    pendingLevel(planet, branch),
  );

/** How long the planet's next level of a branch takes. */
export const researchTicks = (
  planet: PlanetState,
  branch: BranchId,
  rules: Rules,
): number =>
  quickened(
    percentOf(
      rules.research.branches[branch].ticks,
      PERCENT +
        rules.research.branches[branch].ticksGrowthPercent *
          pendingLevel(planet, branch),
    ),
    planet.structures[rules.research.structure],
    rules.research.speedPercent,
    rules.research.maxSpeedPercent,
  );

export const shipCost = (
  shipClass: ShipClass,
  count: number,
  rules: Rules,
): Resources =>
  resourcesFrom((resource) => rules.ships[shipClass].cost[resource] * count);

/** How long the planet takes to produce one order of a class, whatever its size. */
export const productionTicks = (
  planet: PlanetState,
  shipClass: ShipClass,
  rules: Rules,
): number =>
  quickened(
    rules.ships[shipClass].buildTicks,
    planet.structures[rules.production.structure],
    rules.production.speedPercent,
    rules.production.maxSpeedPercent,
  );

/** What the planet earns in one tick, before its team's tax. */
export function income(planet: PlanetState, rules: Rules): Resources {
  const mining =
    PERCENT + planet.research.mining * rules.economy.miningPercentPerLevel;
  return resourcesFrom((resource) => {
    let amount =
      rules.economy.baseIncome[resource] +
      percentOf(
        planet.asteroids[resource] * rules.economy.asteroidIncome[resource],
        mining,
      );
    for (const structure of STRUCTURE_IDS)
      amount +=
        planet.structures[structure] *
        rules.structures[structure].income[resource];
    return planet.kind === "neutral"
      ? percentOf(amount, rules.neutral.incomePercent)
      : amount;
  });
}

/** The share of an income a team's tax diverts to its fund. */
export const taxOn = (
  gross: Readonly<Resources>,
  taxPercent: number,
): Resources =>
  resourcesFrom((resource) => percentOf(gross[resource], taxPercent));

export const shipTotal = (ships: Readonly<Partial<ShipCounts>>): number =>
  SHIP_CLASSES.reduce((sum, shipClass) => sum + (ships[shipClass] ?? 0), 0);

/** The straight-line distance between two map positions, rounded down. */
export function distance(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  const dx = a.x - b.x,
    dy = a.y - b.y;
  return isqrt(dx * dx + dy * dy);
}

/** How long a fleet of these ships takes to fly between two planets: it flies at its slowest ship's speed. */
export function travelTicks(
  origin: { readonly x: number; readonly y: number },
  target: { readonly x: number; readonly y: number },
  ships: Readonly<Partial<ShipCounts>>,
  travelLevel: number,
  rules: Rules,
): number {
  let speed = 0;
  for (const shipClass of SHIP_CLASSES)
    if ((ships[shipClass] ?? 0) > 0)
      speed =
        speed === 0
          ? rules.ships[shipClass].speed
          : min(speed, rules.ships[shipClass].speed);
  return (
    rules.fleet.launchTicks +
    ceilDiv(
      distance(origin, target) * PERCENT,
      max(1, speed) *
        (PERCENT + travelLevel * rules.fleet.travelPercentPerLevel),
    )
  );
}
