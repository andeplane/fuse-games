import {
  keys as roomKeys,
  SOLO_NOT_OPEN,
  roomFailure as describeRoomFailure,
  type Store,
} from "fuse-ui/room-session";

export {
  type Session,
  type Store,
  safeStore,
  sessionFor,
} from "fuse-ui/room-session";

export const keys = (gameId: string) => ({
  ...roomKeys(gameId),
  /** The level solo last rode, and a level's best solo time in hundredths of a second. */
  level: `${gameId}-level`,
  best: (levelId: string) => `${gameId}-best-${levelId}`,
});

export const NOT_OPEN = SOLO_NOT_OPEN;
export const roomFailure = (message: string): string =>
  describeRoomFailure(message, NOT_OPEN);

/** A level's best solo time in hundredths of a second, or nothing when there is none (or the stored value is not one). */
export function bestTime(store: Store, key: string): number | undefined {
  const value = Number(store.getItem(key) ?? NaN);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Keeps solo best times. `settle` is called every frame a solo race is over with the race's match, the level's
 * storage key and the finishing time (nothing for a race that never reached the flower): the first call for a match
 * reads the best there was and stores the new one if it is better; every call answers with the best as it stood
 * before this race, so the page can say "new best" for as long as the result is up.
 */
export function createBestTimes(store: Store): {
  settle(
    matchId: string,
    key: string,
    time: number | undefined,
  ): number | undefined;
} {
  let settled = "",
    before: number | undefined;
  return {
    settle(matchId, key, time) {
      if (matchId !== settled) {
        settled = matchId;
        before = bestTime(store, key);
        if (
          time !== undefined &&
          time > 0 &&
          (before === undefined || time < before)
        )
          store.setItem(key, String(time));
      }
      return before;
    },
  };
}
