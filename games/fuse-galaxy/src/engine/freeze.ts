/**
 * Freezing: the engine hands out its rules and its worlds frozen all the way down, so nothing that is given a world
 * or a view of one can change the match from outside a tick. A write to one throws.
 */
import type { World, WorldDraft } from "./world.js";

/**
 * Freezes a value and everything it holds. Whatever is already frozen is taken to be frozen all the way down, so
 * parts shared with a value frozen before are skipped.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Freezes the world a tick has finished building. It does what `deepFreeze` does, by name: a tick runs thousands of
 * times a second and walking a world it knows the shape of costs a fraction of discovering that shape each time.
 * `tests/determinism.test.ts` checks that no part of a world is left out.
 */
export function freezeWorld(world: WorldDraft): World {
  for (const planet of world.planets) {
    Object.freeze(planet.resources);
    Object.freeze(planet.asteroids);
    Object.freeze(planet.structures);
    Object.freeze(planet.research);
    for (const job of planet.construction) Object.freeze(job);
    Object.freeze(planet.construction);
    for (const job of planet.researchQueue) Object.freeze(job);
    Object.freeze(planet.researchQueue);
    for (const order of planet.production) Object.freeze(order);
    Object.freeze(planet.production);
    Object.freeze(planet.ships);
    Object.freeze(planet.formation);
    Object.freeze(planet.parts);
    Object.freeze(planet);
  }
  Object.freeze(world.planets);
  for (const fleet of world.fleets) {
    Object.freeze(fleet.ships);
    Object.freeze(fleet.formation);
    Object.freeze(fleet);
  }
  Object.freeze(world.fleets);
  for (const battle of world.battles) {
    for (const wounds of battle.wounds) {
      Object.freeze(wounds.damage);
      Object.freeze(wounds);
    }
    Object.freeze(battle.wounds);
    Object.freeze(battle.wreck);
    Object.freeze(battle);
  }
  Object.freeze(world.battles);
  for (const team of world.teams) {
    Object.freeze(team.members);
    Object.freeze(team.fund);
    Object.freeze(team.votes);
    Object.freeze(team);
  }
  Object.freeze(world.teams);
  // Reports, events and the result are few and of several shapes; the ones kept from the tick before are skipped.
  deepFreeze(world.knowledge);
  deepFreeze(world.events);
  deepFreeze(world.result);
  return Object.freeze(world);
}
