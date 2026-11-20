/**
 * Killer Fuse's room constants and id rules, with the shared name policy. The room service's registration (`../platform.ts`)
 * reads them without loading the netcode or the engine.
 */

export {
  validPlayerName as validName,
  MAX_PLAYER_NAME as MAX_NAME,
} from "fuse-platform/player-name";

/** Seats per room: two teams of three. Even slots are Cyan, odd slots Pink; slots 0 and 1 are the Queens. */
export const CAPACITY = 6;
export const TEAMS = 2;
/** The most games one team must win to take the set. */
export const MAX_WINS = 3;
/** The most games a set plays: every game has a winner, so one team has `MAX_WINS` by then. */
export const MAX_GAMES = 2 * MAX_WINS - 1;
/** A bound on what one player can count up in one set; far past anything a real set reaches. */
export const MAX_COUNT = 100_000;

export const teamOfSlot = (slot: number): number => slot % TEAMS;

/** A bot is the seat it fills: `bot:0` to `bot:5`. Bots hold no room seat; the id only names one in a result. */
export const BOT_PREFIX = "bot:";
export const isBotId = (id: string): boolean => /^bot:[0-5]$/.test(id);
