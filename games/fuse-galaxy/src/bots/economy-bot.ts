/**
 * A simple bot that grows an economy. It is a `Policy`: it reads its planet's view and the legal commands for it,
 * like any other player, keeps no state of its own, and so plays the same from the same view every time.
 *
 * Every few ticks it decides once: at most one purchase, at most one fleet, and whatever its team needs from it
 * (a vote, and a commander's tax, grant and defence flag). Each command it sends is one `legalCommands` offered,
 * and they draw on different things (the planet's stock, its ships at home, the team's fund), so none can make
 * another illegal.
 */
import {
  NONE,
  SHIP_CLASSES,
  legalCommands,
  minimalCommand,
  shipsValue,
  structureCopies,
  totalOf,
  type BranchId,
  type Command,
  type CommandOption,
  type PlayerView,
  type Policy,
  type Rules,
} from "../engine/index.js";

export interface BotConfig {
  /** The bot decides once every this many ticks. */
  readonly thinkEvery: number;
  /** It builds its research lab once it mines this many asteroids, and saves up for it from then. */
  readonly labAtAsteroids: number;
  /** The same for its shipyard. */
  readonly yardAtAsteroids: number;
  /** It produces ships while they are less than this share of its planet's value. */
  readonly fleetPercent: number;
  /** The most ships it orders at once. */
  readonly shipBatch: number;
  /** Which branch it researches first when several are at the same level. */
  readonly researchOrder: readonly BranchId[];
  /** The tax it sets as commander, when the rules allow that much. */
  readonly taxPercent: number;
  /** As commander it pays the fund out once it holds this much in all. */
  readonly grantAt: number;
  /** It observes a planet again once its team's report on it is this many ticks old. */
  readonly rescoutTicks: number;
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  thinkEvery: 5,
  labAtAsteroids: 6,
  yardAtAsteroids: 9,
  fleetPercent: 15,
  shipBatch: 5,
  researchOrder: ["mining", "hulls", "sensors", "travel", "jamming"],
  taxPercent: 10,
  grantAt: 600,
  rescoutTicks: 300,
};

export type Option<T extends CommandOption["type"]> = Extract<
  CommandOption,
  { type: T }
>;

export const ofType = <T extends CommandOption["type"]>(
  options: readonly CommandOption[],
  type: T,
): Option<T>[] =>
  options.filter((option): option is Option<T> => option.type === type);

/** How much income an economy option adds each tick, in hundredths. */
function gain(
  option: Option<"initiateAsteroid"> | Option<"buildStructure">,
  view: PlayerView,
  rules: Rules,
): number {
  if (option.type === "buildStructure")
    return totalOf(rules.structures[option.structure].income) * 100;
  return (
    rules.economy.asteroidIncome[option.resource] *
    (100 + view.planet.research.mining * rules.economy.miningPercentPerLevel)
  );
}

/** The asteroid or refinery that pays for itself soonest. */
function bestInvestment(
  options: readonly CommandOption[],
  view: PlayerView,
  rules: Rules,
): Command | undefined {
  let best: { cost: number; gain: number; command: Command } | undefined;
  for (const option of [
    ...ofType(options, "initiateAsteroid"),
    ...ofType(options, "buildStructure"),
  ]) {
    const earned = gain(option, view, rules);
    const cost = totalOf(option.cost);
    // cost / earned < best.cost / best.gain, without dividing.
    if (earned > 0 && (!best || cost * best.gain < best.cost * earned))
      best = { cost, gain: earned, command: minimalCommand(option) };
  }
  return best?.command;
}

/** What the player's ships are worth, at home and in its fleets. */
export const ownShipsValue = (view: PlayerView, rules: Rules): number =>
  view.fleets.reduce(
    (sum, fleet) =>
      fleet.owner === view.self ? sum + shipsValue(fleet.ships, rules) : sum,
    shipsValue(view.planet.ships, rules),
  );

/** The classes the planet can order now that destroy what they hit, lightest first. */
export const gunships = (
  options: readonly CommandOption[],
  rules: Rules,
): Option<"produceShips">[] =>
  ofType(options, "produceShips").filter((option) => {
    const rule = rules.ships[option.shipClass];
    return rule.shots > 0 && rule.attack > 0 && rule.effect === "damage";
  });

/** Decides which ships to order now, if any. */
export type Shipwright = (
  options: readonly CommandOption[],
  view: PlayerView,
  rules: Rules,
) => Command | undefined;

/** The heaviest gunship the planet can build, while its ships are less than a share of what it is worth. */
export const standingFleet =
  (fleetPercent: number, shipBatch: number): Shipwright =>
  (options, view, rules) => {
    const yard = gunships(options, rules).at(-1);
    return yard &&
      ownShipsValue(view, rules) * 100 < view.planet.value * fleetPercent
      ? {
          type: "produceShips",
          shipClass: yard.shipClass,
          count: Math.min(yard.maxCount, shipBatch),
        }
      : undefined;
  };

/** The one thing the bot buys this turn, if anything. */
export function purchase(
  options: readonly CommandOption[],
  view: PlayerView,
  rules: Rules,
  config: BotConfig,
  shipwright: Shipwright,
): Command | undefined {
  const { planet } = view;
  const asteroids = totalOf(planet.asteroids);
  for (const [structure, wantedAt] of [
    [rules.research.structure, config.labAtAsteroids],
    [rules.production.structure, config.yardAtAsteroids],
  ] as const) {
    if (asteroids < wantedAt || structureCopies(planet, structure) > 0)
      continue;
    const build = ofType(options, "buildStructure").find(
      (option) => option.structure === structure,
    );
    // Nothing else is bought until this is: the bot saves up.
    return build && minimalCommand(build);
  }

  // Research before ships: a lab that stands idle while the yard takes everything never reaches a better hull.
  if (planet.researchQueue.length === 0) {
    const order = (branch: BranchId): number =>
      config.researchOrder.indexOf(branch);
    const research = ofType(options, "startResearch").sort(
      (a, b) => a.level - b.level || order(a.branch) - order(b.branch),
    )[0];
    if (research) return minimalCommand(research);
  }
  return (
    shipwright(options, view, rules) ?? bestInvestment(options, view, rules)
  );
}

/** Whether the player already has a fleet out to a planet. */
const sent = (view: PlayerView, target: number): boolean =>
  view.fleets.some(
    (fleet) => fleet.owner === view.self && fleet.target === target,
  );

/** Every warship at home to the teammate the commander has flagged, unless a fleet is on that job already. */
export function defendFlagged(
  options: readonly CommandOption[],
  view: PlayerView,
): Command | undefined {
  const flagged = view.team ? view.team.defencePriority : NONE;
  const defend = ofType(options, "launchFleet").find(
    (option) => option.mission === "defend" && option.target === flagged,
  );
  return defend && !sent(view, flagged)
    ? {
        type: "launchFleet",
        mission: "defend",
        target: flagged,
        ships: defend.maxShips,
      }
    : undefined;
}

/** One probe past the planet the team has gone longest without a report on, once that report is old enough. */
export function scout(
  options: readonly CommandOption[],
  view: PlayerView,
  config: BotConfig,
): Command | undefined {
  const seen = (target: number): number =>
    view.reports.find((report) => report.target === target)?.tick ??
    -config.rescoutTicks;
  const observe = ofType(options, "launchFleet")
    .filter(
      (option) =>
        option.mission === "observe" &&
        !sent(view, option.target) &&
        view.tick - seen(option.target) >= config.rescoutTicks,
    )
    .sort((a, b) => seen(a.target) - seen(b.target) || a.target - b.target)[0];
  if (!observe) return undefined;
  const probe = SHIP_CLASSES.find((id) => observe.maxShips[id] > 0)!;
  return {
    type: "launchFleet",
    mission: "observe",
    target: observe.target,
    ships: { [probe]: 1 },
  };
}

/** What the bot does for its team: its vote, and the commander's duties when it holds the post. */
export function teamwork(
  options: readonly CommandOption[],
  view: PlayerView,
  rules: Rules,
  config: BotConfig,
): Command[] {
  const { team } = view;
  if (!team) return [];
  const commands: Command[] = [];

  // Everyone backs the first seat on the team, so a team of bots settles on a commander at once.
  const candidate = team.members[0]!;
  const vote = ofType(options, "voteCommander").find(
    (option) => option.candidate === candidate,
  );
  if (vote && team.votes[team.members.indexOf(view.self)] !== candidate)
    commands.push({ type: "voteCommander", candidate });
  if (team.commander !== view.self) return commands;

  const tax = ofType(options, "setTax")[0];
  const percent = tax ? Math.min(tax.maxPercent, config.taxPercent) : 0;
  if (tax && team.taxPercent !== percent)
    commands.push({ type: "setTax", percent });

  // The member under attack gets the flag: one with a battle at home first, then the one an attack reaches soonest.
  const besieged = view.battles.find((battle) =>
    team.members.includes(battle.planet),
  )?.planet;
  const soonest = view.incoming.reduce<number | undefined>(
    (first, fleet, index) =>
      first === undefined || fleet.eta < view.incoming[first]!.eta
        ? index
        : first,
    undefined,
  );
  const threatened =
    besieged ?? (soonest === undefined ? NONE : view.incoming[soonest]!.target);
  const flag = ofType(options, "setDefencePriority").find(
    (option) => option.planet === threatened,
  );
  if (flag && team.defencePriority !== threatened)
    commands.push(minimalCommand(flag));

  // The member who is furthest behind gets the fund.
  const weakest = [view.planet, ...view.allies].reduce((a, b) =>
    b.score < a.score || (b.score === a.score && b.id < a.id) ? b : a,
  ).id;
  const grant = ofType(options, "grant").find(
    (option) => option.to === weakest,
  );
  if (grant && totalOf(grant.max) >= config.grantAt)
    commands.push({ type: "grant", to: weakest, resources: grant.max });
  return commands;
}

/** A policy that plays any planet, seat or neutral, as an economy bot. */
export function createEconomyBot(
  config: BotConfig = DEFAULT_BOT_CONFIG,
): Policy {
  return (view, rules) => {
    // Planets take turns: each thinks on its own tick of the cycle.
    if ((view.tick + view.self) % config.thinkEvery !== 0) return [];
    const options = legalCommands(view, rules);
    if (options.length === 0) return [];
    const commands = teamwork(options, view, rules, config);
    const bought = purchase(
      options,
      view,
      rules,
      config,
      standingFleet(config.fleetPercent, config.shipBatch),
    );
    if (bought) commands.push(bought);
    // One fleet a turn: help for the flagged teammate first, a scout otherwise.
    const fleet = defendFlagged(options, view) ?? scout(options, view, config);
    if (fleet) commands.push(fleet);
    return commands;
  };
}
