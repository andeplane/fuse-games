/**
 * What a player may do now, read from their view: the action mask for a bot, a learning agent or a screen that
 * greys out what cannot be afforded.
 *
 * A `CommandOption` is a family of commands with its bounds (how many ships, how much to give) and what it costs.
 * An option is offered exactly when `commandProblem`, the check the engine itself runs, allows its smallest
 * command, so the mask and the engine cannot disagree.
 */
import { commandProblem, type Command } from "./commands.js";
import {
  affordableCount,
  asteroidCost,
  pendingLevel,
  productionTicks,
  researchCost,
  researchTicks,
  shipCost,
  structureCost,
} from "./economy.js";
import type { Rules } from "./rules.js";
import { contextOf, type PlayerView } from "./view.js";
import {
  BRANCH_IDS,
  NONE,
  RESOURCE_IDS,
  SHIP_CLASSES,
  STRUCTURE_IDS,
  noShips,
  type BranchId,
  type Mission,
  type ResourceId,
  type Resources,
  type ShipClass,
  type ShipCounts,
  type StructureId,
} from "./world.js";

export type CommandOption =
  | {
      readonly type: "initiateAsteroid";
      readonly resource: ResourceId;
      readonly cost: Readonly<Resources>;
    }
  | {
      readonly type: "buildStructure";
      readonly structure: StructureId;
      readonly cost: Readonly<Resources>;
      readonly ticks: number;
    }
  | {
      readonly type: "startResearch";
      readonly branch: BranchId;
      /** The level the branch reaches. */
      readonly level: number;
      readonly cost: Readonly<Resources>;
      readonly ticks: number;
    }
  | {
      readonly type: "produceShips";
      readonly shipClass: ShipClass;
      /** Any count from 1 to this is allowed. */
      readonly maxCount: number;
      readonly unitCost: Readonly<Resources>;
      /** How long the order takes, whatever its size. */
      readonly ticks: number;
    }
  | {
      readonly type: "launchFleet";
      readonly mission: Mission;
      readonly target: number;
      /** Any mix of at least one ship up to these counts is allowed. */
      readonly maxShips: Readonly<ShipCounts>;
    }
  | { readonly type: "recallFleet"; readonly fleet: number }
  /**
   * `fleet` is one of the player's fleets, or `NONE` for the home fleet. Any of the named formations is allowed, and
   * so is any arrangement of classes on cells 0 to 8.
   */
  | {
      readonly type: "setFormation";
      readonly fleet: number;
      readonly formations: readonly string[];
    }
  | { readonly type: "setShelter"; readonly sheltered: boolean }
  | { readonly type: "voteCommander"; readonly candidate: number }
  /** Any whole percentage from 0 to `maxPercent`. */
  | { readonly type: "setTax"; readonly maxPercent: number }
  /** Any amounts, more than nothing, up to `max`. */
  | {
      readonly type: "grant";
      readonly to: number;
      readonly max: Readonly<Resources>;
    }
  /** `planet` is a member's planet, or `NONE` to clear the flag. */
  | { readonly type: "setDefencePriority"; readonly planet: number }
  /** Any amounts, more than nothing, up to `max`. */
  | { readonly type: "donate"; readonly max: Readonly<Resources> };

/** One unit of the first resource the stock holds any of. */
function oneOfStock(stock: Readonly<Resources>): Partial<Resources> {
  const resource = RESOURCE_IDS.find((id) => stock[id] > 0);
  return resource ? { [resource]: 1 } : {};
}

/** The smallest command an option stands for. */
export function minimalCommand(option: CommandOption): Command {
  switch (option.type) {
    case "initiateAsteroid":
      return { type: option.type, resource: option.resource };
    case "buildStructure":
      return { type: option.type, structure: option.structure };
    case "startResearch":
      return { type: option.type, branch: option.branch };
    case "produceShips":
      return { type: option.type, shipClass: option.shipClass, count: 1 };
    case "launchFleet": {
      const shipClass = SHIP_CLASSES.find((id) => option.maxShips[id] > 0);
      return {
        type: option.type,
        mission: option.mission,
        target: option.target,
        ships: shipClass ? { [shipClass]: 1 } : {},
      };
    }
    case "recallFleet":
      return { type: option.type, fleet: option.fleet };
    case "setFormation":
      return {
        type: option.type,
        fleet: option.fleet,
        arrangement: option.formations[0] ?? "",
      };
    case "setShelter":
      return { type: option.type, sheltered: option.sheltered };
    case "voteCommander":
      return { type: option.type, candidate: option.candidate };
    case "setTax":
      return { type: option.type, percent: 0 };
    case "grant":
      return {
        type: option.type,
        to: option.to,
        resources: oneOfStock(option.max),
      };
    case "setDefencePriority":
      return { type: option.type, planet: option.planet };
    case "donate":
      return { type: option.type, resources: oneOfStock(option.max) };
  }
}

/** Everything the player could ask for, allowed or not. */
function candidates(view: PlayerView, rules: Rules): CommandOption[] {
  const { planet, team } = view;
  const options: CommandOption[] = [];
  for (const resource of RESOURCE_IDS)
    options.push({
      type: "initiateAsteroid",
      resource,
      cost: asteroidCost(planet.asteroids[resource], rules),
    });
  for (const structure of STRUCTURE_IDS)
    options.push({
      type: "buildStructure",
      structure,
      cost: structureCost(planet, structure, rules),
      ticks: rules.structures[structure].buildTicks,
    });
  for (const branch of BRANCH_IDS)
    options.push({
      type: "startResearch",
      branch,
      level: pendingLevel(planet, branch) + 1,
      cost: researchCost(planet, branch, rules),
      ticks: researchTicks(planet, branch, rules),
    });
  for (const shipClass of SHIP_CLASSES) {
    const unitCost = shipCost(shipClass, 1, rules);
    options.push({
      type: "produceShips",
      shipClass,
      maxCount: affordableCount(
        planet.resources,
        unitCost,
        rules.production.maxBatch,
      ),
      unitCost,
      ticks: productionTicks(planet, shipClass, rules),
    });
  }
  // Probes fly the observing missions and nothing else does.
  const probes = noShips(),
    warships = noShips();
  for (const shipClass of SHIP_CLASSES)
    (rules.ships[shipClass].probe ? probes : warships)[shipClass] =
      planet.ships[shipClass];
  for (const target of view.planets) {
    if (target.id === planet.id) continue;
    const teammate = team !== null && target.team === team.id;
    const missions: readonly Mission[] = teammate
      ? ["defend"]
      : ["attack", "observe", "orbit"];
    for (const mission of missions)
      options.push({
        type: "launchFleet",
        mission,
        target: target.id,
        maxShips:
          mission === "observe" || mission === "orbit" ? probes : warships,
      });
  }
  const formations = Object.keys(rules.combat.formations);
  options.push({ type: "setFormation", fleet: NONE, formations });
  for (const fleet of view.fleets)
    if (fleet.owner === planet.id) {
      options.push({ type: "recallFleet", fleet: fleet.id });
      options.push({ type: "setFormation", fleet: fleet.id, formations });
    }
  for (const sheltered of [true, false])
    options.push({ type: "setShelter", sheltered });
  if (!team) return options;
  for (const candidate of team.members)
    options.push({ type: "voteCommander", candidate });
  options.push({ type: "setTax", maxPercent: rules.team.maxTaxPercent });
  for (const to of team.members)
    options.push({ type: "grant", to, max: team.fund });
  for (const member of [...team.members, NONE])
    options.push({ type: "setDefencePriority", planet: member });
  options.push({ type: "donate", max: planet.resources });
  return options;
}

/** Why the view's player may not do this now, or undefined when they may: the engine's own check. */
export const commandProblemFor = (
  view: PlayerView,
  command: Command,
  rules: Rules,
): string | undefined => commandProblem(contextOf(view), command, rules);

/** Every option the view's player has now, in a fixed order. Empty once the match has ended. */
export function legalCommands(view: PlayerView, rules: Rules): CommandOption[] {
  const context = contextOf(view);
  return candidates(view, rules).filter(
    (option) =>
      commandProblem(context, minimalCommand(option), rules) === undefined,
  );
}
