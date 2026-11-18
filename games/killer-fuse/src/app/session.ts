export {
  type Session,
  type Store,
  safeStore,
  keys,
  NOT_OPEN,
  roomFailure,
  sessionFor,
} from "fuse-ui/room-session";

/** The developer flags a link within the game carries on: a muted preview and a smoke's `?debug` hook. */
const KEPT_FLAGS = ["mute", "debug"] as const;
/**
 * A link within the game, carrying this page's developer flags on. Without them a muted preview plays sound, and a
 * smoke loses `window.__killerFuse`, the moment the page leaves the landing screen. The invite link handed to other
 * people is not one of these: their sound is their own choice, and they get no debug hook.
 */
export const keepFlags = (query: URLSearchParams, path: string): string => {
  const kept = KEPT_FLAGS.filter((flag) => query.has(flag));
  return kept.length === 0
    ? path
    : `${path}${path.includes("?") ? "&" : "?"}${kept.join("&")}`;
};
