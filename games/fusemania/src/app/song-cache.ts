/**
 * The songs' audio files, kept in the browser's cache storage: a song downloaded once is there the next time the
 * page opens, and the page can say which songs it has. The cache is named after the rules version, since a new
 * version may bring new audio under the same address; the caches of other versions are deleted.
 *
 * Everything here is best effort. Where there is no cache storage (an insecure origin, a private window that
 * refuses it) or it fails, the file is fetched as before and nothing is remembered.
 */
export interface SongCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  keys(): Promise<readonly { readonly url: string }[]>;
}
export interface SongCaches {
  open(name: string): Promise<SongCache>;
  keys(): Promise<readonly string[]>;
  delete(name: string): Promise<boolean>;
}
export interface SongStoreDeps {
  /** The browser's `caches`, or undefined where there is none. */
  caches: SongCaches | undefined;
  fetch(url: string): Promise<Response>;
  /** Every cache this game made starts with this; `version` completes the name of the one in use. */
  prefix: string;
  version: string;
  /** The absolute form of an address, as the cache names its entries. */
  absolute(url: string): string;
}
export interface SongStore {
  /** The bytes of an audio file: from the cache, else fetched and put there. Rejects when it cannot be fetched. */
  fetch(url: string): Promise<ArrayBuffer>;
  /** The absolute addresses of the files in the cache. Empty where there is no cache. */
  stored(): Promise<string[]>;
  /** Observe actual transfer bytes for this URL. Unsubscribe when its load settles. */
  subscribe(
    url: string,
    progress: (value: SongTransferProgress) => void,
  ): () => void;
}

export interface SongTransferProgress {
  readonly received: number;
  /** Missing when the server did not report an uncompressed, positive byte length. */
  readonly total?: number;
  readonly complete: boolean;
}

/** An address that is the page's own and lasts: not a file the player loaded. */
const lasting = (url: string) => !/^(blob:|data:)/.test(url);

export function createSongStore(deps: SongStoreDeps): SongStore {
  const name = deps.prefix + deps.version;
  let opened: Promise<SongCache | undefined> | undefined;
  const observers = new Map<
    string,
    Set<(value: SongTransferProgress) => void>
  >();
  const latest = new Map<string, SongTransferProgress>();
  const report = (url: string, value: SongTransferProgress) => {
    if (!observers.has(url)) return;
    latest.set(url, value);
    for (const listener of observers.get(url)!) listener(value);
  };
  const cache = () =>
    (opened ??= (async () => {
      const caches = deps.caches;
      if (!caches) return undefined;
      try {
        for (const other of await caches.keys())
          if (other.startsWith(deps.prefix) && other !== name)
            await caches.delete(other);
        return await caches.open(name);
      } catch {
        return undefined;
      }
    })());
  return {
    subscribe(url, progress) {
      const listeners = observers.get(url) ?? new Set();
      listeners.add(progress);
      observers.set(url, listeners);
      const value = latest.get(url);
      if (value) progress(value);
      let listening = true;
      return () => {
        if (!listening) return;
        listening = false;
        listeners.delete(progress);
        if (listeners.size === 0) {
          observers.delete(url);
          latest.delete(url);
        }
      };
    },
    async fetch(url) {
      const store = lasting(url) ? await cache() : undefined;
      if (store) {
        try {
          const hit = await store.match(url);
          if (hit?.ok) {
            const data = await hit.arrayBuffer();
            report(url, {
              received: data.byteLength,
              total: data.byteLength,
              complete: true,
            });
            return data;
          }
        } catch {
          // A cache that cannot be read is no cache: the file is fetched.
        }
      }
      const response = await deps.fetch(url);
      if (!response.ok) throw new Error(`audio ${response.status}`);
      const copy = store ? response.clone() : undefined;
      const length = response.headers.get("content-length") ?? "";
      const encoding = response.headers.get("content-encoding");
      const size = /^\d+$/.test(length) ? Number(length) : 0;
      let total =
        (!encoding || encoding === "identity") &&
        Number.isSafeInteger(size) &&
        size > 0
          ? size
          : undefined;
      report(url, { received: 0, total, complete: false });
      let data: ArrayBuffer;
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            chunks.push(next.value);
            received += next.value.byteLength;
            if (total !== undefined && received > total) total = undefined;
            report(url, { received, total, complete: false });
          }
        } finally {
          reader.releaseLock();
        }
        const joined = new Uint8Array(received);
        let at = 0;
        for (const chunk of chunks) {
          joined.set(chunk, at);
          at += chunk.byteLength;
        }
        data = joined.buffer;
      } else data = await response.arrayBuffer();
      report(url, {
        received: data.byteLength,
        total: data.byteLength,
        complete: true,
      });
      // Kept only once the whole file arrived; a full disk or a refused write loses nothing but the copy.
      if (store && copy) void store.put(url, copy).catch(() => undefined);
      return data;
    },
    async stored() {
      try {
        const store = await cache();
        return store ? (await store.keys()).map((entry) => entry.url) : [];
      } catch {
        return [];
      }
    },
  };
}
