import { createResultsHistory, type ResultsHistoryOptions } from "fuse-ui/results-history";
import { craftResults } from "../online/result.js";
import type { NeuralSession, OnlineSession } from "./contracts.js";

/** Subscribe to detached confirmed outcomes, retaining the session's own controls and lifecycle. */
export function observeCraftHistory<T extends NeuralSession>(session: T, options: ResultsHistoryOptions): T {
  const history = createResultsHistory(options);
  const online = "confirmedView" in session ? session as T & OnlineSession : undefined;
  const update = () => {
    const confirmed = online?.confirmedView();
    const local = session.confirmedResult?.();
    const world = confirmed ?? local?.world;
    const decided = confirmed?.decided ?? local?.decided ?? null;
    if (world) history.observe(craftResults(world, decided), decided?.tick ?? 0);
  };
  const stop = session.subscribe(update);
  update();
  return {
    ...session,
    get localPlayerId() { return session.localPlayerId; },
    get canControl() { return session.canControl; },
    dispose() { stop(); history.dispose(); session.dispose(); },
  };
}
