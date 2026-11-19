import type { MatchReceipt } from "fuse-ui/receipt-reporting";
import type { CyberfuseRoom } from "../game/index.js";
export type DueReport = MatchReceipt;
export function dueReports(
  room: CyberfuseRoom,
  me: string,
  confirmedTick: number,
  sent: ReadonlySet<string>,
): DueReport[] {
  return room.history.flatMap(({ tick, result }) => {
    const key = result.matchId + ":" + (result.round ?? "match");
    return tick <= confirmedTick &&
      result.finishers.includes(me) &&
      !sent.has(key)
      ? [
          {
            key,
            path: result.round === undefined ? "results" : "round-results",
            result,
          },
        ]
      : [];
  });
}

export { sendReport, type ReportTransport } from "fuse-ui/receipt-reporting";
