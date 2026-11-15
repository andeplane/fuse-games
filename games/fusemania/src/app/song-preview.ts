import type { Library, SongInfo } from "../engine/index.js";

/** Bundled local and external songs may preview; device-loaded blob/data files stay in solo play. */
export function previewSong(library: Pick<Library, "song">, id: string): SongInfo | undefined {
  const song = library.song(id);
  return song && !/^(blob:|data:)/.test(song.audio) ? song : undefined;
}
