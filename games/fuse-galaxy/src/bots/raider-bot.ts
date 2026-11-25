/**
 * A simple bot that attacks. It grows its economy the way the economy bot does, but puts a larger share of it into
 * warships and capture pods, and sends everything it has at home against the richest planet it expects to beat.
 *
 * It knows as much as any player: it picks its targets from the public scoreboard (a planet's military score is an
 * upper bound on what it can meet there), and like the economy bot it keeps no state of its own. It exists so that
 * combat is played end to end in a bots-only match; it is not a strong player.
 */
import {
  NONE,
  SHIP_CLASSES,
  formationName,
  legalCommands,
  shipsValue,
  type Command,
  type CommandOption,
  type PlayerView,
  type Policy,
  type Rules,
} from "../engine/index.js";
import {
  DEFAULT_BOT_CONFIG,
  defendFlagged,
  gunships,
  ofType,
  ownShipsValue,
  purchase,
  scout,
  teamwork,
  type BotConfig,
  type Shipwright,
} from "./economy-bot.js";

export interface RaiderConfig extends BotConfig {
  /** The capture pods it keeps: at home, in its fleets and on order. */
  readonly pods: number;
  /** It attacks once the warships at home are worth this much. */
  readonly strikeValue: number;
  /** It attacks a planet whose military score is at most this share of what the strike is worth. */
  readonly oddsPercent: number;
  /** The named formation it draws its home fleet up in, and so every fleet it launches. */
  readonly formation: string;
}

export const DEFAULT_RAIDER_CONFIG: RaiderConfig = {
  ...DEFAULT_BOT_CONFIG,
  yardAtAsteroids: 6,
  fleetPercent: 45,
  shipBatch: 20,
  researchOrder: ["hulls", "mining", "travel", "sensors", "jamming"],
  pods: 10,
  strikeValue: 600,
  oddsPercent: 60,
  formation: "wall",
};

/** The pods the player has: at home, in its fleets and on order. */
function podsOwned(view: PlayerView, rules: Rules): number {
  let pods = 0;
  for (const shipClass of SHIP_CLASSES) {
    if (rules.ships[shipClass].captures === 0) continue;
    pods += view.planet.ships[shipClass];
    for (const fleet of view.fleets)
      if (fleet.owner === view.self) pods += fleet.ships[shipClass];
    for (const order of view.planet.production)
      if (order.shipClass === shipClass) pods += order.count;
  }
  return pods;
}

/** Pods until it has its share of them, then the heaviest gunship while its ships are less than a share of its value. */
const raidingFleet =
  (config: RaiderConfig): Shipwright =>
  (options, view, rules) => {
    if (
      ownShipsValue(view, rules) * 100 >=
      view.planet.value * config.fleetPercent
    )
      return undefined;
    const missing = config.pods - podsOwned(view, rules);
    const pod = ofType(options, "produceShips").find(
      (option) => rules.ships[option.shipClass].captures > 0,
    );
    // Pods are worth ordering only behind ships that can win them a battle.
    const armed = SHIP_CLASSES.some(
      (shipClass) =>
        view.planet.ships[shipClass] > 0 && rules.ships[shipClass].shots > 0,
    );
    if (pod && armed && missing > 0)
      return {
        type: "produceShips",
        shipClass: pod.shipClass,
        count: Math.min(pod.maxCount, missing),
      };
    const yard = gunships(options, rules).at(-1);
    return (
      yard && {
        type: "produceShips",
        shipClass: yard.shipClass,
        count: Math.min(yard.maxCount, config.shipBatch),
      }
    );
  };

/** Everything at home against the planet with the most asteroids that it expects to beat, one attack at a time. */
export function raid(
  options: readonly CommandOption[],
  view: PlayerView,
  rules: Rules,
  config: RaiderConfig,
): Command | undefined {
  const busy = view.fleets.some(
    (fleet) => fleet.owner === view.self && fleet.mission === "attack",
  );
  if (busy) return undefined;
  const lines = view.scoreboard.players;
  const attacks = ofType(options, "launchFleet").filter(
    (option) => option.mission === "attack",
  );
  const best = attacks
    .filter((option) => {
      const strike = shipsValue(option.maxShips, rules);
      return (
        strike >= config.strikeValue &&
        lines[option.target]!.military * 100 <= strike * config.oddsPercent
      );
    })
    .sort(
      (a, b) =>
        lines[b.target]!.asteroids - lines[a.target]!.asteroids ||
        a.target - b.target,
    )[0];
  return (
    best && {
      type: "launchFleet",
      mission: "attack",
      target: best.target,
      ships: best.maxShips,
    }
  );
}

/** A policy that plays any planet, seat or neutral, as a raider. */
export function createRaiderBot(
  config: RaiderConfig = DEFAULT_RAIDER_CONFIG,
): Policy {
  return (view, rules) => {
    // Planets take turns: each thinks on its own tick of the cycle.
    if ((view.tick + view.self) % config.thinkEvery !== 0) return [];
    const options = legalCommands(view, rules);
    if (options.length === 0) return [];
    const commands = teamwork(options, view, rules, config);
    // Before the launch, so that a fleet sent this turn is drawn up the same way.
    const drawUp = ofType(options, "setFormation").find(
      (option) =>
        option.fleet === NONE && option.formations.includes(config.formation),
    );
    if (
      drawUp &&
      formationName(view.planet.formation, rules) !== config.formation
    )
      commands.push({
        type: "setFormation",
        fleet: NONE,
        arrangement: config.formation,
      });
    const bought = purchase(options, view, rules, config, raidingFleet(config));
    if (bought) commands.push(bought);
    // One fleet a turn: an attack first, help for the flagged teammate next, a scout otherwise.
    const fleet =
      raid(options, view, rules, config) ??
      defendFlagged(options, view) ??
      scout(options, view, config);
    if (fleet) commands.push(fleet);
    return commands;
  };
}
