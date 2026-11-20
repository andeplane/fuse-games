/**
 * The dice game's constants and id rules, with the shared name policy. The room service's registration (`../platform.ts`) reads
 * them without loading the netcode.
 */

export {
  validPlayerName as validName,
  MAX_PLAYER_NAME as MAX_NAME,
} from "fuse-platform/player-name";

export const TARGET = 50;
export const WINS_NEEDED = 2;
/** Seats per room: 2–5 players, bots included. */
export const CAPACITY = 5;
/**
 * The most rounds a match plays. With a fixed roster someone reaches `WINS_NEEDED` by then (every seat but one wins
 * `WINS_NEEDED - 1`, then the deciding round); with seats coming and going it could run on, so the round that reaches
 * this bound ends the match, won by the leader (`leader` in the rules).
 */
export const MAX_ROUNDS = CAPACITY * (WINS_NEEDED - 1) + 1;
/** The most one turn or one round's bank can hold; far past anything a legal game reaches. */
export const MAX_POINTS = 10_000;

export const BOT_PREFIX = "bot:";
export const isBotId = (id: string): boolean => /^bot:[0-9]{1,6}$/.test(id);
