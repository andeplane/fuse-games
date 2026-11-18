import { homeOrder } from "./map.js";
import {
  RULES,
  type MapDefinition,
  type Particle,
  type Player,
  type Structure,
} from "./types.js";

const BRAIN_CAPACITY = 128;

interface WeightedDestination {
  readonly cell: number;
  readonly weight: number;
  readonly capacity: number;
  count: number;
}

/** Allocate one particle at a time to the lowest (count + 1) / weight. */
function allocateTargets(
  destinations: readonly WeightedDestination[],
  activeCount: number,
  brain: number,
): Map<number, number> {
  const targets = new Map<number, number>();
  for (let allocated = 0; allocated < activeCount; allocated++) {
    let best: WeightedDestination | undefined;
    // Candidates are in home order. Leave the first candidate in place on a tie.
    for (const destination of destinations) {
      if (destination.count >= destination.capacity) continue;
      if (
        !best ||
        (destination.count + 1) * best.weight <
          (best.count + 1) * destination.weight
      )
        best = destination;
    }
    if (!best) break;
    targets.set(best.cell, ++best.count);
  }
  let overflow = activeCount;
  for (const count of targets.values()) overflow -= count;
  targets.set(brain, (targets.get(brain) ?? 0) + overflow);
  return targets;
}

function reassign(
  active: readonly Particle[],
  targets: ReadonlyMap<number, number>,
): void {
  const assigned = new Map<number, number>();
  for (const particle of active)
    assigned.set(
      particle.destination,
      (assigned.get(particle.destination) ?? 0) + 1,
    );

  // Targets keep the order in which they first received an allocation.
  const shortages = [];
  for (const [cell, count] of targets) {
    const missing = count - (assigned.get(cell) ?? 0);
    if (missing > 0) shortages.push({ cell, missing });
  }
  let next = 0;
  for (const particle of active) {
    const shortage = shortages[next];
    if (!shortage) break;
    const current = particle.destination;
    const count = assigned.get(current)!;
    if (count <= (targets.get(current) ?? 0)) continue;
    assigned.set(current, count - 1);
    assigned.set(shortage.cell, (assigned.get(shortage.cell) ?? 0) + 1);
    particle.destination = shortage.cell;
    if (--shortage.missing === 0) next++;
  }
}

/** Retain existing assignments where possible and redirect surplus in particle order. */
export function balanceParticleDestinations(
  map: MapDefinition,
  player: Player,
  active: readonly Particle[],
  brain: number,
  structures: ReadonlyMap<number, Structure>,
): void {
  const order = homeOrder(map, player.slot);
  const destinations: WeightedDestination[] = [];
  for (const [key, weight] of Object.entries(player.priorities)) {
    const cell = Number(key);
    const structure = structures.get(cell);
    if (!structure?.connected || structure.ownerId !== player.id) continue;
    destinations.push({
      cell,
      weight,
      count: 0,
      capacity: cell === brain ? BRAIN_CAPACITY : RULES.nodeCapacity,
    });
  }
  destinations.sort((a, b) => order(a.cell, b.cell));
  reassign(active, allocateTargets(destinations, active.length, brain));
}
