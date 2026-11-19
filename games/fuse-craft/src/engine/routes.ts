import { homeOrder, neighbors } from "./map.js";
import type { Player, Structure, World } from "./types.js";

export type CellIndex = ReadonlyMap<number, Structure>;

/** Structures by cell. Rebuild after adding, removing or moving a structure. */
export const cellIndex = (world: World): CellIndex =>
  new Map(world.structures.map((structure) => [structure.cell, structure]));

export function brainIndex(
  structures: readonly Structure[],
): ReadonlyMap<string, Structure> {
  const brains = new Map<string, Structure>();
  for (const structure of structures)
    if (structure.kind === "brain" && !brains.has(structure.ownerId))
      brains.set(structure.ownerId, structure);
  return brains;
}

/** Derive connectivity without reading or changing current connected flags. */
export function connectedStructures(
  world: Pick<World, "map" | "players">,
  index: CellIndex,
  brains: ReadonlyMap<string, Structure>,
): ReadonlySet<Structure> {
  const connected = new Set<Structure>();
  for (const { id } of world.players) {
    const brain = brains.get(id);
    if (!brain) continue;
    const queue = [brain];
    connected.add(brain);
    for (const structure of queue)
      for (const neighbor of neighbors(world.map, structure.cell)) {
        const next = index.get(neighbor);
        if (next?.ownerId !== id || connected.has(next)) continue;
        connected.add(next);
        queue.push(next);
      }
  }
  return connected;
}

export interface Route {
  next: number;
  distance: number;
}

/** Find the first hop and distance to each requested cell through the player's connected network. */
export function findRoutes(
  map: World["map"],
  player: Player,
  index: CellIndex,
  from: number,
  targets: readonly number[],
): ReadonlyMap<number, Route> {
  const belongs = (cell: number): boolean => {
    const structure = index.get(cell);
    return structure?.connected === true && structure.ownerId === player.id;
  };
  const routes = new Map<number, Route>();
  if (!belongs(from)) return routes;
  const pending = new Set(targets.filter(belongs));
  const order = homeOrder(map, player.slot);
  const queue = [{ cell: from, next: from, distance: 0 }];
  const seen = new Set([from]);
  for (const { cell, next, distance } of queue) {
    if (pending.delete(cell)) routes.set(cell, { next, distance });
    if (pending.size === 0) break;
    for (const neighbor of neighbors(map, cell).sort(order)) {
      if (seen.has(neighbor) || !belongs(neighbor)) continue;
      seen.add(neighbor);
      queue.push({
        cell: neighbor,
        next: distance === 0 ? neighbor : next,
        distance: distance + 1,
      });
    }
  }
  return routes;
}
