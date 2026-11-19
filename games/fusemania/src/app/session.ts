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
  /** The song, chart and mode this device last chose, and its best rating on a chart. */
  song: `${gameId}-song`,
  chart: `${gameId}-chart`,
  mode: `${gameId}-mode`,
  /** The session a host last set: how many songs, and "random" or "host" for who chooses them. */
  songs: `${gameId}-session-songs`,
  order: `${gameId}-session-order`,
  best: (song: string, chart: string) => `${gameId}-best-${song}-${chart}`,
});

export const NOT_OPEN = SOLO_NOT_OPEN;
export const roomFailure = (message: string): string =>
  describeRoomFailure(message, { unavailable: NOT_OPEN });

/** This device's best rating on a chart, or nothing when there is none (or the stored value is not one). */
export function bestRating(store: Store, key: string): number | undefined {
  const value = Number(store.getItem(key) ?? NaN);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Keeps best ratings. `settle` is called every frame a match is over with the match, the chart's storage key and
 * this device's rating: the first call for a match reads the best there was and stores the new one if it is better;
 * every call answers with the best as it stood before this match, so the page can say "new best" for as long as the
 * result is up.
 */
export function createBests(store: Store): {
  settle(matchId: string, key: string, rating: number): number | undefined;
} {
  let settled = "",
    before: number | undefined;
  return {
    settle(matchId, key, rating) {
      if (matchId !== settled) {
        settled = matchId;
        before = bestRating(store, key);
        if (rating > 0 && (before === undefined || rating > before))
          store.setItem(key, String(rating));
      }
      return before;
    },
  };
}
