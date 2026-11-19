import { keys as roomKeys } from "fuse-ui/room-session";

export {
  type Session,
  type Store,
  safeStore,
  NOT_OPEN,
  roomFailure,
  sessionFor,
} from "fuse-ui/room-session";

export const keys = (gameId: string) => {
  const { name, host, peer } = roomKeys(gameId);
  return {
    name,
    avatar: `${gameId}-player-avatar`,
    /** Set while the host has Shared TV ticked in this room, so the host's reload alone keeps the choice. */
    tvRoom: (code: string) => `${gameId}-tv-${code}`,
    /** The last room this browser was in, for the menu's REJOIN. */
    last: `${gameId}-last-room`,
    /** Which way the menu was last used: "local" (this device) or "online". */
    mode: `${gameId}-menu-mode`,
    host,
    peer,
  };
};
