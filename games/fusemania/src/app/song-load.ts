import type { ClockedSong } from "fuse-ui/game-audio";
import type { SongTransferProgress } from "./song-cache.js";

/**
 * Which songs this device has the audio of. A song is played from a decoded copy, and a match must not begin on a
 * device that is still getting it: the room holds a started song until every device says it is done (`settled`),
 * and the song select marks the songs that are not downloaded yet (`status`).
 *
 * One song is kept decoded at a time, the one asked for last (decoded audio is tens of megabytes); which songs
 * have been downloaded is remembered for all of them, since their bytes stay in the browser's storage.
 */
export type SongAudio = "none" | "loading" | "ready" | "failed";
export interface SongLoadProgress {
  readonly phase: "downloading" | "decoding" | "retrying";
  readonly received: number;
  readonly total?: number;
}

/** How often a song's audio is fetched again by itself before the page asks the player. */
export const SONG_LOAD_TRIES = 3;
/** How long after a failed fetch the next one waits. */
export const SONG_RETRY_MS = 5000;

export interface SongLoaderDeps {
  /** `performance.now()`. */
  now(): number;
  /** Where a song's audio is, or undefined for a song the library does not have. */
  url(id: string): string | undefined;
  /** Fetches and decodes; undefined (or a rejection) when it could not. */
  load(
    url: string,
    progress: (value: SongTransferProgress) => void,
  ): Promise<ClockedSong | undefined>;
  /** False where the page plays no songs at all (`?mute`): nothing is fetched and nothing is waited for. */
  enabled(): boolean;
  /** Whether the page has an audio clock. Without one a song cannot be decoded, which is not the file's fault. */
  hasClock(): boolean;
  /** A song that needs no download (a file the player loaded). */
  local?(id: string): boolean;
  /** Something `status` reports has changed. */
  changed?(): void;
}
export interface SongLoader {
  /** The decoded song, asking for it when it is not there yet. Makes `id` the one song kept decoded. */
  song(id: string): ClockedSong | undefined;
  /** What the song select shows for a song. */
  status(id: string): SongAudio;
  /**
   * Whether this device is done getting `id`: it has the audio, or it will not get any (a muted page, no audio
   * clock, a file that failed `SONG_LOAD_TRIES` times). False while a fetch can still bring it.
   */
  settled(id: string): boolean;
  /** How often the fetch of the song kept decoded has failed. */
  failures(): number;
  /** The player asked for a failed song again. */
  retry(): void;
  /** These songs were downloaded before this page opened (their bytes are stored). */
  stored(ids: Iterable<string>): void;
  /** Only the currently requested song's unfinished load, never a stale song's transfer. */
  progress(id: string): SongLoadProgress | undefined;
}

export function createSongLoader(deps: SongLoaderDeps): SongLoader {
  const downloaded = new Set<string>();
  let current:
    | {
        id: string;
        song?: ClockedSong;
        loading: boolean;
        retryAt: number;
        failures: number;
        /** A fetch came back with nothing while the page had no audio clock. */
        unheard: boolean;
        progress?: SongLoadProgress;
        attempt: number;
      }
    | undefined;
  const changed = () => deps.changed?.();
  return {
    song(id) {
      if (current?.id !== id) {
        current = {
          id,
          loading: false,
          retryAt: 0,
          failures: 0,
          unheard: false,
          attempt: 0,
        };
        changed();
      }
      const mine = current;
      if (
        !mine.song &&
        !mine.loading &&
        deps.now() >= mine.retryAt &&
        mine.failures < SONG_LOAD_TRIES &&
        deps.enabled()
      ) {
        const url = deps.url(id);
        mine.loading = true;
        const attempt = ++mine.attempt;
        mine.progress = { phase: "downloading", received: 0 };
        changed();
        void (
          url
            ? deps.load(url, (value) => {
                if (
                  current !== mine ||
                  !mine.loading ||
                  mine.attempt !== attempt
                )
                  return;
                mine.progress = {
                  received: value.received,
                  total: value.total,
                  phase: value.complete ? "decoding" : "downloading",
                };
                changed();
              })
            : Promise.resolve(undefined)
        )
          .catch(() => undefined)
          .then((song) => {
            mine.loading = false;
            mine.progress = undefined;
            mine.unheard = false;
            if (song) {
              mine.song = song;
              downloaded.add(id);
            }
            // No clock yet (no gesture) is not a failure of the file: ask again without counting it.
            else if (deps.hasClock()) mine.failures++;
            else mine.unheard = true;
            mine.retryAt = deps.now() + (song ? 0 : SONG_RETRY_MS);
            changed();
          });
      }
      return mine.song;
    },
    status(id) {
      if (!deps.enabled() || deps.local?.(id)) return "ready";
      if (current?.id === id) {
        if (current.song) return "ready";
        if (current.failures >= SONG_LOAD_TRIES) return "failed";
        if (!downloaded.has(id) && (current.loading || current.failures > 0))
          return "loading";
      }
      return downloaded.has(id) ? "ready" : "none";
    },
    settled(id) {
      if (!deps.enabled()) return true;
      if (current?.id !== id) return false;
      return (
        current.song !== undefined ||
        current.failures >= SONG_LOAD_TRIES ||
        (current.unheard && !current.loading)
      );
    },
    failures: () => current?.failures ?? 0,
    progress(id) {
      if (
        !deps.enabled() ||
        deps.local?.(id) ||
        current?.id !== id ||
        current.song ||
        current.failures >= SONG_LOAD_TRIES
      )
        return undefined;
      return (
        current.progress ??
        (current.failures > 0 ? { phase: "retrying", received: 0 } : undefined)
      );
    },
    retry() {
      if (!current) return;
      current.failures = current.retryAt = 0;
      changed();
    },
    stored(ids) {
      for (const id of ids) downloaded.add(id);
      changed();
    },
  };
}
