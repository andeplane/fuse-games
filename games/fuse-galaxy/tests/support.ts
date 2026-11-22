/** What the Fuse Galaxy tests share: building a world in a chosen state, sending commands, reading what happened. */
import {
  DEFAULT_RULES,
  SETUP_2V2,
  applyTick,
  createWorld,
  type Command,
  type DeepReadonly,
  type GameEvent,
  type MatchSetup,
  type Planet,
  type Resources,
  type Rules,
  type Team,
  type UntrustedSubmission,
  type World,
} from "../src/engine/index.js";

export const RULES = DEFAULT_RULES;

/** More of everything than any test spends. */
export const RICH: Resources = {
  metal: 1_000_000,
  crystal: 1_000_000,
  eonium: 1_000_000,
};

/**
 * A 2v2 world with six neutral planets unless told otherwise. Seats 0 and 2 are team 0, seats 1 and 3 team 1, and
 * planets 4 to 9 are neutral.
 */
export const start = (
  seed = 1,
  setup: MatchSetup = SETUP_2V2,
  rules: Rules = RULES,
): World => createWorld(seed, setup, rules);

/** The world with one planet changed: a state to test from, built without playing up to it. */
export const withPlanet = (
  world: World,
  id: number,
  patch: Partial<DeepReadonly<Planet>>,
): World => ({
  ...world,
  planets: world.planets.map((planet) =>
    planet.id === id ? { ...planet, ...patch } : planet,
  ),
});

export const withTeam = (
  world: World,
  id: number,
  patch: Partial<DeepReadonly<Team>>,
): World => ({
  ...world,
  teams: world.teams.map((team) =>
    team.id === id ? { ...team, ...patch } : team,
  ),
});

/** Every seat and neutral planet as rich as `RICH`. */
export const rich = (world: World): World => ({
  ...world,
  planets: world.planets.map((planet) => ({ ...planet, resources: RICH })),
});

/** Commands from one player, in order. */
export const from = (
  player: number,
  ...commands: Command[]
): UntrustedSubmission[] => commands.map((command) => ({ player, command }));

/** One tick with these submissions, which the engine takes as untrusted data. */
export const tick = (
  world: World,
  submissions: readonly unknown[] = [],
  rules: Rules = RULES,
): World => applyTick(world, submissions, rules);

/** This many ticks with nothing submitted. */
export function idle(world: World, ticks: number, rules: Rules = RULES): World {
  let now = world;
  for (let count = 0; count < ticks; count++) now = applyTick(now, [], rules);
  return now;
}

type Rejection = Extract<DeepReadonly<GameEvent>, { type: "rejected" }>;

export const rejections = (world: World): Rejection[] =>
  world.events.filter((event): event is Rejection => event.type === "rejected");

/** Why the last tick refused what it refused. */
export const reasons = (world: World): string[] =>
  rejections(world).map((event) => event.reason);

/** The reason one command from one player is refused in this world, or undefined when it is carried out. */
export const refusal = (
  world: World,
  player: number,
  command: Command,
  rules: Rules = RULES,
): string | undefined => reasons(tick(world, from(player, command), rules))[0];

export const eventsOf = <T extends GameEvent["type"]>(
  world: World,
  type: T,
): Extract<DeepReadonly<GameEvent>, { type: T }>[] =>
  world.events.filter(
    (event): event is Extract<DeepReadonly<GameEvent>, { type: T }> =>
      event.type === type,
  );

/** Whether a value is frozen all the way down, so that nothing given it can change it. */
export const frozen = (value: unknown): boolean =>
  typeof value !== "object" ||
  value === null ||
  (Object.isFrozen(value) && Object.values(value).every(frozen));
