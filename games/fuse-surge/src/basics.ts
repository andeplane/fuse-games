/**
 * Fuse Surge's constants and id rules, with the shared name policy. The room service's registration (`platform.ts`) reads them
 * without loading the engine or the netcode. `CAPACITY` and the bounds repeat the engine's (`engine/tuning.ts`),
 * which may not import from outside its folder; `tests/engine.test.ts` holds the two in step.
 */

export {
  validPlayerName as validName,
  MAX_PLAYER_NAME as MAX_NAME,
} from "fuse-platform/player-name";

export const GAME_ID = "fuse-surge";
/** Seats per room, bots included: one lane each on the deck. */
export const CAPACITY = 5;
export const MIN_RIDERS = 2;
/** The most round wins a match can be played to, and so the most any rider reports. */
export const MAX_TARGET = 5;
/** The most surges one match reports dodged, and the most hits taken; the result stops counting there. */
export const MOST_DODGES = 20000;
export const MOST_TAKEN = 5000;

export const BOT_PREFIX = "bot:";
export const isBotId = (id: string): boolean => /^bot:[0-9]{1,6}$/.test(id);
