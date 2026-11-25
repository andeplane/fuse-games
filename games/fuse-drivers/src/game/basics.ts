/**
 * The fuseDrivers game's constants and id rules, with the shared name policy. The room service's registration (`../platform.ts`) reads
 * them without loading the netcode.
 */

export {
  validPlayerName as validName,
  MAX_PLAYER_NAME as MAX_NAME,
} from "fuse-platform/player-name";

/** Laps in a race, and the most a corrupt report may claim. */
export const LAPS = 4;
export const MAX_LAPS = 64;
/** Seats per room: 2–5 players, bots included. */
export const CAPACITY = 5;
/** Watchers hold no grid slot and nothing waits on their stream. */
export const MAX_WATCHERS = 8;
/** Upper bound for receipt round identifiers. Each campaign heat has its own match and round-one receipt. */
export const MAX_ROUNDS = 8;
/** Progress is laps and checkpoints in hundredths, so this is far past anything a legal race reaches. */
export const MAX_PROGRESS_UNITS = 100_000;
/** Bound event counts in historical and current career receipts. */
export const MAX_EVENTS = 1_000;

export const BOT_PREFIX = "bot:";
export const isBotId = (id: string): boolean => /^bot:[0-9]{1,6}$/.test(id);
