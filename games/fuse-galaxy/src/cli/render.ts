/** A view, a list of options and a finished match as text for the terminal. */
import {
  BRANCH_IDS,
  NONE,
  RESOURCE_IDS,
  SHIP_CLASSES,
  STRUCTURE_IDS,
  formationName,
  income,
  noShips,
  taxOn,
  teamScore,
  totalOf,
  type BattleForce,
  type BattleView,
  type CommandOption,
  type DeepReadonly,
  type Formation,
  type GameEvent,
  type PlayerView,
  type Rules,
  type ScoreLine,
  type Scoreboard,
  type ShipCounts,
  type World,
} from "../engine/index.js";

type Counts<K extends string> = Readonly<Partial<Record<K, number>>>;

/** `metal 800  crystal 800  eonium 400` */
const counts = <K extends string>(ids: readonly K[], of: Counts<K>): string =>
  ids.map((id) => `${id} ${of[id] ?? 0}`).join("  ");

/** The same, leaving out what there is none of; "none" when that is everything. */
const held = <K extends string>(ids: readonly K[], of: Counts<K>): string =>
  ids
    .filter((id) => (of[id] ?? 0) > 0)
    .map((id) => `${id} ${of[id]}`)
    .join("  ") || "none";

/** `name=amount` pairs as the terminal's commands take them. */
const pairs = <K extends string>(ids: readonly K[], of: Counts<K>): string =>
  ids
    .filter((id) => (of[id] ?? 0) > 0)
    .map((id) => `${id}=${of[id]}`)
    .join(" ");

const planetName = (id: number): string =>
  id === NONE ? "none" : `planet ${id}`;

const ticks = (count: number): string =>
  `${count} ${count === 1 ? "tick" : "ticks"}`;

export function eventLine(event: DeepReadonly<GameEvent>): string {
  switch (event.type) {
    case "rejected":
      return `refused ${event.command}: ${event.reason}`;
    case "asteroidInitiated":
      return `${planetName(event.player)} mines a new ${event.resource} asteroid`;
    case "structureBuilt":
      return `${planetName(event.player)} finished a ${event.structure}`;
    case "researchDone":
      return `${planetName(event.player)} reached ${event.branch} level ${event.level}`;
    case "shipsBuilt":
      return `${planetName(event.player)} produced ${event.count} ${event.shipClass}`;
    case "fleetArrived":
      return `fleet ${event.fleet} of ${planetName(event.player)} arrived at ${planetName(event.target)} to ${event.mission}`;
    case "fleetReturned":
      return `fleet ${event.fleet} of ${planetName(event.player)} came home`;
    case "fleetLost":
      return `fleet ${event.fleet} of ${planetName(event.player)} has no ship left`;
    case "probed":
      return `${planetName(event.player)} was probed by ${planetName(event.by)}`;
    case "battleRound":
      return (
        `battle at ${planetName(event.planet)}, round ${event.round}: ` +
        `attackers lost ${held(SHIP_CLASSES, event.attackersLost)} (${event.attackersFrozen} frozen) · ` +
        `defenders lost ${held(SHIP_CLASSES, event.defendersLost)} (${event.defendersFrozen} frozen)`
      );
    case "battleEnded":
      return (
        `battle at ${planetName(event.planet)} ended after ${event.rounds} ${event.rounds === 1 ? "round" : "rounds"}: ` +
        `${event.captured} ${event.captured === 1 ? "asteroid" : "asteroids"} captured · salvage ${held(RESOURCE_IDS, event.salvage)}`
      );
    case "asteroidsCaptured":
      return `fleet ${event.fleet} of ${planetName(event.player)} took ${held(RESOURCE_IDS, event.asteroids)} asteroids from ${planetName(event.from)}`;
    case "commanderChanged":
      return `team ${event.team}'s commander is now ${planetName(event.commander)}`;
    case "matchEnded":
      return event.winner === NONE
        ? "the match ended in a draw"
        : `the match ended: team ${event.winner} wins`;
  }
}

/** A formation by the name the rules give it, or the cell of each class it places when a player arranged it. */
const formationText = (
  formation: Readonly<Formation>,
  ships: Readonly<ShipCounts>,
  rules: Rules,
): string =>
  formationName(formation, rules) ??
  (SHIP_CLASSES.filter((shipClass) => ships[shipClass] > 0)
    .map((shipClass) => `${shipClass}=${formation[shipClass]}`)
    .join(" ") ||
    "custom");

const SCORE_COLUMNS = [
  "score",
  "economy",
  "military",
  "technology",
  "asteroids",
] as const;

const scoreRow = (name: string, line: ScoreLine): string =>
  name.padEnd(20) +
  SCORE_COLUMNS.map((column) => String(line[column]).padStart(11)).join("");

/** The public scoreboard: every team with its members under it, then the neutral planets. */
export function renderScoreboard(board: Scoreboard, self: number): string[] {
  const lines = [
    "Scoreboard".padEnd(20) +
      SCORE_COLUMNS.map((column) => column.padStart(11)).join(""),
  ];
  const planetRow = (id: number): string =>
    scoreRow(
      `    planet ${id}${id === self ? " (you)" : ""}`,
      board.players[id]!,
    );
  for (const team of board.teams) {
    lines.push(scoreRow(`  team ${team.team}`, team));
    for (const member of team.members) lines.push(planetRow(member));
  }
  const neutrals = board.players.filter((player) => player.team === NONE);
  if (neutrals.length > 0) lines.push("  neutral");
  for (const neutral of neutrals) lines.push(planetRow(neutral.planet));
  return lines;
}

const forceLine = (force: BattleForce, rules: Rules): string =>
  `${planetName(force.owner)} ${force.fleet === NONE ? "home fleet" : `fleet ${force.fleet}`}` +
  ` [${formationText(force.formation, force.ships, rules)}]: ${held(SHIP_CLASSES, force.ships)}`;

/** A battle the player can see: how far it has come and every fleet on each side. */
export function renderBattle(battle: BattleView, rules: Rules): string[] {
  const lines = [
    `Battle       at ${planetName(battle.planet)}, round ${battle.round} of ${rules.combat.rounds}`,
  ];
  for (const [side, forces] of [
    ["attacking", battle.attackers],
    ["defending", battle.defenders],
  ] as const)
    for (const force of forces)
      lines.push(`  ${side}  ${forceLine(force, rules)}`);
  return lines;
}

/** Everything the player may know, as the terminal shows it. */
export function renderView(view: PlayerView, rules: Rules): string {
  const { planet, team } = view;
  const gross = income(planet, rules);
  const tax = taxOn(gross, team ? team.taxPercent : 0);
  const lines = [
    `Tick ${view.tick}/${rules.match.tickLimit} · ${planetName(view.self)}` +
      (team ? ` · team ${team.id}` : "") +
      ` · score ${planet.score}`,
    `Resources    ${counts(RESOURCE_IDS, planet.resources)}`,
    `Income/tick  ${counts(RESOURCE_IDS, {
      metal: gross.metal - tax.metal,
      crystal: gross.crystal - tax.crystal,
      eonium: gross.eonium - tax.eonium,
    })}`,
    `Asteroids    ${counts(RESOURCE_IDS, planet.asteroids)}`,
    `Structures   ${held(STRUCTURE_IDS, planet.structures)}`,
    `Research     ${held(BRANCH_IDS, planet.research)}`,
    `Ships home   ${held(SHIP_CLASSES, planet.ships)}`,
    `Formation    ${formationText(planet.formation, planet.ships, rules)}` +
      (planet.sheltered ? " · sheltered: out of any battle here" : ""),
  ];
  if (planet.construction.length > 0)
    lines.push(
      `Building     ${planet.construction
        .map((job, index) =>
          index === 0
            ? `${job.structure} (${ticks(job.remaining)})`
            : `${job.structure} (queued)`,
        )
        .join(", ")}`,
    );
  if (planet.researchQueue.length > 0)
    lines.push(
      `Researching  ${planet.researchQueue
        .map((job, index) =>
          index === 0
            ? `${job.branch} ${job.level} (${ticks(job.remaining)})`
            : `${job.branch} ${job.level} (queued)`,
        )
        .join(", ")}`,
    );
  if (planet.production.length > 0)
    lines.push(
      `Producing    ${planet.production
        .map(
          (order) =>
            `${order.count} ${order.shipClass} (${ticks(order.remaining)})`,
        )
        .join(", ")}`,
    );
  if (team)
    lines.push(
      `Team ${team.id}       commander ${planetName(team.commander)} · tax ${team.taxPercent}% · ` +
        `defence priority ${planetName(team.defencePriority)}`,
      `Fund         ${counts(RESOURCE_IDS, team.fund)}`,
    );
  for (const ally of view.allies)
    lines.push(
      `Ally ${ally.id}       score ${ally.score} · ${counts(RESOURCE_IDS, ally.resources)} · ` +
        `ships ${held(SHIP_CLASSES, ally.ships)}`,
    );
  for (const fleet of view.fleets)
    lines.push(
      `Fleet ${fleet.id}      ${planetName(fleet.owner)} to ${fleet.mission} ${planetName(fleet.target)}, ` +
        (fleet.phase === "fighting"
          ? "fighting"
          : `${fleet.phase}, ${ticks(fleet.eta)}`) +
        ` [${formationText(fleet.formation, fleet.ships, rules)}]: ${held(SHIP_CLASSES, fleet.ships)}`,
    );
  for (const incoming of view.incoming)
    lines.push(
      `INCOMING     fleet ${incoming.fleet} of ${planetName(incoming.owner)} attacks ${planetName(incoming.target)} in ${ticks(incoming.eta)}: ` +
        (incoming.ships
          ? `${incoming.formation ? "" : "about "}${held(SHIP_CLASSES, incoming.ships)}`
          : "ships unknown") +
        (incoming.formation
          ? ` [${formationText(incoming.formation, incoming.ships ?? noShips(), rules)}]`
          : ""),
    );
  for (const battle of view.battles) lines.push(...renderBattle(battle, rules));
  lines.push("Planets      id  kind     team     x     y");
  for (const other of view.planets)
    lines.push(
      [
        "            ",
        String(other.id).padStart(3),
        ` ${other.kind.padEnd(8)}`,
        (other.team === NONE ? "-" : String(other.team)).padStart(4),
        String(other.x).padStart(6),
        String(other.y).padStart(6),
        other.id === view.self ? "  (you)" : "",
      ].join(""),
    );
  lines.push(...renderScoreboard(view.scoreboard, view.self));
  for (const report of view.reports)
    lines.push(
      `Report       ${planetName(report.target)} at tick ${report.tick} by ${planetName(report.by)}: ` +
        `asteroids ${counts(RESOURCE_IDS, report.asteroids)}` +
        (report.resources
          ? ` · stock ${counts(RESOURCE_IDS, report.resources)}`
          : "") +
        (report.structures
          ? ` · structures ${held(STRUCTURE_IDS, report.structures)}`
          : "") +
        (report.research
          ? ` · research ${held(BRANCH_IDS, report.research)}`
          : "") +
        (report.ships
          ? ` · ships ${report.resources ? "" : "about "}${held(SHIP_CLASSES, report.ships)}`
          : "") +
        (report.formation
          ? ` [${formationText(report.formation, report.ships ?? noShips(), rules)}]`
          : "") +
        (report.sheltered ? " · sheltered" : ""),
    );
  for (const event of view.events)
    lines.push(`Event        ${eventLine(event)}`);
  if (view.result)
    lines.push(
      `Result       ${
        view.result.winner === NONE
          ? "a draw"
          : `team ${view.result.winner} wins`
      } · team scores ${view.result.teamScores.join(" / ")}`,
    );
  return lines.join("\n");
}

/** One option as the command to type for it, with what it costs. */
export function optionLine(option: CommandOption): string {
  switch (option.type) {
    case "initiateAsteroid":
      return `roid ${option.resource}   (${held(RESOURCE_IDS, option.cost)})`;
    case "buildStructure":
      return `build ${option.structure}   (${held(RESOURCE_IDS, option.cost)}, ${ticks(option.ticks)})`;
    case "startResearch":
      return `research ${option.branch}   (level ${option.level}: ${held(RESOURCE_IDS, option.cost)}, ${ticks(option.ticks)})`;
    case "produceShips":
      return `ships ${option.shipClass} <1-${option.maxCount}>   (each ${held(RESOURCE_IDS, option.unitCost)}, ${ticks(option.ticks)})`;
    case "launchFleet":
      return `launch ${option.mission} ${option.target} <ships>   (up to ${pairs(SHIP_CLASSES, option.maxShips)})`;
    case "recallFleet":
      return `recall ${option.fleet}`;
    case "setFormation":
      return `formation ${option.fleet === NONE ? "home" : option.fleet} <${option.formations.join("|")}>   (or <class>=<cell> ...)`;
    case "setShelter":
      return `shelter ${option.sheltered ? "on" : "off"}`;
    case "voteCommander":
      return `vote ${option.candidate}`;
    case "setTax":
      return `tax <0-${option.maxPercent}>`;
    case "grant":
      return `grant ${option.to} <amounts>   (up to ${pairs(RESOURCE_IDS, option.max)})`;
    case "setDefencePriority":
      return `priority ${option.planet === NONE ? "none" : option.planet}`;
    case "donate":
      return `donate <amounts>   (up to ${pairs(RESOURCE_IDS, option.max)})`;
  }
}

export const renderLegal = (options: readonly CommandOption[]): string =>
  options.length === 0
    ? "Nothing can be done now."
    : options.map((option) => `  ${optionLine(option)}`).join("\n");

/** A finished (or stopped) match: the result, then every team and planet. */
export function renderStandings(world: World, rules: Rules): string {
  const lines: string[] = [];
  const planetLine = (id: number): string => {
    const planet = world.planets[id]!;
    return (
      `  planet ${String(id).padStart(2)}  score ${String(planet.score).padStart(7)}` +
      ` (economy ${planet.parts.economy}, military ${planet.parts.military}, technology ${planet.parts.technology})` +
      `  asteroids ${String(totalOf(planet.asteroids)).padStart(3)}` +
      `  structures ${String(STRUCTURE_IDS.reduce((sum, structure) => sum + planet.structures[structure], 0)).padStart(2)}` +
      `  research ${String(BRANCH_IDS.reduce((sum, branch) => sum + planet.research[branch], 0)).padStart(2)}` +
      `  ships ${held(SHIP_CLASSES, planet.ships)}`
    );
  };
  if (world.result)
    lines.push(
      world.result.winner === NONE
        ? `Result: a draw after ${ticks(world.result.tick)}`
        : `Result: team ${world.result.winner} wins after ${ticks(world.result.tick)}`,
    );
  else lines.push(`Stopped at tick ${world.tick}, no result`);
  for (const team of world.teams) {
    lines.push(
      `Team ${team.id}  score ${teamScore(team, world.planets, rules)}` +
        `  commander ${planetName(team.commander)}  tax ${team.taxPercent}%` +
        `  fund ${counts(RESOURCE_IDS, team.fund)}`,
    );
    for (const member of team.members) lines.push(planetLine(member));
  }
  const neutrals = world.planets.filter((planet) => planet.kind === "neutral");
  if (neutrals.length > 0) lines.push("Neutral planets");
  for (const neutral of neutrals) lines.push(planetLine(neutral.id));
  return lines.join("\n");
}
