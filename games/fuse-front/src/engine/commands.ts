import { MAX_ID, isInt } from "./codec.js";
import { openTile } from "./flow.js";
import { dropFocus, enemyAt } from "./focus.js";
import { alive } from "./hero.js";
import { ITEMS, ITEM_SLOTS } from "./items.js";
import type { GameMap } from "./map.js";
import {
  castable,
  clearQueue,
  enqueue,
  startAttack,
  startMove,
} from "./orders.js";
import { buy, sell, useItem } from "./shop.js";
import { cast, type Chosen } from "./spells.js";
import { COMMANDS_PER_SEAT, STEER_MAX, teamOf } from "./tuning.js";
import { MARKS, type Hero, type World } from "./world.js";

/**
 * What a player sends (v3 dropped the factory orders and stances; the army is the waves): a walk for the hero to a
 * tile (`move`, in tiles), or the held stick direction (`steer`, each axis -STEER_MAX..STEER_MAX,
 * (0, 0) releasing it). A move releases the stick and a steer cancels the move, so the latest wins. Both apply to a
 * dead hero too: the stick stays held, and a move made while dead is walked after the respawn. `cast` fires the
 * hero's slot 0–3 (Q, W, E, R) aimed at a tile (`spells.ts`); one that cannot be cast does nothing. `attack` focuses
 * the living hero on an enemy (`MARKS` index and id, `focus.ts`), which a later `move`, `attackMove`, held `steer` or
 * `attack` replaces; `attackMove` is a `move` on which the hero stands to fight whatever comes in range. A `move`,
 * `attackMove`, `attack` or `cast` marked `queued` goes behind the hero's current order instead (`orders.ts`).
 * `buy` an `ITEMS` id, `sell` a slot's item and `useItem` a slot's active aimed at a tile go to the shop
 * (`shop.ts`), which refuses one it may not do.
 */
export type Command =
  | { seat: number; type: "move"; x: number; y: number; queued?: boolean }
  | { seat: number; type: "steer"; dx: number; dy: number }
  | { seat: number; type: "attack"; of: number; id: number; queued?: boolean }
  | {
      seat: number;
      type: "attackMove";
      x: number;
      y: number;
      queued?: boolean;
    }
  | {
      seat: number;
      type: "cast";
      slot: number;
      x: number;
      y: number;
      /** A `unit` spell's chosen target (`MARKS` index and id); without it the spell takes what stands nearest the aim. */
      of?: number;
      id?: number;
      queued?: boolean;
    }
  | { seat: number; type: "buy"; item: number }
  | { seat: number; type: "sell"; slot: number }
  | { seat: number; type: "useItem"; slot: number; x: number; y: number };

type MovementCommand = Extract<Command, { type: "move" | "attackMove" }>;

const insideMap = (map: GameMap, x: number, y: number): boolean =>
  isInt(x, 0, map.width - 1) && isInt(y, 0, map.height - 1);

function move(
  map: GameMap,
  hero: Hero,
  { type, x, y, queued }: MovementCommand,
): void {
  if (!insideMap(map, x, y) || !openTile(map, x, y)) return;
  if (queued) return enqueue(hero, { type, x, y });
  clearQueue(hero);
  startMove(map, hero, x, y, type === "attackMove");
}

function steer(
  hero: Hero,
  { dx, dy }: Extract<Command, { type: "steer" }>,
): void {
  if (!isInt(dx, -STEER_MAX, STEER_MAX) || !isInt(dy, -STEER_MAX, STEER_MAX))
    return;
  // Releasing the stick leaves a move or focus alone. Holding it cancels them.
  if (dx !== 0 || dy !== 0) {
    dropFocus(hero);
    clearQueue(hero);
    [hero.goal, hero.sweep] = [-1, 0];
  }
  [hero.steerX, hero.steerY] = [dx, dy];
}

const validTargetKind = (of: unknown): of is number =>
  isInt(of, 0, MARKS.length - 1);
const validTargetId = (id: unknown): id is number => isInt(id, 0, MAX_ID);

function attack(
  map: GameMap,
  world: World,
  hero: Hero,
  { of, id, queued }: Extract<Command, { type: "attack" }>,
): void {
  if (!alive(hero) || !validTargetKind(of) || !validTargetId(id)) return;
  if (enemyAt(map, world, teamOf(hero.seat), of, id) === undefined) return;
  if (queued) return enqueue(hero, { type: "attack", of, id });
  clearQueue(hero);
  startAttack(hero, of, id);
}

function castOrder(
  map: GameMap,
  world: World,
  hero: Hero,
  { slot, x, y, of, id, queued }: Extract<Command, { type: "cast" }>,
): void {
  if (!isInt(slot, 0, 3) || !insideMap(map, x, y)) return;
  let chosen: Chosen | undefined;
  if (of !== undefined || id !== undefined) {
    // A chosen target is valid only when both parts are present.
    if (!validTargetKind(of) || !validTargetId(id)) return;
    chosen = { of, id };
  }
  if (!queued) {
    cast(map, world, hero, slot, x, y, chosen);
    return;
  }
  // A stored target must be one a checkpoint admits.
  const inPlay = (seat: number) =>
    world.players.some((player) => player.seat === seat);
  if (chosen && !castable(map, world.nextId, inPlay, chosen.of, chosen.id))
    return;
  enqueue(hero, {
    type: "cast",
    slot,
    x,
    y,
    of: chosen?.of ?? -1,
    id: chosen?.id ?? -1,
  });
}

function applyCommand(
  map: GameMap,
  world: World,
  hero: Hero,
  command: Command,
): void {
  switch (command.type) {
    case "move":
    case "attackMove":
      return move(map, hero, command);
    case "steer":
      return steer(hero, command);
    case "attack":
      return attack(map, world, hero, command);
    case "cast":
      return castOrder(map, world, hero, command);
    case "buy":
      if (isInt(command.item, 0, ITEMS.length - 1))
        buy(map, hero, command.item);
      return;
    case "sell":
      if (isInt(command.slot, 0, ITEM_SLOTS - 1)) sell(map, hero, command.slot);
      return;
    case "useItem": {
      const { slot, x, y } = command;
      if (isInt(slot, 0, ITEM_SLOTS - 1) && insideMap(map, x, y))
        useItem(map, world, hero, slot, x, y);
    }
  }
}

/** Apply commands in log order. Every command from a known seat uses its budget, even when stale or malformed. */
export function applyCommands(
  map: GameMap,
  world: World,
  commands: readonly Command[],
): void {
  const used = new Map<number, number>();
  for (const command of commands) {
    const player = world.players.find((each) => each.seat === command.seat);
    if (player === undefined) continue;
    const count = used.get(player.seat) ?? 0;
    if (count >= COMMANDS_PER_SEAT) continue;
    used.set(player.seat, count + 1);
    const hero = world.heroes.find((each) => each.seat === player.seat)!;
    applyCommand(map, world, hero, command);
  }
}
