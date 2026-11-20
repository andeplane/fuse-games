import {
  createSingleRoundReceipts,
  type MatchReceipt,
} from "fuse-ui/receipt-reporting";
import { isBotId } from "../game/basics.js";
import {
  matchResult,
  roundResult,
  type DocksidePlayerResult,
  type ResultState,
} from "../game/result.js";

/** One result this device owes the room service: the match as a rating receipt, or as the whole match. */
export type DueReport = MatchReceipt<DocksidePlayerResult>;

export const dueReports = createSingleRoundReceipts({
  isBotId,
  roundResult,
  matchResult,
});

export { sendReport, type ReportTransport } from "fuse-ui/receipt-reporting";

/** The next match can replace its predecessor as soon as the decision is in confirmed history. */
export function decisionConfirmed(
  predicted: Pick<ResultState, "stage" | "matchId">,
  confirmed: ResultState | undefined,
) {
  return (
    predicted.stage === "over" &&
    confirmed?.stage === "over" &&
    confirmed.matchId === predicted.matchId &&
    !!confirmed.decided
  );
}
