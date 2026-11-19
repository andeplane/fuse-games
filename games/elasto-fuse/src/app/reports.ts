import {
  createSingleRoundReceipts,
  type MatchReceipt,
} from "fuse-ui/receipt-reporting";
import { isBotId } from "../basics.js";
import {
  matchResult,
  roundResult,
  type ElastoFusePlayerResult,
} from "../online/result.js";

/** One result this device owes the room service: the match as a rating receipt, or as the whole match. */
export type DueReport = MatchReceipt<ElastoFusePlayerResult>;

export const dueReports = createSingleRoundReceipts({
  isBotId,
  roundResult,
  matchResult,
});

export { sendReport, type ReportTransport } from "fuse-ui/receipt-reporting";
