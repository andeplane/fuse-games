import { LEVELS } from "../engine/index.js";
import { bestTime, type Store } from "./session.js";

/** A clear can be earned in any mode. Only an unbroken run of clears unlocks a new starting level. */
export function createProgression(
  store: Store,
  keys: { clear(levelId: string): string; best(levelId: string): string },
) {
  const cleared = new Set<string>();
  let next = 0;
  const advance = () => {
    while (next < LEVELS.length) {
      const { id } = LEVELS[next]!;
      if (
        !cleared.has(id) &&
        store.getItem(keys.clear(id)) !== "1" &&
        bestTime(store, keys.best(id)) === undefined
      )
        break;
      next++;
    }
  };
  advance();

  return {
    get next(): number | undefined {
      return next < LEVELS.length ? next : undefined;
    },
    record(level: number): void {
      const id = LEVELS[level]?.id;
      if (!id || level < next || cleared.has(id)) return;
      cleared.add(id);
      store.setItem(keys.clear(id), "1");
      advance();
    },
  };
}
