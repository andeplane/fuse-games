import { isSeed } from "../engine/index.js";

import {
  sessionFor as readRoomSession,
  type Session,
  type Store,
} from "fuse-ui/room-session";

export {
  type Session,
  type Store,
  safeStore,
  keys,
  NOT_OPEN,
  roomFailure,
} from "fuse-ui/room-session";

/** Fuseball treats only `display=1` as Shared TV, matching its analytics. */
export function sessionFor(
  search: string,
  store: Store,
  gameId: string,
  valid: (code: string) => boolean,
  secret: () => string,
): Session {
  return readRoomSession(search, store, gameId, valid, secret, "one");
}

/** Decimal text only: no coercion of empty strings, exponents, signs, fractions or hex. */
export function seedFromText(raw: string | null): number | undefined {
  if (raw === null || !/^\d{1,10}$/.test(raw)) return;
  const value = Number(raw);
  return isSeed(value) ? value : undefined;
}
