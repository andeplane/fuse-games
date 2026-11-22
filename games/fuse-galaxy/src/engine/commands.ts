/**
 * What a player can ask for, and whether they may. A command arrives as untrusted data: `parseCommand` reads its
 * shape, `commandProblem` checks it against the state, and neither ever throws. A command that fails either is
 * rejected with the reason as a sentence.
 *
 * `commandProblem` reads a `CommandContext`, which a world and a player's view can both supply, so the engine and
 * an agent masking its actions (`legal.ts`) run the same check.
 */
import {
  canAfford,
  asteroidCost,
  pendingLevel,
  researchCost,
  shipCost,
  shipTotal,
  structureCopies,
  structureCost,
} from "./economy.js";
import { isRecord, isWhole, oneOf } from "./guards.js";
import type { Rules } from "./rules.js";
import {
  BRANCH_IDS,
  MISSIONS,
  NONE,
  RESOURCE_IDS,
  SHIP_CLASSES,
  STRUCTURE_IDS,
  type BranchId,
  type DeepReadonly,
  type Fleet,
  type Mission,
  type Planet,
  type ResourceId,
  type Resources,
  type ShipClass,
  type ShipCounts,
  type StructureId,
  type Team,
} from "./world.js";

export type Command =
  /** Start mining one more asteroid of a resource. */
  | { readonly type: "initiateAsteroid"; readonly resource: ResourceId }
  | { readonly type: "buildStructure"; readonly structure: StructureId }
  /** Research a branch's next level. */
  | { readonly type: "startResearch"; readonly branch: BranchId }
  | {
      readonly type: "produceShips";
      readonly shipClass: ShipClass;
      readonly count: number;
    }
  | {
      readonly type: "launchFleet";
      readonly mission: Mission;
      readonly target: number;
      /** How many of each class to send; a class left out sends none. */
      readonly ships: Readonly<Partial<ShipCounts>>;
    }
  | { readonly type: "recallFleet"; readonly fleet: number }
  | { readonly type: "voteCommander"; readonly candidate: number }
  /** Commander only. */
  | { readonly type: "setTax"; readonly percent: number }
  /** Commander only: pay a member out of the team's fund. */
  | {
      readonly type: "grant";
      readonly to: number;
      readonly resources: Readonly<Partial<Resources>>;
    }
  /** Commander only: flag a member's planet for defence, or `NONE` to clear the flag. */
  | { readonly type: "setDefencePriority"; readonly planet: number }
  /** Give resources to the team's fund. */
  | {
      readonly type: "donate";
      readonly resources: Readonly<Partial<Resources>>;
    };

export type CommandType = Command["type"];

/** A command with the player who sent it. */
export interface Submission {
  readonly player: number;
  readonly command: Command;
}

/** A submission as the engine is meant to receive it: the command has not been read yet. */
export interface UntrustedSubmission {
  readonly player: number;
  readonly command: unknown;
}

export type ParsedCommand =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly type: string; readonly reason: string };

const MALFORMED = "malformed";

/**
 * A number as a command may carry one: finite, and with negative zero read as zero. A command log is replayed after a
 * trip through JSON, which turns NaN and the infinities into null and negative zero into zero, so the engine reads
 * a command the way JSON would have left it and the replay matches the match.
 */
const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value + 0 : undefined;

/**
 * A record of amounts by key, with every key known and every amount a number; undefined otherwise. An amount of
 * `undefined` is one that was left out, as it is once JSON has dropped it.
 */
function amounts<K extends string>(
  value: unknown,
  keys: readonly K[],
): Partial<Record<K, number>> | undefined {
  if (!isRecord(value)) return undefined;
  const read: Partial<Record<K, number>> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) continue;
    const amount = numberOf(raw);
    if (!oneOf(keys, key) || amount === undefined) return undefined;
    read[key] = amount;
  }
  return read;
}

/** Reads a command's shape: its type, and that each field is there with the right kind of value. */
export function parseCommand(value: unknown): ParsedCommand {
  if (!isRecord(value) || typeof value.type !== "string")
    return { ok: false, type: MALFORMED, reason: "the command is malformed" };
  const type = value.type;
  const bad = (field: string): ParsedCommand => ({
    ok: false,
    type,
    reason: `the command's ${field} is missing or malformed`,
  });
  switch (type) {
    case "initiateAsteroid":
      return oneOf(RESOURCE_IDS, value.resource)
        ? { ok: true, command: { type, resource: value.resource } }
        : bad("resource");
    case "buildStructure":
      return oneOf(STRUCTURE_IDS, value.structure)
        ? { ok: true, command: { type, structure: value.structure } }
        : bad("structure");
    case "startResearch":
      return oneOf(BRANCH_IDS, value.branch)
        ? { ok: true, command: { type, branch: value.branch } }
        : bad("branch");
    case "produceShips": {
      if (!oneOf(SHIP_CLASSES, value.shipClass)) return bad("shipClass");
      const count = numberOf(value.count);
      if (count === undefined) return bad("count");
      return {
        ok: true,
        command: { type, shipClass: value.shipClass, count },
      };
    }
    case "launchFleet": {
      if (!oneOf(MISSIONS, value.mission)) return bad("mission");
      const target = numberOf(value.target);
      if (target === undefined) return bad("target");
      const ships = amounts(value.ships, SHIP_CLASSES);
      if (!ships) return bad("ships");
      return {
        ok: true,
        command: { type, mission: value.mission, target, ships },
      };
    }
    case "recallFleet": {
      const fleet = numberOf(value.fleet);
      return fleet === undefined
        ? bad("fleet")
        : { ok: true, command: { type, fleet } };
    }
    case "voteCommander": {
      const candidate = numberOf(value.candidate);
      return candidate === undefined
        ? bad("candidate")
        : { ok: true, command: { type, candidate } };
    }
    case "setTax": {
      const percent = numberOf(value.percent);
      return percent === undefined
        ? bad("percent")
        : { ok: true, command: { type, percent } };
    }
    case "grant": {
      const to = numberOf(value.to);
      if (to === undefined) return bad("to");
      const resources = amounts(value.resources, RESOURCE_IDS);
      if (!resources) return bad("resources");
      return { ok: true, command: { type, to, resources } };
    }
    case "setDefencePriority": {
      const planet = numberOf(value.planet);
      return planet === undefined
        ? bad("planet")
        : { ok: true, command: { type, planet } };
    }
    case "donate": {
      const resources = amounts(value.resources, RESOURCE_IDS);
      if (!resources) return bad("resources");
      return { ok: true, command: { type, resources } };
    }
    default:
      return { ok: false, type: MALFORMED, reason: "unknown command type" };
  }
}

/** What a command is checked against: the sender's planet and team, and what they can see of fleets and planets. */
export interface CommandContext {
  readonly ended: boolean;
  readonly planet: DeepReadonly<Planet>;
  /** The sender's team, or undefined for a neutral planet. */
  readonly team: DeepReadonly<Team> | undefined;
  /** Every fleet the sender can see; theirs are the ones they own. */
  readonly fleets: readonly DeepReadonly<Fleet>[];
  /** Every planet by id. */
  readonly planets: readonly { readonly id: number; readonly team: number }[];
}

const whole = isWhole;

const NOT_ENOUGH = "not enough resources";
const NO_TEAM = "a neutral planet has no team";
const NOT_COMMANDER = "only the team's commander can do that";
const BAD_AMOUNTS = "amounts must be whole numbers of 0 or more";

/** Why a set of amounts cannot be moved out of `source`, or undefined when it can. */
function transferProblem(
  moved: Readonly<Partial<Resources>>,
  source: Readonly<Resources>,
  short: string,
): string | undefined {
  let total = 0;
  for (const resource of RESOURCE_IDS) {
    const amount = moved[resource] ?? 0;
    if (!whole(amount) || amount < 0) return BAD_AMOUNTS;
    if (amount > source[resource]) return short;
    total += amount;
  }
  return total > 0 ? undefined : "there is nothing to transfer";
}

/** Why the player may not do this now, as a sentence, or undefined when they may. */
export function commandProblem(
  context: CommandContext,
  command: Command,
  rules: Rules,
): string | undefined {
  if (context.ended) return "the match has ended";
  const { planet, team } = context;
  switch (command.type) {
    case "initiateAsteroid": {
      const owned = planet.asteroids[command.resource];
      if (owned >= rules.asteroid.maxPerResource)
        return `the planet already mines the most ${command.resource} asteroids it can`;
      return canAfford(planet.resources, asteroidCost(owned, rules))
        ? undefined
        : NOT_ENOUGH;
    }
    case "buildStructure": {
      if (planet.construction.length >= rules.construction.slots)
        return "the construction queue is full";
      if (
        structureCopies(planet, command.structure) >=
        rules.structures[command.structure].maxCount
      )
        return "no more of that structure can be built";
      return canAfford(
        planet.resources,
        structureCost(planet, command.structure, rules),
      )
        ? undefined
        : NOT_ENOUGH;
    }
    case "startResearch": {
      if (planet.structures[rules.research.structure] < 1)
        return `research needs a ${rules.research.structure}`;
      if (planet.researchQueue.length >= rules.research.slots)
        return "the research queue is full";
      if (
        pendingLevel(planet, command.branch) >=
        rules.research.branches[command.branch].maxLevel
      )
        return "that branch is at its highest level";
      return canAfford(
        planet.resources,
        researchCost(planet, command.branch, rules),
      )
        ? undefined
        : NOT_ENOUGH;
    }
    case "produceShips": {
      if (!whole(command.count) || command.count < 1)
        return "count must be a whole number of at least 1";
      if (command.count > rules.production.maxBatch)
        return `an order holds at most ${rules.production.maxBatch} ships`;
      if (planet.structures[rules.production.structure] < 1)
        return `ship production needs a ${rules.production.structure}`;
      const hulls = rules.ships[command.shipClass].hulls;
      if (planet.research.hulls < hulls)
        return `that class needs hulls research level ${hulls}`;
      if (planet.production.length >= rules.production.maxOrders)
        return "the production queue is full";
      return canAfford(
        planet.resources,
        shipCost(command.shipClass, command.count, rules),
      )
        ? undefined
        : NOT_ENOUGH;
    }
    case "launchFleet": {
      if (command.mission === "attack")
        return "attack missions are not implemented in this slice";
      const target = whole(command.target)
        ? context.planets[command.target]
        : undefined;
      if (!target) return "unknown target planet";
      if (target.id === planet.id)
        return "a fleet cannot target its own planet";
      const teammate = planet.team !== NONE && target.team === planet.team;
      if (command.mission === "defend" && !teammate)
        return "a fleet can only defend a teammate";
      if (command.mission === "observe" && teammate)
        return "there is nothing to observe on a teammate's planet";
      for (const shipClass of SHIP_CLASSES) {
        const count = command.ships[shipClass] ?? 0;
        if (!whole(count) || count < 0)
          return "ship counts must be whole numbers of 0 or more";
        if (count > planet.ships[shipClass]) return "not enough ships at home";
      }
      if (shipTotal(command.ships) < 1)
        return "a fleet needs at least one ship";
      return context.fleets.filter((fleet) => fleet.owner === planet.id)
        .length >= rules.fleet.maxFleets
        ? "the planet already has the most fleets it can send"
        : undefined;
    }
    case "recallFleet": {
      const fleet = context.fleets.find(
        (candidate) =>
          candidate.id === command.fleet && candidate.owner === planet.id,
      );
      if (!fleet) return "unknown fleet";
      return fleet.phase === "returning"
        ? "the fleet is already on its way home"
        : undefined;
    }
    case "voteCommander":
      if (!team) return NO_TEAM;
      return team.members.includes(command.candidate)
        ? undefined
        : "the candidate is not on the team";
    case "setTax":
      if (!team) return NO_TEAM;
      if (team.commander !== planet.id) return NOT_COMMANDER;
      return whole(command.percent) &&
        command.percent >= 0 &&
        command.percent <= rules.team.maxTaxPercent
        ? undefined
        : `tax must be a whole percentage from 0 to ${rules.team.maxTaxPercent}`;
    case "grant":
      if (!team) return NO_TEAM;
      if (team.commander !== planet.id) return NOT_COMMANDER;
      if (!team.members.includes(command.to))
        return "the recipient is not on the team";
      return transferProblem(
        command.resources,
        team.fund,
        "the fund does not hold that much",
      );
    case "setDefencePriority":
      if (!team) return NO_TEAM;
      if (team.commander !== planet.id) return NOT_COMMANDER;
      return command.planet === NONE || team.members.includes(command.planet)
        ? undefined
        : "the planet is not on the team";
    case "donate":
      if (!team) return NO_TEAM;
      return transferProblem(command.resources, planet.resources, NOT_ENOUGH);
  }
}
