import { better } from "./focus.js";
import type { GameMap } from "./map.js";
import { spatialGrid } from "./spatial-grid.js";
import { HERO, TILE } from "./tuning.js";
import { MARKS, type Mark } from "./world.js";

/** Each target's position and eligibility are frozen before any shooter fires. */
export interface Target extends Mark {
  team: number;
  owner: number;
  /** Index into the corresponding world array. */
  index: number;
  taken: number;
  killer: number;
  striker: number;
  hidden?: boolean;
}

const CELL = 4 * TILE;
const distanceSquared = (from: Target, to: Target): number => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx * dx + dy * dy;
};

function markIndex(targets: readonly Target[]) {
  const byKind = {
    unit: new Map<number, Target | Target[]>(),
    hero: new Map<number, Target | Target[]>(),
    building: new Map<number, Target | Target[]>(),
  };
  for (const target of targets) {
    const group = byKind[target.of];
    const previous = group.get(target.id);
    if (Array.isArray(previous)) previous.push(target);
    else group.set(target.id, previous ? [previous, target] : target);
  }
  return byKind;
}

export function indexCombatTargets(map: GameMap, targets: readonly Target[]) {
  const nearby = spatialGrid(map, targets, CELL, (target) => target);
  let byKind: ReturnType<typeof markIndex> | undefined;

  /** Targets currently in range, choosing a unit before a hero for a tower. */
  function nearest(
    from: Target,
    range: number,
    accept: (target: Target) => boolean,
    unitFirst = false,
  ): Target | undefined {
    const limit = range * range;
    let best: Target | undefined;
    let bestDistance = 0;
    let bestPriority = 0;
    nearby(from, range, (target) => {
      if (target.team === from.team || target.hidden || !accept(target)) return;
      const distance = distanceSquared(from, target);
      if (distance > limit) return;
      const priority = unitFirst && target.of === "unit" ? 1 : 0;
      if (
        best &&
        (priority < bestPriority ||
          (priority === bestPriority &&
            !better(target, distance, best, bestDistance)))
      )
        return;
      best = target;
      bestDistance = distance;
      bestPriority = priority;
    });
    return best;
  }

  /** Keep the first eligible occurrence, including for direct engine callers with repeated IDs. */
  function held(
    from: Target,
    reference: { of: number; id: number },
    range: number,
  ): Target | undefined {
    const kind = MARKS[reference.of];
    if (!kind) return;
    const group = (byKind ??= markIndex(targets))[kind].get(reference.id);
    const eligible = (target: Target) =>
      target.team !== from.team &&
      !target.hidden &&
      distanceSquared(from, target) <= range * range;
    if (Array.isArray(group)) return group.find(eligible);
    if (group && eligible(group)) return group;
  }

  /** Splash uses camp affiliation and applies damage in the original unit order. */
  function splash(victim: Target, from: Target): Target[] {
    const matches: Target[] = [];
    nearby(victim, HERO.splash, (target) => {
      if (
        target.of !== "unit" ||
        target === victim ||
        target.team === from.team
      )
        return;
      if (target.team < 0 !== victim.team < 0) return;
      if (distanceSquared(victim, target) <= HERO.splash * HERO.splash)
        matches.push(target);
    });
    return matches.sort((a, b) => a.index - b.index);
  }

  return { nearest, held, splash };
}
