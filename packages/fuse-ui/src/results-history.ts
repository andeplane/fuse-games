import type { MatchResult } from "fuse-platform";

/** A game-owned immutable outcome, with the log tick at which it became final. */
export interface HistoryReceipt {
  tick: number;
  result: MatchResult;
}
/** Read afresh from the runtime: predictions can change until their log tick is confirmed. */
export interface HistorySnapshot {
  receipts: readonly HistoryReceipt[];
  confirmedTick: number;
}
export interface ResultsHistoryOptions {
  fetch: typeof fetch;
  apiUrl(path: string): string;
  gameId: string;
  room?: { code: string; token: string };
  signedIn(): boolean;
  playerId(): string;
  now(): number;
  schedule?(callback: () => void, ms: number): () => void;
}
interface ConfirmationDrain {
  stop(): void;
  cancel?: () => void;
  check?(): void;
}

/** Shared best-effort transport. Only confirmed participants report; solo needs a verified account. */
export function createResultsHistory(options: ResultsHistoryOptions) {
  const completed = new Set<string>();
  const pending = new Map<
    string,
    {
      body: string;
      path: string;
      attempts: number;
      at: number;
      sending: boolean;
    }
  >();
  let disposed = false;
  let closing: ConfirmationDrain | undefined;
  let closed = false;
  const schedule =
    options.schedule ??
    ((callback: () => void, ms: number) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    });
  const keyOf = (result: MatchResult) =>
    JSON.stringify([
      result.matchId,
      result.round ?? "match",
      options.signedIn(),
    ]);
  const eligible = (result: MatchResult) =>
    (options.room || options.signedIn()) &&
    !!options.playerId() &&
    result.finishers.includes(options.playerId());
  function dispose() {
    disposed = true;
    pending.clear();
    completed.clear();
    const drain = closing;
    closing = undefined;
    drain?.cancel?.();
    if (drain) {
      closed = true;
      drain.stop();
    }
  }
  function finish(key: string) {
    pending.delete(key);
    completed.add(key);
    // Eight archived matches plus the current match, each with 99 rounds and a summary, can remain in
    // every frame. Preserve both guest and signed-in keys for that entire bounded source (1,800 keys).
    if (completed.size > 2048)
      completed.delete(completed.values().next().value!);
  }
  function observe(receipts: readonly HistoryReceipt[], confirmedTick: number) {
    if (disposed || (!options.room && !options.signedIn())) return;
    const me = options.playerId();
    if (!me) return;
    for (const { tick, result } of receipts) {
      if (tick > confirmedTick || !result.finishers.includes(me)) continue;
      // A room result reported as a guest must be re-posted once sign-in can link its own seat.
      const key = keyOf(result);
      if (completed.has(key) || pending.has(key) || pending.size >= 8) continue;
      const path = result.round === undefined ? "results" : "round-results";
      pending.set(key, {
        body: JSON.stringify({ result }),
        path,
        attempts: 0,
        at: 0,
        sending: false,
      });
    }
    for (const [key, job] of pending) {
      // Leaving gets one keepalive attempt, not a new retry cycle that outlives the screen.
      if (closing && !job.sending && job.attempts > 0) {
        finish(key);
        continue;
      }
      if (job.sending || options.now() < job.at) continue;
      job.sending = true;
      job.attempts++;
      const scope = options.room ? `rooms/${options.room.code}` : "me";
      void Promise.resolve()
        .then(() =>
          options.fetch(
            options.apiUrl(`/api/games/${options.gameId}/${scope}/${job.path}`),
            {
              method: "POST",
              keepalive: true,
              headers: {
                "Content-Type": "application/json",
                ...(options.room
                  ? { Authorization: `Bearer ${options.room.token}` }
                  : {}),
              },
              body: job.body,
            },
          ),
        )
        .then(
          (response) => {
            const transient =
              [403, 408, 429].includes(response.status) ||
              response.status >= 500;
            const seconds = Number(response.headers.get("Retry-After"));
            const retryMs =
              response.headers.has("Retry-After") &&
              Number.isFinite(seconds) &&
              seconds >= 0
                ? Math.min(60_000, seconds * 1000)
                : 0;
            return { done: response.ok || !transient, retryMs };
          },
          () => ({ done: false, retryMs: 0 }),
        )
        .then(({ done, retryMs }) => {
          if (disposed) return;
          if (done || job.attempts >= 3 || closing) finish(key);
          else {
            job.sending = false;
            job.at =
              options.now() + Math.max(retryMs, 1000 * 2 ** (job.attempts - 1));
          }
          closing?.check?.();
        });
    }
  }
  return {
    observe,
    /** Keep the runtime alive briefly on Back; re-read corrected outcomes instead of retaining a prediction. */
    close(read: () => HistorySnapshot, stop: () => void) {
      if (closed || closing) return;
      if (disposed) {
        closed = true;
        stop();
        return;
      }
      const drain: ConfirmationDrain = { stop };
      closing = drain;
      const deadline = options.now() + 3000;
      let polls = 0;
      const poll = () => {
        if (disposed || closing !== drain) return;
        drain.cancel?.();
        drain.cancel = undefined;
        try {
          const { receipts, confirmedTick } = read();
          observe(receipts, confirmedTick);
          const owed = receipts.some(
            ({ tick, result }) =>
              tick > confirmedTick &&
              eligible(result) &&
              !completed.has(keyOf(result)) &&
              !pending.has(keyOf(result)),
          );
          // The signed-in fetch adapter may first await its identity token. Keep the page alive until the
          // first transport attempts settle, so navigation cannot cut them off before HTTP even starts.
          const sending = [...pending.values()].some((job) => job.sending);
          if (
            (!owed && !sending) ||
            options.now() >= deadline ||
            polls++ >= 60
          ) {
            dispose();
            return;
          }
          drain.cancel = schedule(poll, Math.min(50, deadline - options.now()));
        } catch {
          dispose();
        }
      };
      drain.check = poll;
      poll();
    },
    dispose,
  };
}
