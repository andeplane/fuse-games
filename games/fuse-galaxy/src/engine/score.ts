/**
 * Value and score. A planet's value is what it owns now, each thing weighted by the rules: asteroids, structures,
 * research levels, ships (at home and in its fleets) and its stock of resources. Score is what ranks a planet and
 * decides the match: its value and what it has earned by fighting.
 *
 * The score is public in three parts, as on a strategy game's scoreboard: economy (asteroids, structures and stock),
 * military (ships and what fighting earned) and technology (research).
 */
import { totalOf } from "./economy.js";
import { div } from "./math.js";
import type { Rules } from "./rules.js";
import {
  BRANCH_IDS,
  NONE,
  SHIP_CLASSES,
  STRUCTURE_IDS,
  type DeepReadonly,
  type Fleet,
  type MatchResult,
  type Planet,
  type Resources,
  type ScoreParts,
  type ShipCounts,
  type Team,
  type WorldDraft,
} from "./world.js";

export const shipsValue = (ships: Readonly<ShipCounts>, rules: Rules): number =>
  SHIP_CLASSES.reduce(
    (sum, shipClass) => sum + ships[shipClass] * rules.ships[shipClass].value,
    0,
  );

/** What a stock of resources is worth as value. */
export const stockValue = (stock: Readonly<Resources>, rules: Rules): number =>
  div(totalOf(stock), rules.score.resourceDivisor);

/** A planet's score in its parts, given what its fleets' ships are worth. */
export function scoreParts(
  planet: DeepReadonly<Planet>,
  fleetValue: number,
  rules: Rules,
): ScoreParts {
  let economy =
    stockValue(planet.resources, rules) +
    totalOf(planet.asteroids) * rules.asteroid.value;
  for (const structure of STRUCTURE_IDS)
    economy += planet.structures[structure] * rules.structures[structure].value;
  let technology = 0;
  for (const branch of BRANCH_IDS)
    technology +=
      planet.research[branch] * rules.research.branches[branch].value;
  return {
    economy,
    military: fleetValue + shipsValue(planet.ships, rules) + planet.xp,
    technology,
  };
}

/** A planet's value, given what its fleets' ships are worth: its score without what it earned by fighting. */
export function planetValue(
  planet: DeepReadonly<Planet>,
  fleetValue: number,
  rules: Rules,
): number {
  const parts = scoreParts(planet, fleetValue, rules);
  return parts.economy + parts.military + parts.technology - planet.xp;
}

/** Sets every planet's value, score and its parts from what the world holds now. */
export function updateScores(
  planets: Planet[],
  fleets: readonly DeepReadonly<Fleet>[],
  rules: Rules,
): void {
  const fleetValue = planets.map(() => 0);
  for (const fleet of fleets)
    fleetValue[fleet.owner]! += shipsValue(fleet.ships, rules);
  for (const planet of planets) {
    const parts = scoreParts(planet, fleetValue[planet.id]!, rules);
    planet.parts = parts;
    planet.score = parts.economy + parts.military + parts.technology;
    planet.value = planet.score - planet.xp;
  }
}

/** A team's score: its members' scores and what its fund is worth. */
export const teamScore = (
  team: DeepReadonly<Team>,
  planets: readonly DeepReadonly<Planet>[],
  rules: Rules,
): number =>
  team.members.reduce(
    (sum, member) => sum + planets[member]!.score,
    stockValue(team.fund, rules),
  );

/** Ends the match once the tick limit is reached: the team with the highest score wins, and a tie is a draw. */
export function endMatch(world: WorldDraft, rules: Rules): void {
  if (world.tick < rules.match.tickLimit) return;
  const teamScores = world.teams.map((team) =>
    teamScore(team, world.planets, rules),
  );
  let winner = NONE,
    best = -1;
  for (const [team, score] of teamScores.entries()) {
    if (score > best) {
      best = score;
      winner = team;
    } else if (score === best) winner = NONE;
  }
  const result: MatchResult = { tick: world.tick, winner, teamScores };
  world.phase = "ended";
  world.result = result;
  world.events.push({ type: "matchEnded", winner });
}
