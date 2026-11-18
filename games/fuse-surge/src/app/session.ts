import {
  DEFAULT_SETTINGS,
  SWITCHES,
  parseSettings,
  type Settings,
} from "../online/game.js";

export {
  type Session,
  type Store,
  safeStore,
  keys,
  NOT_OPEN,
  roomFailure,
  sessionFor,
} from "fuse-ui/room-session";

/** The match settings a link may carry as numbers; the way to try values the lobby's buttons do not offer. */
const SETTING_PARAMS = ["hits", "seconds", "pace", "target", "bot"] as const;
/** The ones a link carries as 0 or 1. */
const SWITCH_PARAMS = ["recover", ...SWITCHES] as const;

/**
 * The settings a page starts with: what this browser last chose (`saved`, as `settingsToSave` wrote it), with
 * anything the link asks for on top. Whatever does not parse is dropped, one field at a time, so a bad link or a
 * stale store never keeps a match from starting. Whether the room is a shared screen is never read from here.
 */
export function settingsFrom(search: string, saved: string | null): Settings {
  let stored: unknown;
  try {
    stored = JSON.parse(saved ?? "null");
  } catch {
    stored = null;
  }
  let settings: Settings = {
    ...(parseSettings(stored) ?? DEFAULT_SETTINGS),
    display: false,
  };
  const query = new URLSearchParams(search);
  for (const key of SETTING_PARAMS) {
    const raw = query.get(key);
    if (raw === null || raw.trim() === "") continue;
    settings = parseSettings({ ...settings, [key]: Number(raw) }) ?? settings;
  }
  for (const key of SWITCH_PARAMS) {
    const raw = query.get(key);
    if (raw === "0" || raw === "1")
      settings = { ...settings, [key]: raw === "1" };
  }
  return settings;
}
/** What the store keeps of a choice: everything but the shared screen, which belongs to a room, not a browser. */
export const settingsToSave = (settings: Settings): string =>
  JSON.stringify({ ...settings, display: false });
/** The settings as the query a solo link carries them in. */
export const settingsQuery = (settings: Settings): string =>
  [
    ...SETTING_PARAMS.map((key) => `${key}=${settings[key]}`),
    ...SWITCH_PARAMS.map((key) => `${key}=${settings[key] ? 1 : 0}`),
  ].join("&");
