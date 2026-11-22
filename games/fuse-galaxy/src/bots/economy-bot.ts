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
  shipTotal,
  shipsValue,
  structureCopies,
  totalOf,
  type BranchId,
  type Command,
  type CommandOption,
  type PlayerView,
  type Policy,
  type Rules,
  type ShipCounts,
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

type Option<T extends CommandOption["type"]> = Extract<
  CommandOption,
  { type: T }
>;

const ofType = <T extends CommandOption["type"]>(
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

/** The one thing the bot buys this turn, if anything. */
function purchase(
  options: readonly CommandOption[],
  view: PlayerView,
  rules: Rules,
  config: BotConfig,
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

  const fleetValue = view.fleets.reduce(
    (sum, fleet) =>
      fleet.owner === view.self ? sum + shipsValue(fleet.ships, rules) : sum,
    shipsValue(planet.ships, rules),
  );
  const yard = ofType(options, "produceShips").at(-1);
  if (yard && fleetValue * 100 < planet.value * config.fleetPercent)
    return {
      type: "produceShips",
      shipClass: yard.shipClass,
      count: Math.min(yard.maxCount, config.shipBatch),
    };

  if (planet.researchQueue.length === 0) {
    const order = (branch: BranchId): number =>
      config.researchOrder.indexOf(branch);
    const research = ofType(options, "startResearch").sort(
      (a, b) => a.level - b.level || order(a.branch) - order(b.branch),
    )[0];
    if (research) return minimalCommand(research);
  }
  return bestInvestment(options, view, rules);
}

/** The lightest ship at home, as a fleet of one. */
function scout(ships: Readonly<ShipCounts>): Partial<ShipCounts> {
  const shipClass = SHIP_CLASSES.find((id) => ships[id] > 0);
  return shipClass ? { [shipClass]: 1 } : {};
}

/** The one fleet the bot sends this turn, if any: help for the flagged teammate first, a scout otherwise. */
function launch(
  options: readonly CommandOption[],
  view: PlayerView,
  config: BotConfig,
): Command | undefined {
  const fleets = ofType(options, "launchFleet");
  const sent = (target: number): boolean =>
    view.fleets.some(
      (fleet) => fleet.owner === view.self && fleet.target === target,
    );
  const home = view.planet.ships;
  const one = scout(home);

  const flagged = view.team ? view.team.defencePriority : NONE;
  const defend = fleets.find(
    (option) => option.mission === "defend" && option.target === flagged,
  );
  if (defend && !sent(flagged) && shipTotal(home) > 1) {
    // Everything but one scout.
    const ships: Partial<ShipCounts> = {};
    for (const shipClass of SHIP_CLASSES)
      ships[shipClass] = home[shipClass] - (one[shipClass] ?? 0);
    return { type: "launchFleet", mission: "defend", target: flagged, ships };
  }

  const seen = (target: number): number =>
    view.reports.find((report) => report.target === target)?.tick ??
    -config.rescoutTicks;
  const observe = fleets
    .filter(
      (option) =>
        option.mission === "observe" &&
        !sent(option.target) &&
        view.tick - seen(option.target) >= config.rescoutTicks,
    )
    .sort((a, b) => seen(a.target) - seen(b.target) || a.target - b.target)[0];
  return (
    observe && {
      type: "launchFleet",
      mission: "observe",
      target: observe.target,
      ships: one,
    }
  );
}

/** What the bot does for its team: its vote, and the commander's duties when it holds the post. */
function teamwork(
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

  // The member who is furthest behind gets the fund and the flag.
  const weakest = [view.planet, ...view.allies].reduce((a, b) =>
    b.score < a.score || (b.score === a.score && b.id < a.id) ? b : a,
  ).id;
  const flag = ofType(options, "setDefencePriority").find(
    (option) => option.planet === weakest,
  );
  if (flag && team.defencePriority !== weakest)
    commands.push(minimalCommand(flag));
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
    const bought = purchase(options, view, rules, config);
    if (bought) commands.push(bought);
    const fleet = launch(options, view, config);
    if (fleet) commands.push(fleet);
    return commands;
  };
}
