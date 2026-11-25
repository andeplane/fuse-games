/**
 * What one player may know. A screen, a bot and a learning agent all read a `PlayerView`, never the world, so
 * nothing they do can depend on what the fog hides.
 *
 * A player sees:
 *
 * - their own planet and their teammates' planets in full, their team's record and every fleet the team owns;
 * - of everyone else only what is public: where the planet is, whose side it is on, and the scoreboard (each
 *   planet's and team's score in its economy, military and technology parts, and how many asteroids it mines);
 * - the dated scout reports they and their teammates have gathered (`intel.ts`);
 * - the attacks on its way to any of them that their sensors have picked up;
 * - the battles any of them is in, with every fleet fighting there.
 *
 * A view shares the world's objects rather than copying them, which is safe because a world is frozen all the way
 * down: whoever holds a view can read it and nothing more.
 */
import { attackersAt, defendersAt, hasCombatants } from "./combat.js";
import type { CommandContext } from "./commands.js";
import { totalOf } from "./economy.js";
import { incomingFor, type IncomingFleet } from "./intel.js";
import type { Rules } from "./rules.js";
import { stockValue } from "./score.js";
import {
  NONE,
  teamOf,
  type DeepReadonly,
  type Fleet,
  type Formation,
  type GameEvent,
  type MatchResult,
  type Planet,
  type PlanetKind,
  type ScoutReport,
  type ShipCounts,
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

/** A line of the public scoreboard: a score, the three parts it is the sum of, and asteroids mined. */
export interface ScoreLine {
  readonly score: number;
  readonly economy: number;
  readonly military: number;
  readonly technology: number;
  readonly asteroids: number;
}

export interface TeamScoreLine extends ScoreLine {
  readonly team: number;
  readonly members: readonly number[];
}

export interface PlayerScoreLine extends ScoreLine {
  readonly planet: number;
  /** The planet's team, or `NONE` for a neutral planet. */
  readonly team: number;
}

/**
 * The scoreboard everybody sees. A team's line is its members' lines added up, with what its fund is worth counted
 * as economy. Nothing finer than this is public: not what a military score is made of, nor what a planet has in stock.
 */
export interface Scoreboard {
  /** By team id. */
  readonly teams: readonly TeamScoreLine[];
  /** Every planet, by id. */
  readonly players: readonly PlayerScoreLine[];
}

/** One fleet in a battle the player can see. */
export interface BattleForce {
  readonly owner: number;
  /** The fleet's id, or `NONE` for the planet's home fleet. */
  readonly fleet: number;
  readonly ships: Readonly<ShipCounts>;
  readonly formation: Readonly<Formation>;
}

/** A battle in progress that the player or a teammate is in: everybody fighting there sees everybody else. */
export interface BattleView {
  readonly planet: number;
  /** Rounds fought so far. */
  readonly round: number;
  readonly attackers: readonly BattleForce[];
  /** The home fleet first, unless it is sheltered or has nothing to fight with, then the fleets stationed there. */
  readonly defenders: readonly BattleForce[];
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
  readonly scoreboard: Scoreboard;
  /** The team's latest scout report on each planet it has observed, by target id. */
  readonly reports: readonly DeepReadonly<ScoutReport>[];
  /** The attacks on their way to the player or a teammate that their sensors have picked up, in fleet order. */
  readonly incoming: readonly IncomingFleet[];
  /** The battles the player or a teammate is in, in the order they began. */
  readonly battles: readonly BattleView[];
  /** What happened on the last tick that the player may know about. */
  readonly events: readonly DeepReadonly<GameEvent>[];
}

function visible(
  event: DeepReadonly<GameEvent>,
  self: number,
  team: number,
  /** The player and their teammates. */
  mine: ReadonlySet<number>,
): boolean {
  switch (event.type) {
    case "rejected":
    case "asteroidInitiated":
      return event.player === self;
    case "commanderChanged":
      return event.team === team;
    case "matchEnded":
      return true;
    case "battleRound":
    case "battleEnded":
      return event.parties.some((party) => mine.has(party));
    case "asteroidsCaptured":
      return mine.has(event.player) || mine.has(event.from);
    default:
      return mine.has(event.player);
  }
}

function scoreboardOf(world: World, rules: Rules): Scoreboard {
  const players = world.planets.map((planet) => ({
    planet: planet.id,
    team: planet.team,
    score: planet.score,
    economy: planet.parts.economy,
    military: planet.parts.military,
    technology: planet.parts.technology,
    asteroids: totalOf(planet.asteroids),
  }));
  const teams = world.teams.map((team) => {
    const fund = stockValue(team.fund, rules);
    const line = {
      team: team.id,
      members: team.members,
      score: fund,
      economy: fund,
      military: 0,
      technology: 0,
      asteroids: 0,
    };
    for (const member of team.members) {
      const player = players[member]!;
      line.score += player.score;
      line.economy += player.economy;
      line.military += player.military;
      line.technology += player.technology;
      line.asteroids += player.asteroids;
    }
    return line;
  });
  return { teams, players };
}

const forceOf = (fleet: DeepReadonly<Fleet>): BattleForce => ({
  owner: fleet.owner,
  fleet: fleet.id,
  ships: fleet.ships,
  formation: fleet.formation,
});

function battlesFor(
  world: World,
  mine: ReadonlySet<number>,
  rules: Rules,
): BattleView[] {
  const battles: BattleView[] = [];
  for (const battle of world.battles) {
    const planet = world.planets[battle.planet]!;
    const attackers = attackersAt(world.fleets, planet.id).map(forceOf);
    const defenders = defendersAt(world.fleets, planet.id).map(forceOf);
    if (!planet.sheltered && hasCombatants(planet.ships, rules))
      defenders.unshift({
        owner: planet.id,
        fleet: NONE,
        ships: planet.ships,
        formation: planet.formation,
      });
    if (
      mine.has(planet.id) ||
      [...attackers, ...defenders].some((force) => mine.has(force.owner))
    )
      battles.push({
        planet: planet.id,
        round: battle.round,
        attackers,
        defenders,
      });
  }
  return battles;
}

/** The view of the world for one player. Throws a `RangeError` when no planet has that id. */
export function viewFor(
  world: World,
  player: number,
  rules: Rules,
): PlayerView {
  const planet = world.planets[player];
  if (!planet) throw new RangeError(`no planet has the id ${player}`);
  const team = teamOf(world.teams, planet.team) ?? null;
  // In the team's own order, so that every member is shown the same reports.
  const members: readonly number[] = team ? team.members : [player];
  const mine = new Set(members);

  const reports = new Map<number, DeepReadonly<ScoutReport>>();
  for (const member of members)
    for (const report of world.knowledge[member]!.reports) {
      const known = reports.get(report.target);
      // The newest report wins, and of two made on the same tick the one that shows more.
      if (
        !known ||
        report.tick > known.tick ||
        (report.tick === known.tick && report.detail > known.detail)
      )
        reports.set(report.target, report);
    }

  return {
    tick: world.tick,
    phase: world.phase,
    result: world.result,
    self: player,
    planet,
    team,
    allies: world.planets.filter(
      (other) => other.id !== player && mine.has(other.id),
    ),
    fleets: world.fleets.filter((fleet) => mine.has(fleet.owner)),
    planets: world.planets.map(({ id, kind, team: side, x, y, score }) => ({
      id,
      kind,
      team: side,
      x,
      y,
      score,
    })),
    scoreboard: scoreboardOf(world, rules),
    reports: [...reports.values()].sort((a, b) => a.target - b.target),
    incoming: incomingFor(world, members, rules),
    battles: battlesFor(world, mine, rules),
    events: world.events.filter((event) =>
      visible(event, player, team ? team.id : NONE, mine),
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
