/**
 * What one player may know. A screen, a bot and a learning agent all read a `PlayerView`, never the world, so
 * nothing they do can depend on what the fog hides.
 *
 * A player sees their own planet and their teammates' planets in full, their team's record and every fleet the
 * team owns; of everyone else only what is public (where the planet is, whose side it is on, its score); and the
 * dated scout reports they and their teammates have gathered. A view shares the world's objects rather than copying
 * them, which is safe because a world is never changed once `applyTick` returns it.
 */
import type { CommandContext } from "./commands.js";
import {
  NONE,
  teamOf,
  type DeepReadonly,
  type Fleet,
  type GameEvent,
  type MatchResult,
  type Planet,
  type PlanetKind,
  type ScoutReport,
  type Team,
  type World,
} from "./world.js";

/** What everybody knows about a planet. */
export interface PublicPlanet {
  readonly id: number;
  readonly kind: PlanetKind;
  readonly team: number;
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

export interface PlayerView {
  readonly tick: number;
  readonly phase: World["phase"];
  readonly result: DeepReadonly<MatchResult> | null;
  /** The player's planet id. */
  readonly self: number;
  readonly planet: DeepReadonly<Planet>;
  /** The player's team, or null for a neutral planet. */
  readonly team: DeepReadonly<Team> | null;
  /** The teammates' planets, in id order. */
  readonly allies: readonly DeepReadonly<Planet>[];
  /** The player's fleets and their teammates'. */
  readonly fleets: readonly DeepReadonly<Fleet>[];
  /** Every planet on the map, by id. */
  readonly planets: readonly PublicPlanet[];
  /** The team's latest scout report on each planet it has observed, by target id. */
  readonly reports: readonly DeepReadonly<ScoutReport>[];
  /** What happened on the last tick that the player may know about. */
  readonly events: readonly DeepReadonly<GameEvent>[];
}

function visible(
  event: DeepReadonly<GameEvent>,
  self: number,
  team: number,
  allies: ReadonlySet<number>,
): boolean {
  switch (event.type) {
    case "rejected":
    case "asteroidInitiated":
      return event.player === self;
    case "commanderChanged":
      return event.team === team;
    case "matchEnded":
      return true;
    default:
      return event.player === self || allies.has(event.player);
  }
}

/** The view of the world for one player. Throws a `RangeError` when no planet has that id. */
export function viewFor(world: World, player: number): PlayerView {
  const planet = world.planets[player];
  if (!planet) throw new RangeError(`no planet has the id ${player}`);
  const team = teamOf(world.teams, planet.team) ?? null;
  const members: readonly number[] = team ? team.members : [player];
  const allies = new Set(members.filter((member) => member !== player));

  const reports = new Map<number, DeepReadonly<ScoutReport>>();
  for (const member of members)
    for (const report of world.knowledge[member]!.reports) {
      const known = reports.get(report.target);
      if (!known || report.tick > known.tick)
        reports.set(report.target, report);
    }

  return {
    tick: world.tick,
    phase: world.phase,
    result: world.result,
    self: player,
    planet,
    team,
    allies: world.planets.filter((other) => allies.has(other.id)),
    fleets: world.fleets.filter(
      (fleet) => fleet.owner === player || allies.has(fleet.owner),
    ),
    planets: world.planets.map(({ id, kind, team: side, x, y, score }) => ({
      id,
      kind,
      team: side,
      x,
      y,
      score,
    })),
    reports: [...reports.values()].sort((a, b) => a.target - b.target),
    events: world.events.filter((event) =>
      visible(event, player, team ? team.id : NONE, allies),
    ),
  };
}

/** What a command from the view's player is checked against (`commandProblem`). */
export const contextOf = (view: PlayerView): CommandContext => ({
  ended: view.phase === "ended",
  planet: view.planet,
  team: view.team ?? undefined,
  fleets: view.fleets,
  planets: view.planets,
});
