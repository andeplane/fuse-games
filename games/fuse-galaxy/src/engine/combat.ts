/**
 * Battles. A battle is fought at a planet between every fleet attacking it and its home fleet with the fleets
 * defending it, one round a tick, until one side is gone or the rules' number of rounds has been fought. Whoever
 * still has capture pods at the end takes asteroids, and the planet's owner salvages the wreckage.
 *
 * The engine never follows a single ship. A fleet is a squadron per class: a count and its pooled hit points, so a
 * round costs the same for ten ships as for ten thousand.
 *
 * A round, in full:
 *
 * - Where a squadron stands decides what it can reach (`formation.ts`), fixed as the lines stood when the round began.
 * - The classes fire in the order of their initiative, the lowest first; classes with the same initiative fire
 *   together, so what one of them destroys still fires back.
 * - A squadron fires `shots` for each ship that is not frozen, at the classes on its target list in that order, at
 *   whatever of each it can reach. A shot does `attack` damage and destroys at most one ship, so a heavy gun wastes
 *   what it does past a small ship's armour.
 * - A freezing shot destroys nothing: for every armour's worth of it, one ship of the target does not fire this round.
 */
import { shipTotal, totalOf } from "./economy.js";
import { CELLS, COLUMNS, columnOf } from "./formation.js";
import { PERCENT, ceilDiv, clamp, div, max, min, percentOf } from "./math.js";
import type { Rules, ShipRule } from "./rules.js";
import { shipsValue } from "./score.js";
import {
  NONE,
  RESOURCE_IDS,
  SHIP_CLASSES,
  noResources,
  noShips,
  type Battle,
  type Fleet,
  type Formation,
  type Planet,
  type ResourceId,
  type Resources,
  type ShipClass,
  type ShipCounts,
  type WorldDraft,
} from "./world.js";

/** One fleet in a battle: a planet's home fleet or a fleet that flew there. A round changes its ships and damage. */
export interface Force {
  readonly owner: number;
  /** The fleet's id, or `NONE` for a home fleet. */
  readonly fleet: number;
  readonly formation: Readonly<Formation>;
  /** How many of each class are left. */
  readonly ships: ShipCounts;
  /** The damage each class's squadron carries: less than one ship's armour. */
  readonly damage: ShipCounts;
}

/** What one round did. The pairs are the attackers' side, then the defenders'. */
export interface RoundOutcome {
  readonly lost: readonly [ShipCounts, ShipCounts];
  /** Ships that did not fire because they were frozen. */
  readonly frozen: readonly [number, number];
  /** The value of what each force destroyed, in the order the forces were given. */
  readonly destroyed: readonly [readonly number[], readonly number[]];
}

interface Squadron {
  readonly side: number;
  /** The force's place in its side's list. */
  readonly force: number;
  readonly shipClass: ShipClass;
  readonly rule: ShipRule;
  readonly cell: number;
  count: number;
  /** Pooled hit points: one armour for each ship, less the damage the squadron carries. */
  hp: number;
  /** Freezing damage taken this round. */
  stun: number;
  /** How many occupied cells of its own side stand in front of it. */
  depth: number;
  /** Whether no enemy stands anywhere in its column. */
  flanking: boolean;
  /** How many of its ships fire in the step being resolved. */
  firing: number;
}

/** Whether a class takes part in a battle at all. */
const fights = (rule: ShipRule): boolean => !rule.probe;

/** Whether a set of ships holds anything a battle can be fought with or against. */
export const hasCombatants = (
  ships: Readonly<ShipCounts>,
  rules: Rules,
): boolean =>
  SHIP_CLASSES.some(
    (shipClass) => ships[shipClass] > 0 && fights(rules.ships[shipClass]),
  );

function squadronsOf(
  forces: readonly Force[],
  side: number,
  rules: Rules,
): Squadron[] {
  const squadrons: Squadron[] = [];
  for (const [index, force] of forces.entries())
    for (const shipClass of SHIP_CLASSES) {
      const rule = rules.ships[shipClass];
      const count = force.ships[shipClass];
      if (count <= 0 || !fights(rule)) continue;
      squadrons.push({
        side,
        force: index,
        shipClass,
        rule,
        cell: force.formation[shipClass],
        count,
        hp: count * rule.armour - force.damage[shipClass],
        stun: 0,
        depth: 0,
        flanking: false,
        firing: 0,
      });
    }
  return squadrons;
}

/** Sets every squadron's depth and whether it has turned a flank, from the cells each side occupies. */
function drawUp(squadrons: readonly Squadron[]): void {
  const occupied = [
    Array.from({ length: CELLS }, () => false),
    Array.from({ length: CELLS }, () => false),
  ];
  for (const squadron of squadrons)
    occupied[squadron.side]![squadron.cell] = true;
  for (const squadron of squadrons) {
    const column = columnOf(squadron.cell);
    let depth = 0;
    for (let cell = column; cell < squadron.cell; cell += COLUMNS)
      if (occupied[squadron.side]![cell]) depth += 1;
    let opposed = false;
    for (let cell = column; cell < CELLS; cell += COLUMNS)
      if (occupied[1 - squadron.side]![cell]) opposed = true;
    squadron.depth = depth;
    squadron.flanking = !opposed;
  }
}

/** The formation rule: reach is the shooter's depth plus the target's, and a flanker ignores the target's. */
const reaches = (shooter: Squadron, target: Squadron): boolean =>
  shooter.depth + (shooter.flanking ? 0 : target.depth) < shooter.rule.range;

/** The initiatives of the classes that fire, the first to fire first. */
function initiatives(rules: Rules): number[] {
  const steps: number[] = [];
  for (const shipClass of SHIP_CLASSES) {
    const rule = rules.ships[shipClass];
    if (rule.shots > 0 && rule.attack > 0 && !steps.includes(rule.initiative))
      steps.push(rule.initiative);
  }
  return steps.sort((a, b) => a - b);
}

/**
 * Fights one round between two sides and leaves each force's ships and damage as the round left them. Pure but for
 * that: the same forces and rules always give the same round.
 */
export function fightRound(
  attackers: readonly Force[],
  defenders: readonly Force[],
  rules: Rules,
): RoundOutcome {
  const sides = [attackers, defenders] as const;
  const squadrons = [
    ...squadronsOf(attackers, 0, rules),
    ...squadronsOf(defenders, 1, rules),
  ];
  drawUp(squadrons);
  const lost: [ShipCounts, ShipCounts] = [noShips(), noShips()];
  const destroyed: [number[], number[]] = [
    attackers.map(() => 0),
    defenders.map(() => 0),
  ];

  for (const initiative of initiatives(rules)) {
    const shooters = squadrons.filter(
      (squadron) =>
        squadron.count > 0 &&
        squadron.rule.shots > 0 &&
        squadron.rule.attack > 0 &&
        squadron.rule.initiative === initiative,
    );
    // Everything with this initiative fires together: who fires is settled before any of it lands.
    for (const shooter of shooters)
      shooter.firing =
        shooter.count -
        min(shooter.count, div(shooter.stun, shooter.rule.armour));
    for (const shooter of shooters) {
      let shots = shooter.firing * shooter.rule.shots;
      for (const targetClass of shooter.rule.targets) {
        if (shots <= 0) break;
        for (const target of squadrons) {
          if (shots <= 0) break;
          if (
            target.side === shooter.side ||
            target.shipClass !== targetClass ||
            target.count <= 0 ||
            !reaches(shooter, target)
          )
            continue;
          const perShot = min(shooter.rule.attack, target.rule.armour);
          if (shooter.rule.effect === "freeze") {
            const unfrozen = target.count * target.rule.armour - target.stun;
            if (unfrozen <= 0) continue;
            const used = min(shots, ceilDiv(unfrozen, perShot));
            target.stun += used * perShot;
            shots -= used;
            continue;
          }
          const used = min(shots, ceilDiv(target.hp, perShot));
          const damage = min(target.hp, used * perShot);
          shots -= used;
          target.hp -= damage;
          const left = ceilDiv(target.hp, target.rule.armour);
          lost[target.side]![target.shipClass] += target.count - left;
          target.count = left;
          destroyed[shooter.side]![shooter.force]! += div(
            damage * target.rule.value,
            target.rule.armour,
          );
        }
      }
    }
  }

  const frozen: [number, number] = [0, 0];
  for (const squadron of squadrons) {
    const force = sides[squadron.side]![squadron.force]!;
    force.ships[squadron.shipClass] = squadron.count;
    force.damage[squadron.shipClass] =
      squadron.count * squadron.rule.armour - squadron.hp;
    frozen[squadron.side]! += min(
      squadron.count,
      div(squadron.stun, squadron.rule.armour),
    );
  }
  return { lost, frozen, destroyed };
}

/** What a set of ships cost to build. */
function costOf(ships: Readonly<ShipCounts>, rules: Rules): Resources {
  const cost = noResources();
  for (const shipClass of SHIP_CLASSES)
    for (const resource of RESOURCE_IDS)
      cost[resource] +=
        ships[shipClass] * rules.ships[shipClass].cost[resource];
  return cost;
}

function addTo(stock: Resources, more: Readonly<Resources>): void {
  for (const resource of RESOURCE_IDS) stock[resource] += more[resource];
}

/** The battle at a planet, or undefined. */
export const battleAt = (
  world: WorldDraft,
  planet: number,
): Battle | undefined =>
  world.battles.find((battle) => battle.planet === planet);

/**
 * What it costs to leave a battle: a share of every class of the ships is left behind as wreckage, at least one of
 * each. The squadron's damage goes with what is left behind.
 */
export function abandon(
  battle: Battle,
  fleet: number,
  ships: ShipCounts,
  rules: Rules,
): void {
  const left = noShips();
  for (const shipClass of SHIP_CLASSES) {
    if (!fights(rules.ships[shipClass])) continue;
    left[shipClass] = ceilDiv(
      ships[shipClass] * rules.combat.retreatLossPercent,
      PERCENT,
    );
    ships[shipClass] -= left[shipClass];
  }
  addTo(battle.wreck, costOf(left, rules));
  battle.wounds = battle.wounds.filter((wounds) => wounds.fleet !== fleet);
}

/** How many asteroids the ships of a fleet can carry off. */
const podsOf = (ships: Readonly<ShipCounts>, rules: Rules): number =>
  SHIP_CLASSES.reduce(
    (sum, shipClass) =>
      sum + ships[shipClass] * rules.ships[shipClass].captures,
    0,
  );

/**
 * How many asteroids a battle's winners may take from a planet at most: a share of what it has, in full when the
 * planet is nearly as large as the largest attacker and in proportion below that.
 */
export function captureCap(
  asteroids: number,
  targetScore: number,
  attackerScore: number,
  rules: Rules,
): number {
  const full = percentOf(asteroids, rules.capture.maxPercent);
  const ratio = div(targetScore * PERCENT, max(1, attackerScore));
  const scaled =
    ratio >= rules.capture.fullRatioPercent
      ? full
      : div(full * ratio, max(1, rules.capture.fullRatioPercent));
  return min(asteroids, max(scaled, rules.capture.minimum));
}

/** Takes asteroids from a planet for the attacking fleets that still have pods. Returns how many were taken. */
function capture(
  world: WorldDraft,
  planet: Planet,
  fleets: readonly Fleet[],
  rules: Rules,
): number {
  const carriers = fleets.filter((fleet) => podsOf(fleet.ships, rules) > 0);
  const asteroids = totalOf(planet.asteroids);
  if (carriers.length === 0 || asteroids === 0) return 0;
  const largest = fleets.reduce(
    (score, fleet) => max(score, world.planets[fleet.owner]!.score),
    0,
  );
  const pods = carriers.map((fleet) => podsOf(fleet.ships, rules));
  const values = carriers.map((fleet) => shipsValue(fleet.ships, rules));
  const total = min(
    captureCap(asteroids, planet.score, largest, rules),
    pods.reduce((sum, count) => sum + count, 0),
  );
  // Each fleet's share is by its value, as far as its pods carry;
  const allValue = max(
    1,
    values.reduce((sum, value) => sum + value, 0),
  );
  const shares = carriers.map((_, index) =>
    min(pods[index]!, div(total * values[index]!, allValue)),
  );
  // what rounding and short-handed fleets leave over goes one at a time to the most valuable fleet with a pod free.
  const order = carriers
    .map((_, index) => index)
    .sort(
      (a, b) => values[b]! - values[a]! || carriers[a]!.id - carriers[b]!.id,
    );
  let spare = total - shares.reduce((sum, share) => sum + share, 0);
  while (spare > 0)
    for (const index of order) {
      if (spare <= 0) break;
      if (shares[index]! >= pods[index]!) continue;
      shares[index]! += 1;
      spare -= 1;
    }

  for (const [index, fleet] of carriers.entries()) {
    const share = shares[index]!;
    if (share === 0) continue;
    const owner = world.planets[fleet.owner]!;
    const taken = noResources();
    for (let count = 0; count < share; count++) {
      // The planet gives up whichever kind it has most of.
      let richest: ResourceId = RESOURCE_IDS[0];
      for (const resource of RESOURCE_IDS)
        if (planet.asteroids[resource] > planet.asteroids[richest])
          richest = resource;
      planet.asteroids[richest] -= 1;
      taken[richest] += 1;
    }
    for (const resource of RESOURCE_IDS)
      owner.asteroids[resource] = min(
        rules.asteroid.maxPerResource,
        owner.asteroids[resource] + taken[resource],
      );
    // A pod is spent on what it captures.
    let carried = share;
    for (const shipClass of SHIP_CLASSES) {
      const each = rules.ships[shipClass].captures;
      if (each <= 0 || carried <= 0) continue;
      const spent = min(fleet.ships[shipClass], ceilDiv(carried, each));
      fleet.ships[shipClass] -= spent;
      carried -= spent * each;
    }
    owner.xp += share * rules.xp.perAsteroid;
    world.events.push({
      type: "asteroidsCaptured",
      player: fleet.owner,
      fleet: fleet.id,
      from: planet.id,
      asteroids: taken,
    });
  }
  return total;
}

/** The fleets attacking a planet now, and the fleets defending it. */
export const attackersAt = <T extends Pick<Fleet, "target" | "phase">>(
  fleets: readonly T[],
  planet: number,
): T[] =>
  fleets.filter(
    (fleet) => fleet.target === planet && fleet.phase === "fighting",
  );

export const defendersAt = <
  T extends Pick<Fleet, "target" | "phase" | "mission">,
>(
  fleets: readonly T[],
  planet: number,
): T[] =>
  fleets.filter(
    (fleet) =>
      fleet.target === planet &&
      fleet.phase === "stationed" &&
      fleet.mission === "defend",
  );

/** Fights one tick of a battle. Returns whether the battle is over. */
function fightAt(world: WorldDraft, battle: Battle, rules: Rules): boolean {
  const planet = world.planets[battle.planet]!;
  const attacking = attackersAt(world.fleets, planet.id);
  const defending = defendersAt(world.fleets, planet.id);
  const damageOf = (fleet: number): ShipCounts =>
    battle.wounds.find((wounds) => wounds.fleet === fleet)?.damage ?? noShips();
  const attackers: Force[] = attacking.map((fleet) => ({
    owner: fleet.owner,
    fleet: fleet.id,
    formation: fleet.formation,
    ships: fleet.ships,
    damage: damageOf(fleet.id),
  }));
  const defenders: Force[] = defending.map((fleet) => ({
    owner: fleet.owner,
    fleet: fleet.id,
    formation: fleet.formation,
    ships: fleet.ships,
    damage: damageOf(fleet.id),
  }));
  if (!planet.sheltered && hasCombatants(planet.ships, rules))
    defenders.unshift({
      owner: planet.id,
      fleet: NONE,
      formation: planet.formation,
      ships: planet.ships,
      damage: damageOf(NONE),
    });
  const parties = [
    ...new Set([
      planet.id,
      ...[...attackers, ...defenders].map((f) => f.owner),
    ]),
  ].sort((a, b) => a - b);
  const standing = (forces: readonly Force[]): boolean =>
    forces.some((force) => hasCombatants(force.ships, rules));

  if (
    standing(attackers) &&
    standing(defenders) &&
    battle.round < rules.combat.rounds
  ) {
    const outcome = fightRound(attackers, defenders, rules);
    battle.round += 1;
    battle.wounds = [...attackers, ...defenders]
      .filter((force) => shipTotal(force.damage) > 0)
      .map((force) => ({ fleet: force.fleet, damage: force.damage }));
    for (const lost of outcome.lost) addTo(battle.wreck, costOf(lost, rules));
    // Fighting earns its own score: more for hitting a planet larger than yourself, and for defending.
    for (const [index, force] of attackers.entries()) {
      const owner = world.planets[force.owner]!;
      owner.xp += percentOf(
        percentOf(outcome.destroyed[0][index]!, rules.xp.attackPercent),
        clamp(
          div(planet.score * PERCENT, max(1, owner.score)),
          rules.xp.minRatioPercent,
          rules.xp.maxRatioPercent,
        ),
      );
    }
    for (const [index, force] of defenders.entries())
      world.planets[force.owner]!.xp += percentOf(
        outcome.destroyed[1][index]!,
        rules.xp.defendPercent,
      );
    world.events.push({
      type: "battleRound",
      planet: planet.id,
      round: battle.round,
      parties,
      attackersLost: outcome.lost[0],
      defendersLost: outcome.lost[1],
      attackersFrozen: outcome.frozen[0],
      defendersFrozen: outcome.frozen[1],
    });
  }

  const attackersLeft = standing(attackers);
  if (
    attackersLeft &&
    standing(defenders) &&
    battle.round < rules.combat.rounds
  )
    return false;

  const captured = attackersLeft
    ? capture(
        world,
        planet,
        attacking.filter((fleet) => shipTotal(fleet.ships) > 0),
        rules,
      )
    : 0;
  const salvage = noResources();
  for (const resource of RESOURCE_IDS) {
    salvage[resource] = percentOf(
      battle.wreck[resource],
      rules.combat.salvagePercent,
    );
    planet.resources[resource] = min(
      rules.limits.resourceCap,
      planet.resources[resource] + salvage[resource],
    );
  }
  for (const fleet of attacking) {
    fleet.phase = "returning";
    fleet.eta = fleet.travelTicks;
  }
  world.events.push({
    type: "battleEnded",
    planet: planet.id,
    rounds: battle.round,
    parties,
    captured,
    salvage,
  });
  return true;
}

/** One round of every battle in progress; ends those that are over and removes the fleets that were destroyed. */
export function fightBattles(world: WorldDraft, rules: Rules): void {
  if (world.battles.length === 0) return;
  world.battles = world.battles.filter(
    (battle) => !fightAt(world, battle, rules),
  );
  world.fleets = world.fleets.filter((fleet) => {
    if (shipTotal(fleet.ships) > 0) return true;
    world.events.push({
      type: "fleetLost",
      player: fleet.owner,
      fleet: fleet.id,
    });
    return false;
  });
}
