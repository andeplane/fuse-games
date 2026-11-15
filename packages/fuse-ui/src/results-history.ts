import type { MatchResult } from "fuse-platform";

/** A game-owned immutable outcome, with the log tick at which it became final. */
export interface HistoryReceipt { tick: number; result: MatchResult }
export interface ResultsHistoryOptions {
  fetch: typeof fetch;
  apiUrl(path: string): string;
  gameId: string;
  room?: { code: string; token: string };
  signedIn(): boolean;
  playerId(): string;
  now(): number;
}

/** Shared best-effort transport. Only confirmed participants report; solo needs a verified account. */
export function createResultsHistory(options: ResultsHistoryOptions) {
  const completed = new Set<string>();
  const pending = new Map<string, { body: string; path: string; attempts: number; at: number; sending: boolean }>();
  let disposed = false;
  function finish(key: string) {
    pending.delete(key);
    completed.add(key);
    // A result has at most 99 rounds; enough recent matches survive ordinary rematches without resubmission.
    if (completed.size > 512) completed.delete(completed.values().next().value!);
  }
  return {
    observe(receipts: readonly HistoryReceipt[], confirmedTick: number) {
      if (disposed || (!options.room && !options.signedIn())) return;
      const me = options.playerId();
      if (!me) return;
      for (const { tick, result } of receipts) {
        if (tick > confirmedTick || !result.finishers.includes(me)) continue;
        // A room result reported as a guest must be re-posted once sign-in can link its own seat.
        const key = JSON.stringify([result.matchId, result.round ?? "match", options.signedIn()]);
        if (completed.has(key) || pending.has(key) || pending.size >= 8) continue;
        const path = result.round === undefined ? "results" : "round-results";
        pending.set(key, { body: JSON.stringify({ result }), path, attempts: 0, at: 0, sending: false });
      }
      for (const [key, job] of pending) {
        if (job.sending || options.now() < job.at) continue;
        job.sending = true;
        job.attempts++;
        const scope = options.room ? `rooms/${options.room.code}` : "me";
        void Promise.resolve().then(()=>options.fetch(options.apiUrl(`/api/games/${options.gameId}/${scope}/${job.path}`), {
          method: "POST", keepalive: true,
          headers: { "Content-Type": "application/json", ...(options.room ? { Authorization: `Bearer ${options.room.token}` } : {}) },
          body: job.body,
        })).then(response => {
          const transient=[403,408,429].includes(response.status)||response.status>=500;
          const seconds=Number(response.headers.get("Retry-After"));
          const retryMs=response.headers.has("Retry-After")&&Number.isFinite(seconds)&&seconds>=0?Math.min(60_000,seconds*1000):0;
          return {done:response.ok||!transient,retryMs};
        }, () => ({done:false,retryMs:0})).then(({done,retryMs}) => {
          if (disposed) return;
          if (done || job.attempts >= 3) finish(key);
          else { job.sending = false; job.at = options.now() + Math.max(retryMs,1000 * 2 ** (job.attempts - 1)); }
        });
      }
    },
    dispose() { disposed = true; pending.clear(); completed.clear(); },
  };
}
