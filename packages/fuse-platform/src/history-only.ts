import { RESERVED_KEYS, type GameRegistration, type PlayerResult } from "./game.js";

import { parseHistoryPlayer } from "./history-api.js";
export { parseHistoryPlayer };

/** Opt-in history only: accepts strict base results and never creates ratings, claims or progression totals. */
export function historyOnlyRegistration(options: Pick<GameRegistration, "id" | "isBot" | "activity" | "activityPlayer">): GameRegistration<PlayerResult, Record<string, never>, undefined> {
  return {
    ...options,
    ratesRounds: false,
    parseStats: parseHistoryPlayer,
    emptyTotals: () => ({}),
    credit: () => undefined,
    addTotals: () => {},
    parseTotals: raw => Object.keys(raw).every(key => RESERVED_KEYS.has(key)) ? {} : undefined,
  };
}
