/**
 * Carrying out a command that `commandProblem` has already allowed: these change the tick's private copy of the
 * world and check nothing themselves.
 */
import { abandon, battleAt } from "./combat.js";
import type { Command } from "./commands.js";
import {
  asteroidCost,
  pendingLevel,
  productionTicks,
  researchCost,
  researchTicks,
  shipCost,
  shipTotal,
  structureCost,
  travelTicks,
} from "./economy.js";
import { arranged } from "./formation.js";
import { max, min } from "./math.js";
import type { Rules } from "./rules.js";
import {
  NONE,
  RESOURCE_IDS,
  SHIP_CLASSES,
  noShips,
  teamOf,
  type Planet,
  type Resources,
  type Team,
  type WorldDraft,
} from "./world.js";

function pay(planet: Planet, cost: Readonly<Resources>): void {
  for (const resource of RESOURCE_IDS)
    planet.resources[resource] -= cost[resource];
}

/** Moves amounts from one stock to another; the receiving stock stops at the cap. */
function transfer(
  from: Resources,
  to: Resources,
  moved: Readonly<Partial<Resources>>,
  cap: number,
): void {
  for (const resource of RESOURCE_IDS) {
    const amount = moved[resource] ?? 0;
    from[resource] -= amount;
    to[resource] = min(cap, to[resource] + amount);
  }
}

/**
 * The commander is the member with the most votes. When several lead together the sitting commander keeps the post
 * if they are one of them, and otherwise the lowest planet id takes it. Nobody commands a team that has not voted.
 */
export function electCommander(team: Team): number {
  let commander = NONE,
    best = 0;
  for (const member of team.members) {
    const votes = team.votes.reduce(
      (count, vote) => count + (vote === member ? 1 : 0),
      0,
    );
    if (
      votes > best ||
      (votes === best && votes > 0 && member === team.commander)
    ) {
      best = votes;
      commander = member;
    }
  }
  return commander;
}

/** Carries out one allowed command for a player. */
export function execute(
  world: WorldDraft,
  player: number,
  command: Command,
  rules: Rules,
): void {
  const planet = world.planets[player]!;
  const team = teamOf(world.teams, planet.team);
  switch (command.type) {
    case "initiateAsteroid":
      pay(planet, asteroidCost(planet.asteroids[command.resource], rules));
      planet.asteroids[command.resource] += 1;
      world.events.push({
        type: "asteroidInitiated",
        player,
        resource: command.resource,
      });
      return;
    case "buildStructure":
      pay(planet, structureCost(planet, command.structure, rules));
      planet.construction.push({
        structure: command.structure,
        remaining: rules.structures[command.structure].buildTicks,
      });
      return;
    case "startResearch": {
      pay(planet, researchCost(planet, command.branch, rules));
      const remaining = researchTicks(planet, command.branch, rules);
      planet.researchQueue.push({
        branch: command.branch,
        level: pendingLevel(planet, command.branch) + 1,
        remaining,
      });
      return;
    }
    case "produceShips":
      pay(planet, shipCost(command.shipClass, command.count, rules));
      planet.production.push({
        shipClass: command.shipClass,
        count: command.count,
        remaining: productionTicks(planet, command.shipClass, rules),
      });
      return;
    case "launchFleet": {
      const ships = noShips();
      for (const shipClass of SHIP_CLASSES) {
        ships[shipClass] = command.ships[shipClass] ?? 0;
        planet.ships[shipClass] -= ships[shipClass];
      }
      const ticks = travelTicks(
        planet,
        world.planets[command.target]!,
        ships,
        planet.research.travel,
        rules,
        command.mission,
      );
      world.fleets.push({
        id: world.nextFleetId,
        owner: player,
        mission: command.mission,
        target: command.target,
        ships,
        // The fleet flies as the home fleet stands; `setFormation` can draw it up differently on the way.
        formation: planet.formation,
        phase: "outbound",
        eta: ticks,
        travelTicks: ticks,
      });
      world.nextFleetId += 1;
      return;
    }
    case "recallFleet": {
      const fleet = world.fleets.find(
        (candidate) => candidate.id === command.fleet,
      )!;
      // Leaving a battle costs ships, for an attacker and for a defender stationed at the planet.
      const battle =
        fleet.phase === "fighting" ||
        (fleet.phase === "stationed" && fleet.mission === "defend")
          ? battleAt(world, fleet.target)
          : undefined;
      if (battle) {
        abandon(battle, fleet.id, fleet.ships, rules);
        if (shipTotal(fleet.ships) === 0) {
          world.fleets = world.fleets.filter((other) => other !== fleet);
          world.events.push({ type: "fleetLost", player, fleet: fleet.id });
          return;
        }
      }
      // A fleet on its way out flies back as far as it had come; one that had arrived flies the whole way.
      fleet.eta =
        fleet.phase === "outbound"
          ? max(1, fleet.travelTicks - fleet.eta)
          : fleet.travelTicks;
      fleet.phase = "returning";
      return;
    }
    case "setFormation": {
      if (command.fleet === NONE) {
        planet.formation = arranged(
          planet.formation,
          command.arrangement,
          rules,
        );
        return;
      }
      const fleet = world.fleets.find(
        (candidate) => candidate.id === command.fleet,
      )!;
      fleet.formation = arranged(fleet.formation, command.arrangement, rules);
      return;
    }
    case "setShelter": {
      planet.sheltered = command.sheltered;
      // Pulling the home fleet out of a battle already under way costs what any retreat does.
      const battle = command.sheltered ? battleAt(world, player) : undefined;
      if (battle) abandon(battle, NONE, planet.ships, rules);
      return;
    }
    case "voteCommander": {
      team!.votes[team!.members.indexOf(player)] = command.candidate;
      const commander = electCommander(team!);
      if (commander !== team!.commander) {
        team!.commander = commander;
        world.events.push({
          type: "commanderChanged",
          team: team!.id,
          commander,
        });
      }
      return;
    }
    case "setTax":
      team!.taxPercent = command.percent;
      return;
    case "grant":
      transfer(
        team!.fund,
        world.planets[command.to]!.resources,
        command.resources,
        rules.limits.resourceCap,
      );
      return;
    case "setDefencePriority":
      team!.defencePriority = command.planet;
      return;
    case "donate":
      transfer(
        planet.resources,
        team!.fund,
        command.resources,
        rules.limits.resourceCap,
      );
      return;
  }
}
