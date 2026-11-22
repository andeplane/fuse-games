/**
 * The first world of a match: seats in teams, each team's planets around its anchor, and bot-run neutral planets
 * scattered over the rest of the map from the seed. Seats take the low planet ids, dealt round the teams so the
 * fixed command order alternates between them; the neutral planets follow.
 */
import { distance } from "./economy.js";
import { isRecord, isWhole } from "./guards.js";
import { roll, seedState } from "./rng.js";
import type { Rules } from "./rules.js";
import { updateScores } from "./score.js";
import {
  NONE,
  RESOURCE_IDS,
  noResources,
  noShips,
  type Planet,
  type PlanetKind,
  type Resources,
  type Team,
  type World,
  type WorldDraft,
} from "./world.js";

export interface MatchSetup {
  /** How many teams (galaxies) play. */
  readonly teams: number;
  /** Seats in each team. */
  readonly teamSize: number;
  /** Bot-run neutral planets on the map. */
  readonly neutrals: number;
}

export const SETUP_2V2: MatchSetup = { teams: 2, teamSize: 2, neutrals: 6 };
export const SETUP_3V3: MatchSetup = { teams: 2, teamSize: 3, neutrals: 6 };

const whole = isWhole;

/** Reads a setup from untrusted data; undefined when it is not one. */
export function parseSetup(value: unknown): MatchSetup | undefined {
  if (!isRecord(value)) return undefined;
  const { teams, teamSize, neutrals } = value;
  return whole(teams) && whole(teamSize) && whole(neutrals)
    ? { teams, teamSize, neutrals }
    : undefined;
}

/** Why a match cannot be set up this way, or undefined when it can. */
export function setupProblem(
  setup: MatchSetup,
  rules: Rules,
): string | undefined {
  const limits = rules.setup;
  if (
    !whole(setup.teams) ||
    setup.teams < limits.minTeams ||
    setup.teams > limits.maxTeams
  )
    return `a match has ${limits.minTeams} to ${limits.maxTeams} teams`;
  if (
    !whole(setup.teamSize) ||
    setup.teamSize < 1 ||
    setup.teamSize > limits.maxTeamSize
  )
    return `a team has 1 to ${limits.maxTeamSize} seats`;
  if (setup.teams * setup.teamSize > limits.maxSeats)
    return `a match has at most ${limits.maxSeats} seats`;
  if (
    !whole(setup.neutrals) ||
    setup.neutrals < 0 ||
    setup.neutrals > limits.maxNeutrals
  )
    return `a match has 0 to ${limits.maxNeutrals} neutral planets`;
  return undefined;
}

function planet(
  id: number,
  kind: PlanetKind,
  team: number,
  x: number,
  y: number,
  resources: Readonly<Resources>,
  asteroids: Readonly<Resources>,
  rules: Rules,
): Planet {
  return {
    id,
    kind,
    team,
    x,
    y,
    resources: { ...resources },
    asteroids: { ...asteroids },
    structures: { ...rules.start.structures },
    research: { travel: 0, hulls: 0, sensors: 0, mining: 0, jamming: 0 },
    construction: [],
    researchQueue: [],
    production: [],
    ships: noShips(),
    value: 0,
    score: 0,
  };
}

/** A spot for a neutral planet: the first random one far enough from every planet so far, or the last one tried. */
function neutralSpot(
  stream: { rng: number },
  planets: readonly Planet[],
  rules: Rules,
): { x: number; y: number } {
  const { size, margin, minSeparation, placementAttempts } = rules.map;
  const span = size - 2 * margin + 1;
  let spot = { x: margin, y: margin };
  for (let attempt = 0; attempt < placementAttempts; attempt++) {
    spot = { x: margin + roll(stream, span), y: margin + roll(stream, span) };
    const here = spot;
    if (planets.every((other) => distance(here, other) >= minSeparation)) break;
  }
  return spot;
}

/**
 * The world a match starts from. Throws a `RangeError` for a seed that is not a whole number or a setup the rules
 * do not allow (`setupProblem`): those come from the host, not from a player.
 */
export function createWorld(
  seed: number,
  setup: MatchSetup,
  rules: Rules,
): World {
  if (!whole(seed)) throw new RangeError("the seed must be a whole number");
  const problem = setupProblem(setup, rules);
  if (problem) throw new RangeError(problem);

  const stream = { rng: seedState(seed) };
  const planets: Planet[] = [];
  const teams: Team[] = Array.from({ length: setup.teams }, (_, id) => ({
    id,
    members: [],
    fund: noResources(),
    taxPercent: 0,
    commander: NONE,
    votes: [],
    defencePriority: NONE,
  }));
  for (let place = 0; place < setup.teamSize; place++)
    for (const team of teams) {
      const [anchorX, anchorY] = rules.map.teamAnchors[team.id]!;
      const [offsetX, offsetY] = rules.map.memberOffsets[place]!;
      team.members.push(planets.length);
      team.votes.push(NONE);
      planets.push(
        planet(
          planets.length,
          "seat",
          team.id,
          anchorX + offsetX,
          anchorY + offsetY,
          rules.start.resources,
          rules.start.asteroids,
          rules,
        ),
      );
    }
  for (let index = 0; index < setup.neutrals; index++) {
    const { x, y } = neutralSpot(stream, planets, rules);
    const asteroids = { ...rules.neutral.asteroids };
    for (const resource of RESOURCE_IDS)
      asteroids[resource] += roll(stream, rules.neutral.extraAsteroids + 1);
    planets.push(
      planet(
        planets.length,
        "neutral",
        NONE,
        x,
        y,
        rules.neutral.resources,
        asteroids,
        rules,
      ),
    );
  }
  updateScores(planets, [], rules);
  const world: WorldDraft = {
    rulesVersion: rules.version,
    seed,
    tick: 0,
    rng: stream.rng,
    phase: "running",
    result: null,
    planets,
    fleets: [],
    nextFleetId: 1,
    teams,
    knowledge: planets.map(() => ({ reports: [] })),
    events: [],
  };
  return world;
}
