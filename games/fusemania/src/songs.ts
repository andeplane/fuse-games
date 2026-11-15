import { createLibrary, type Library } from "./engine/index.js";
import { SONGS_DATA } from "./engine/songs-data.js";

/**
 * The songs every copy ships with: the Fuse soundtrack's generated charts and imported packs' original charts. A room is played
 * on this library on every device, which is what the engine's `RULES` vouches for.
 */
export const LIBRARY: Library = createLibrary(SONGS_DATA);
export { SONGS_DATA };
