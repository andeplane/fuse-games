/**
 * Fusemania's constants and id rules, with the shared name policy. The room service's registration (`platform.ts`) reads them
 * without loading the engine or the netcode. `CAPACITY` repeats the engine's, which may not import from outside its
 * folder; `tests/engine.test.ts` holds them in step.
 */

export {
  validPlayerName as validName,
  MAX_PLAYER_NAME as MAX_NAME,
} from "fuse-platform/player-name";

export const GAME_ID = "fusemania";
/** Players per room. */
export const CAPACITY = 5;
/** What a rating is out of; a doubled stretch can take a battle's past it, up to twice. */
export const FULL_RATING = 1_000_000;
export const MOST_RATING = FULL_RATING * 2;
/** The most notes a chart can have, and so the most of any judgment a result reports. */
export const MOST_NOTES = 20_000;

export const BOT_PREFIX = "bot:";
export const isBotId = (id: string): boolean => /^bot:[0-9]{1,6}$/.test(id);
