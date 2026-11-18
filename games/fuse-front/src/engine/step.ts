/**
 * One engine step: spell and item timers (`spells.ts`, `shop.ts`), the step's commands (casts take effect here), idle heroes' queued
 * orders (`orders.ts`), the heroes' energy and respawns (`hero.ts`), goals (`move.ts`), combat (`combat.ts`), focused
 * heroes' chase (`focus.ts`), movement of units then heroes, STICKY MINEs (`spells.ts`), capture, and production or a lane map's waves
 * (`waves.ts`). `step` never mutates the world it is given: it copies the arrays and records
 * (players, sectors, buildings, units, heroes, mines) and returns a new world, so the netcode can keep the previous
 * one as a snapshot. Once the match has a winner a step only advances the clock. Bots (`bot.ts`) send ordinary
 * commands.
 */
import { applyCommands, type Command } from "./commands.js";
import { chase } from "./focus.js";
import { advanceOrders } from "./orders.js";
import { fight } from "./combat.js";
import { OVERCLOCK_PERCENT, tickMines, tickSpells } from "./spells.js";
import { alive, gainXp, moveHeroes, tendHeroes } from "./hero.js";
import { flagAt, type GameMap } from "./map.js";
import { div } from "./math.js";
import { centreOf, chooseGoals, moveUnits, tileOf } from "./move.js";
import { laneMap, spawnWaves } from "./waves.js";
import { guarded, tendCamps } from "./jungle.js";
import { earn } from "./gold.js";
import { tickItems } from "./shop.js";
import {
  CAPTURE_XP,
  GOLD,
  OVERTIME_AFTER,
  OVERTIME_GROWTH,
  OVERTIME_MAX,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  TILE,
  UNITS,
  clockRate,
  teamOf,
} from "./tuning.js";
import {
  NEUTRAL,
  NO_WINNER,
  defaultOrder,
  ownerOf,
  teamSectors,
  unitCap,
  type CombatEvent,
  type World,
} from "./world.js";

export type { Command } from "./commands.js";

export function step(
  map: GameMap,
  world: World,
  commands: readonly Command[] = [],
): World {
  if (world.winner !== NO_WINNER)
    return { ...world, step: world.step + 1, events: [] };
  const next: World = {
    ...world,
    step: world.step + 1,
    players: world.players.map((player) => ({ ...player })),
    sectors: [...world.sectors],
    buildings: world.buildings.map((building) => ({ ...building })),
    units: world.units.map((unit) => ({ ...unit })),
    heroes: world.heroes.map((hero) => ({ ...hero, spells: [...hero.spells] })),
    mines: world.mines.map((mine) => ({ ...mine })),
    fortified: [...world.fortified],
    overclock: [...world.overclock],
    camps: [...world.camps],
    events: [],
  };
  tickSpells(map, next);
  tickItems(next);
  applyCommands(map, next, commands);
  advanceOrders(map, next);
  tendHeroes(map, next);
  chooseGoals(map, next);
  const { engaged, heroes } = fight(map, next);
  chase(map, next);
  moveUnits(map, next, engaged);
  const holding = new Set(
    next.heroes
      .filter((hero) => hero.sweep > 0 && heroes.has(hero.seat))
      .map((hero) => hero.seat),
  );
  moveHeroes(map, next, holding);
  tickMines(map, next);
  capture(map, next);
  // A lane map's army is its waves; any other map's is what its factories build.
  if (laneMap(map)) {
    spawnWaves(map, next);
    tendCamps(map, next);
  } else produce(map, next);
  return next;
}

/** One 50 ms log tick: the tick's commands apply at its first step, and its events are its steps' in order. */
export function stepTick(
  map: GameMap,
  world: World,
  commands: readonly Command[] = [],
): World {
  let next = world;
  const events: CombatEvent[] = [];
  for (let index = 0; index < STEPS_PER_TICK; index++) {
    next = step(map, next, index === 0 ? commands : []);
    events.push(...next.events);
  }
  return { ...next, events };
}

/**
 * A robot or living hero standing on a flag takes its sector for its owner, whose hero earns `CAPTURE_XP`. A flag
 * both teams stand on stays as it is, and a team never takes a flag from itself; when one team stands on another's
 * flag, the lowest-id robot takes it, or the lowest-seat hero when no robot of that team is there. The taker's hero also
 * earns `GOLD.capture`.
 * A captured factory starts its default order from scratch, and a captured turret starts loaded.
 */
function capture(map: GameMap, world: World): void {
  const taker = new Map<number, number>();
  const contested = new Set<number>();
  /** Flags a CLOAKed hero is the taker of: their capture raises no alert. */
  const quiet = new Set<number>();
  const stand = (seat: number, x: number, y: number, cloaked = false) => {
    const flag = flagAt(map, tileOf(x), tileOf(y));
    if (flag < 0) return;
    const first = taker.get(flag);
    if (first === undefined) taker.set(flag, seat);
    else if (teamOf(first) !== teamOf(seat)) contested.add(flag);
    if (first === undefined && cloaked) quiet.add(flag);
  };
  for (const unit of world.units)
    if (UNITS[unit.kind].robot) stand(unit.owner, unit.x, unit.y);
  for (const hero of world.heroes)
    if (alive(hero)) stand(hero.seat, hero.x, hero.y, hero.cloak > 0);
  for (const [flag, seat] of taker) {
    // A FORTIFIED flag cannot change hands (`spells.ts`), nor on a lane map a home flag or a guarded jungle one.
    if (contested.has(flag) || world.fortified[flag]! > 0) continue;
    if (laneMap(map) && map.sectorKinds[flag] !== "jungle") continue;
    if (guarded(map, world, flag)) continue;
    const owner = world.sectors[flag]!;
    if (owner !== NEUTRAL && teamOf(owner) === teamOf(seat)) continue;
    world.sectors[flag] = seat;
    if (!quiet.has(flag))
      world.events.push({ type: "capture", sector: flag, seat });
    const hero = world.heroes.find((each) => each.seat === seat)!;
    gainXp(world, hero, CAPTURE_XP);
    earn(hero, GOLD.capture);
    for (const building of world.buildings) {
      const site = map.sites[building.id]!;
      // A fort and a lane's towers (`towers.ts`) never belong to a sector's holder.
      if (site.sector !== flag || site.kind === "fort" || site.lane >= 0)
        continue;
      building.order = defaultOrder(site.kind);
      building.progress = 0;
      building.cooldown = 0;
    }
  }
}

/**
 * A team's production clock this step (`clockRate`), raised in overtime when it holds more sectors than the other
 * team: `OVERTIME_GROWTH` percent per minute past `OVERTIME_AFTER`, up to `OVERTIME_MAX`.
 */
export function productionRate(world: World, team: number): number {
  const ours = teamSectors(world, team);
  // OVERCLOCK (`spells.ts`) speeds the team's clock while it runs.
  const boost = world.overclock[team]! > 0 ? OVERCLOCK_PERCENT : 100;
  const rate = div(clockRate(ours) * boost, 100);
  const late = world.step - OVERTIME_AFTER;
  if (late <= 0 || ours <= teamSectors(world, 1 - team)) return rate;
  const grown = div(late * OVERTIME_GROWTH, 60 * STEPS_PER_SECOND);
  return div(rate * (100 + (grown < OVERTIME_MAX ? grown : OVERTIME_MAX)), 100);
}

/**
 * Every owned factory works on its order at its team's rate, unless its owner is at its unit cap (`unitCap`). A
 * finished batch steps out at the factory's door (as many of it as the cap allows) and the next starts.
 */
function produce(map: GameMap, world: World): void {
  const units = new Map<number, number>();
  for (const unit of world.units)
    units.set(unit.owner, (units.get(unit.owner) ?? 0) + 1);
  const caps = new Map(
    world.players.map((player) => [player.seat, unitCap(world, player.seat)]),
  );
  const rates = [productionRate(world, 0), productionRate(world, 1)];
  for (const building of world.buildings) {
    if (building.order === null || building.hp <= 0) continue;
    const owner = ownerOf(map, world, building);
    if (owner === NEUTRAL) continue;
    const count = units.get(owner) ?? 0;
    const cap = caps.get(owner)!;
    if (count >= cap) continue;
    const stats = UNITS[building.order];
    building.progress += rates[teamOf(owner)]!;
    if (building.progress < stats.build * 100) continue;
    building.progress = 0;
    const door = map.sites[building.id]!.door;
    const batch = stats.batch < cap - count ? stats.batch : cap - count;
    for (let index = 0; index < batch; index++)
      world.units.push({
        id: world.nextId++,
        kind: building.order,
        owner,
        x: centreOf(door.x) + (2 * index - (batch - 1)) * div(TILE, 8),
        y: centreOf(door.y),
        hp: stats.hp,
        cooldown: 0,
        goal: -1,
        stun: 0,
        rally: 0,
        lane: -1,
        wave: 0,
      });
    units.set(owner, count + batch);
  }
}
