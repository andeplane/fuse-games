/**
 * Elasto Fuse's constants and id rules, with the shared name policy. The room service's registration (`platform.ts`) reads them
 * without loading the engine or the netcode. `CAPACITY` and `LEVEL_COUNT` repeat the engine's, which may not import
 * from outside its folder; `tests/engine.test.ts` holds them in step.
 */

export {
  validPlayerName as validName,
  MAX_PLAYER_NAME as MAX_NAME,
} from "fuse-platform/player-name";

export const GAME_ID = "elasto-fuse";
/** Riders per room. */
export const CAPACITY = 5;
/** Levels in the tour. */
export const LEVEL_COUNT = 557;
/** Points for finishing a level first, second and so on; a rider that never reaches the flower gets none. */
export const PLACE_POINTS = [10, 7, 5, 3, 2] as const;
/** The most points one match can give a rider: first on every level. */
export const MOST_POINTS = PLACE_POINTS[0] * LEVEL_COUNT;
/** The most crashes and restarts one match reports for a rider; the result stops counting here. */
export const MOST_DEATHS = 5000;

export const BOT_PREFIX = "bot:";
export const isBotId = (id: string): boolean => /^bot:[0-9]{1,6}$/.test(id);
