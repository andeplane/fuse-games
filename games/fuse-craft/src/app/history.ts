import { createResultsHistory, type ResultsHistoryOptions } from "fuse-ui/results-history";
import type { NeuralSession, OnlineSession } from "./contracts.js";

/** Subscribe to detached confirmed outcomes, retaining the session's own controls and lifecycle. */
export function observeCraftHistory<T extends NeuralSession>(session: T, options: ResultsHistoryOptions): T {
  const history = createResultsHistory(options);
  const online = "confirmedView" in session ? session as T & OnlineSession : undefined;
  const update = () => {
    const confirmed = online?.confirmedView();
    const local = session.confirmedResult?.();
    const world = confirmed ?? local?.world;
    const receipts = confirmed?.history ?? local?.history ?? [];
    // The source only exposes this retained array through detached confirmed frames.
    if (world) history.observe(receipts, confirmed?.logTick ?? local?.logTick ?? 0);
  };
  const stop = session.subscribe(update);
  update();
  return {
    ...session,
    get localPlayerId() { return session.localPlayerId; },
    get canControl() { return session.canControl; },
    dispose() {
      stop();
      history.close(() => session.historySnapshot?.() ?? { receipts: [], confirmedTick: -1 }, () => session.dispose());
    },
  };
}
