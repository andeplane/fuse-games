/**
 * One tick of the game: `applyTick(world, submissions, rules)` returns the next world and never changes the one it
 * was given. It is a pure function of its arguments: no clock, no I/O, whole numbers only, and any randomness drawn
 * from `world.rng`. The same world, submissions and rules give the same next world on every machine.
 *
 * The phases, always in this order:
 *
 * 1. commands, player by player in id order and each player's in the order sent; a command is checked against the
 *    state the commands before it left, and a refused one becomes a `rejected` event with its reason
 * 2. income: base, asteroids and structures, with the team's tax diverted to its fund
 * 3. construction, research and ship production advance
 * 4. fleets move, arrive, observe and come home; an attack that lands joins the battle at its target or starts one
 * 5. one round of every battle (`combat.ts`)
 * 6. a battle that is over: asteroids captured, wreckage salvaged, the attackers sent home
 * 7. value and score
 * 8. the match ends at the tick limit
 */
import { fightBattles } from "./combat.js";
import { commandProblem, parseCommand } from "./commands.js";
import { income, shipTotal, taxOn } from "./economy.js";
import { deepFreeze, freezeWorld } from "./freeze.js";
import { isRecord, isWhole } from "./guards.js";
import { notices, observe } from "./intel.js";
import { min } from "./math.js";
import { execute } from "./orders.js";
import type { Rules } from "./rules.js";
import { endMatch, updateScores } from "./score.js";
import {
  NONE,
  RESOURCE_IDS,
  SHIP_CLASSES,
  noResources,
  teamOf,
  type DeepReadonly,
  type Fleet,
  type GameEvent,
  type Planet,
  type Resources,
  type ShipCounts,
  type World,
  type WorldDraft,
} from "./world.js";

/*
 * The copies below name every field instead of spreading the object. A world is frozen, and a JavaScript engine
 * copies a frozen object with a spread several times slower than it copies it field by field; that was most of
 * what freezing cost. The types keep the lists honest: a field added to `Planet` and left out here does not compile.
 */

const copyResources = (from: Readonly<Resources>): Resources => ({
  metal: from.metal,
  crystal: from.crystal,
  eonium: from.eonium,
});

const copyShips = (from: Readonly<ShipCounts>): ShipCounts => ({
  probe: from.probe,
  fighter: from.fighter,
  corvette: from.corvette,
  frigate: from.frigate,
  destroyer: from.destroyer,
  cruiser: from.cruiser,
  battleship: from.battleship,
  pod: from.pod,
});

const clonePlanet = (planet: DeepReadonly<Planet>): Planet => ({
  id: planet.id,
  kind: planet.kind,
  team: planet.team,
  x: planet.x,
  y: planet.y,
  resources: copyResources(planet.resources),
  asteroids: copyResources(planet.asteroids),
  structures: {
    metalRefinery: planet.structures.metalRefinery,
    crystalRefinery: planet.structures.crystalRefinery,
    eoniumRefinery: planet.structures.eoniumRefinery,
    researchLab: planet.structures.researchLab,
    shipyard: planet.structures.shipyard,
  },
  research: {
    travel: planet.research.travel,
    hulls: planet.research.hulls,
    sensors: planet.research.sensors,
    mining: planet.research.mining,
    jamming: planet.research.jamming,
  },
  construction: planet.construction.map((job) => ({
    structure: job.structure,
    remaining: job.remaining,
  })),
  researchQueue: planet.researchQueue.map((job) => ({
    branch: job.branch,
    level: job.level,
    remaining: job.remaining,
  })),
  production: planet.production.map((order) => ({
    shipClass: order.shipClass,
    count: order.count,
    remaining: order.remaining,
  })),
  ships: copyShips(planet.ships),
  formation: planet.formation,
  sheltered: planet.sheltered,
  xp: planet.xp,
  value: planet.value,
  score: planet.score,
  parts: planet.parts,
});

/**
 * A private copy of a world for one tick to change. Scout reports, formations and a score's parts are never changed
 * once made, only replaced, so they are shared.
 */
const draftOf = (world: World): WorldDraft => ({
  rulesVersion: world.rulesVersion,
  seed: world.seed,
  tick: world.tick,
  rng: world.rng,
  phase: world.phase,
  result: null,
  planets: world.planets.map(clonePlanet),
  fleets: world.fleets.map((fleet) => ({
    id: fleet.id,
    owner: fleet.owner,
    mission: fleet.mission,
    target: fleet.target,
    ships: copyShips(fleet.ships),
    formation: fleet.formation,
    phase: fleet.phase,
    eta: fleet.eta,
    travelTicks: fleet.travelTicks,
  })),
  nextFleetId: world.nextFleetId,
  battles: world.battles.map((battle) => ({
    planet: battle.planet,
    round: battle.round,
    wounds: battle.wounds.map((wounds) => ({
      fleet: wounds.fleet,
      damage: copyShips(wounds.damage),
    })),
    wreck: copyResources(battle.wreck),
  })),
  teams: world.teams.map((team) => ({
    id: team.id,
    members: [...team.members],
    fund: copyResources(team.fund),
    taxPercent: team.taxPercent,
    commander: team.commander,
    votes: [...team.votes],
    defencePriority: team.defencePriority,
  })),
  knowledge: [...world.knowledge],
  events: [],
});

const rejected = (
  player: number,
  command: string,
  reason: string,
): GameEvent => ({ type: "rejected", player, command, reason });

/** What a rejected event calls a command that was never read. */
const typeOf = (command: unknown): string => {
  const parsed = parseCommand(command);
  return parsed.ok ? parsed.command.type : parsed.type;
};

/**
 * Who sent a submission and what they sent. A submission is as untrusted as the command in it: one that is not a
 * record, or names no planet, is from nobody (`NONE`).
 */
function read(
  submission: unknown,
  planets: number,
): { readonly player: number; readonly command: unknown } {
  if (!isRecord(submission)) return { player: NONE, command: undefined };
  const { player, command } = submission;
  return isWhole(player) && player >= 0 && player < planets
    ? // Adding zero turns a negative zero into the id it names.
      { player: player + 0, command }
    : { player: NONE, command };
}

/** Each player's commands in the order sent, by player id; one event for all those sent as nobody. */
function sortByPlayer(
  planets: number,
  submissions: readonly unknown[],
  events: GameEvent[],
): unknown[][] {
  const byPlayer: unknown[][] = Array.from({ length: planets }, () => []);
  let strays = 0;
  for (const submission of submissions) {
    const { player, command } = read(submission, planets);
    const commands = byPlayer[player];
    if (commands) commands.push(command);
    else if (strays++ === 0)
      events.push(rejected(NONE, typeOf(command), "unknown player"));
  }
  return byPlayer;
}

/**
 * What an ended match says to what is still sent to it: one event for each sender's first command and one for all
 * those sent as nobody, so the list is no longer than the planets are many.
 */
function refuseAll(
  planets: number,
  submissions: readonly unknown[],
): GameEvent[] {
  const events: GameEvent[] = [];
  const told = new Set<number>();
  for (const submission of submissions) {
    const { player, command } = read(submission, planets);
    if (told.has(player)) continue;
    told.add(player);
    events.push(rejected(player, typeOf(command), "the match has ended"));
  }
  return events;
}

function applyCommands(
  world: WorldDraft,
  submissions: readonly unknown[],
  rules: Rules,
): void {
  const byPlayer = sortByPlayer(
    world.planets.length,
    submissions,
    world.events,
  );
  for (const [player, commands] of byPlayer.entries()) {
    for (const [index, raw] of commands.entries()) {
      if (index >= rules.limits.commandsPerPlayerPerTick) {
        world.events.push(
          rejected(player, typeOf(raw), "too many commands in one tick"),
        );
        break;
      }
      const parsed = parseCommand(raw);
      if (!parsed.ok) {
        world.events.push(rejected(player, parsed.type, parsed.reason));
        continue;
      }
      const planet = world.planets[player]!;
      const problem = commandProblem(
        {
          ended: false,
          planet,
          team: teamOf(world.teams, planet.team),
          fleets: world.fleets,
          planets: world.planets,
        },
        parsed.command,
        rules,
      );
      if (problem)
        world.events.push(rejected(player, parsed.command.type, problem));
      else execute(world, player, parsed.command, rules);
    }
  }
}

function earnIncome(world: WorldDraft, rules: Rules): void {
  const cap = rules.limits.resourceCap;
  for (const planet of world.planets) {
    const gross = income(planet, rules);
    const team = teamOf(world.teams, planet.team);
    const tax = taxOn(gross, team ? team.taxPercent : 0);
    for (const resource of RESOURCE_IDS) {
      planet.resources[resource] = min(
        cap,
        planet.resources[resource] + gross[resource] - tax[resource],
      );
      if (team)
        team.fund[resource] = min(cap, team.fund[resource] + tax[resource]);
    }
  }
}

function advanceQueues(world: WorldDraft): void {
  for (const planet of world.planets) {
    const building = planet.construction[0];
    if (building && --building.remaining <= 0) {
      planet.construction.shift();
      planet.structures[building.structure] += 1;
      world.events.push({
        type: "structureBuilt",
        player: planet.id,
        structure: building.structure,
      });
    }
    const researching = planet.researchQueue[0];
    if (researching && --researching.remaining <= 0) {
      planet.researchQueue.shift();
      planet.research[researching.branch] = researching.level;
      world.events.push({
        type: "researchDone",
        player: planet.id,
        branch: researching.branch,
        level: researching.level,
      });
    }
    if (planet.production.length === 0) continue;
    planet.production = planet.production.filter((order) => {
      if (--order.remaining > 0) return true;
      planet.ships[order.shipClass] += order.count;
      world.events.push({
        type: "shipsBuilt",
        player: planet.id,
        shipClass: order.shipClass,
        count: order.count,
      });
      return false;
    });
  }
}

/**
 * A tick in orbit: the probes report, and a planet that has noticed them shoots some down. Returns whether any are
 * left.
 */
function orbit(world: WorldDraft, fleet: Fleet, rules: Rules): boolean {
  const target = world.planets[fleet.target]!;
  if (notices(target, world.planets[fleet.owner]!, rules)) {
    let shot = rules.intel.orbitLossPerTick;
    for (const shipClass of SHIP_CLASSES) {
      const lost = min(shot, fleet.ships[shipClass]);
      fleet.ships[shipClass] -= lost;
      shot -= lost;
    }
    if (shipTotal(fleet.ships) === 0) {
      world.events.push({
        type: "fleetLost",
        player: fleet.owner,
        fleet: fleet.id,
      });
      return false;
    }
  }
  observe(world, fleet, rules);
  return true;
}

/** What a fleet does on the tick it reaches its target. */
function arrive(world: WorldDraft, fleet: Fleet, rules: Rules): void {
  world.events.push({
    type: "fleetArrived",
    player: fleet.owner,
    fleet: fleet.id,
    target: fleet.target,
    mission: fleet.mission,
  });
  if (fleet.mission === "attack") {
    // It joins the battle at the planet, or starts one, and stays until that battle is over.
    fleet.phase = "fighting";
    fleet.eta = 0;
    if (!world.battles.some((battle) => battle.planet === fleet.target))
      world.battles.push({
        planet: fleet.target,
        round: 0,
        wounds: [],
        wreck: noResources(),
      });
    return;
  }
  if (fleet.mission === "defend") {
    fleet.phase = "stationed";
    fleet.eta = rules.fleet.defendTicks;
    return;
  }
  observe(world, fleet, rules);
  const target = world.planets[fleet.target]!;
  if (notices(target, world.planets[fleet.owner]!, rules))
    world.events.push({ type: "probed", player: target.id, by: fleet.owner });
  if (fleet.mission === "orbit") {
    fleet.phase = "stationed";
    fleet.eta = rules.intel.orbitTicks;
    return;
  }
  // A fly-past turns round as soon as it has looked.
  fleet.phase = "returning";
  fleet.eta = fleet.travelTicks;
}

function moveFleets(world: WorldDraft, rules: Rules): void {
  if (world.fleets.length === 0) return;
  // The planets fought over this tick: a battle in progress, or an attack that lands now.
  const embattled = new Set(world.battles.map((battle) => battle.planet));
  for (const fleet of world.fleets)
    if (
      fleet.mission === "attack" &&
      fleet.phase === "outbound" &&
      fleet.eta <= 1
    )
      embattled.add(fleet.target);
  world.fleets = world.fleets.filter((fleet) => {
    if (fleet.phase === "fighting") return true;
    if (fleet.phase === "stationed") {
      if (fleet.mission === "orbit") {
        if (!orbit(world, fleet, rules)) return false;
      } else if (embattled.has(fleet.target)) return true;
      // A defender's watch does not run down while the planet is fought over.
    }
    if (--fleet.eta > 0) return true;
    if (fleet.phase === "returning") {
      const home = world.planets[fleet.owner]!;
      for (const shipClass of SHIP_CLASSES)
        home.ships[shipClass] += fleet.ships[shipClass];
      world.events.push({
        type: "fleetReturned",
        player: fleet.owner,
        fleet: fleet.id,
      });
      return false;
    }
    if (fleet.phase === "outbound") {
      arrive(world, fleet, rules);
      return true;
    }
    // A defender flies home when its watch is over, and probes when their time in orbit is.
    fleet.phase = "returning";
    fleet.eta = fleet.travelTicks;
    return true;
  });
}

/**
 * The world one tick later, frozen all the way down. A match that has ended stays as it is: the tick does not
 * advance, and whatever is submitted is rejected.
 *
 * A submission is meant to be an `UntrustedSubmission`, and the type says `unknown` because nothing here relies on
 * it: whatever is not one is refused as sent by nobody, never thrown on. Submissions are read as plain data, as
 * `JSON.parse` would give them; an object with a getter that throws is outside what the engine promises.
 */
export function applyTick(
  world: World,
  submissions: readonly unknown[],
  rules: Rules,
): World {
  if (world.phase === "ended") {
    if (submissions.length === 0) return world;
    return deepFreeze({
      ...world,
      events: refuseAll(world.planets.length, submissions),
    });
  }
  const draft = draftOf(world);
  draft.tick += 1;
  applyCommands(draft, submissions, rules);
  earnIncome(draft, rules);
  advanceQueues(draft);
  moveFleets(draft, rules);
  fightBattles(draft, rules);
  updateScores(draft.planets, draft.fleets, rules);
  endMatch(draft, rules);
  return freezeWorld(draft);
}
