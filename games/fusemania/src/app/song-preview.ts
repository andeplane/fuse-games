import type { Library, SongInfo } from "../engine/index.js";

/** Bundled local and external songs may preview; device-loaded blob/data files stay in solo play. */
export function previewSong(
  library: Pick<Library, "song">,
  id: string,
): SongInfo | undefined {
  const song = library.song(id);
  return song && !/^(blob:|data:)/.test(song.audio) ? song : undefined;
}

export interface SongPreviewDeps {
  /** Only bundled songs have a lightweight preview clip. */
  clip(id: string): string | undefined;
  enabled(): boolean;
  fetch(url: string): Promise<ArrayBuffer>;
  objectUrl(bytes: ArrayBuffer): string;
  revoke(url: string): void;
  play(song: SongInfo, url: string): void;
  resume(): void;
  stop(): void;
  schedule(run: () => void, ms: number): () => void;
}

/** One cached, short preview at a time. Superseded fetches may finish caching but never take over the menu. */
export function createSongPreview(
  library: Pick<Library, "song">,
  deps: SongPreviewDeps,
) {
  let shown = "",
    generation = 0;
  let cancel: (() => void) | undefined;
  let currentUrl: string | undefined;
  const pending = new Map<string, Promise<ArrayBuffer>>();
  const release = () => {
    deps.stop();
    if (currentUrl) deps.revoke(currentUrl);
    currentUrl = undefined;
  };
  return {
    show(id: string) {
      if (id === shown) {
        if (currentUrl && !cancel) deps.resume();
        return;
      }
      shown = id;
      const token = ++generation;
      cancel?.();
      cancel = undefined;
      release();
      if (!deps.enabled()) return;
      const song = previewSong(library, id);
      const clip = song && deps.clip(id);
      if (!song || !clip) return;
      cancel = deps.schedule(() => {
        cancel = undefined;
        let request = pending.get(clip);
        if (!request) {
          request = deps.fetch(clip);
          pending.set(clip, request);
          void request
            .finally(() => pending.delete(clip))
            .catch(() => undefined);
        }
        void request
          .then((bytes) => {
            if (token !== generation || !deps.enabled()) return;
            currentUrl = deps.objectUrl(bytes);
            deps.play(song, currentUrl);
          })
          .catch(() => undefined);
      }, 350);
    },
    stop() {
      ++generation;
      shown = "";
      cancel?.();
      cancel = undefined;
      release();
    },
  };
}
