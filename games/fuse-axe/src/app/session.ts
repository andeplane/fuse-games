import {
  keys as roomKeys,
  SOLO_NOT_OPEN,
  roomFailure as describeRoomFailure,
} from "fuse-ui/room-session";

export {
  type Session,
  type Store,
  safeStore,
  sessionFor,
} from "fuse-ui/room-session";

export const keys = (gameId: string) => ({
  ...roomKeys(gameId),
  /** The hero this browser last picked, offered with its next join; the screen still shows the seat's own. */
  hero: `${gameId}-hero`,
  /** The header's MUSIC and EFFECTS choices: "0" off, otherwise on. */
  music: `${gameId}-music`,
  effects: `${gameId}-effects`,
});

export const NOT_OPEN = SOLO_NOT_OPEN;
export const roomFailure = (message: string): string =>
  describeRoomFailure(message, { unavailable: NOT_OPEN });
