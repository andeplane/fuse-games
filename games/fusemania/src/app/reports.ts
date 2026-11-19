import type { MatchReceipt } from "fuse-ui/receipt-reporting";
import { isBotId } from "../basics.js";
import type { Library } from "../engine/index.js";
import type { Room } from "../online/game.js";
import {
  historyReceipts,
  type FusemaniaPlayerResult,
} from "../online/result.js";

/** One result this device owes the room service: the match as a rating receipt, or as the whole match. */
export type DueReport = MatchReceipt<FusemaniaPlayerResult>;

/**
 * The reports this device should send now. Every player still seated at the end reports what its own replica
 * computed, and the service keeps a result once enough of them agree, so only confirmed history goes in: nothing is
 * due until the caller's closed snapshot proof (`runtime.confirmedFrame()?.logTick`) reaches its deciding tick.
 * Frozen recent receipts survive immediate lobby/rematch transitions while that proof catches up.
 * Each song owes a numbered rating receipt under its session's parent id;
 * the final song also owes the aggregate match, which credits career totals once. A single song owes both.
 * A device that did not finish the song (the shared
 * screen, a watcher, a player who left, a bot id) owes nothing; `sent` holds the keys already sent.
 */
export function dueReports(
  library: Library,
  room: Room,
  me: string,
  closedTick: number,
  sent: ReadonlySet<string>,
): DueReport[] {
  if (!me || isBotId(me)) return [];
  const due: DueReport[] = [];
  for (const { tick, result } of historyReceipts(library, room)) {
    if (tick > closedTick || !result.finishers.includes(me)) continue;
    const key = `${result.matchId}:${result.round ?? "match"}`;
    if (!sent.has(key))
      due.push({
        key,
        path: result.round === undefined ? "results" : "round-results",
        result,
      });
  }
  return due;
}
