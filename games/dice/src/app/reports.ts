import type { MatchReceipt } from "fuse-ui/receipt-reporting";
import {
  isBotId,
  matchResult,
  roundResult,
  type DicePlayerResult,
  type DiceRoom,
} from "../game/index.js";

/** One result this device owes the room service: a rated round receipt, or the whole match. */
export type DueReport = MatchReceipt<DicePlayerResult>;

/**
 * The reports this device should send now. Every seated human reports what its own replica computed, and the service
 * keeps a result once a majority agree, so only confirmed history goes in: a round once the confirmed tick reaches the
 * tick it was decided at (a rollback cannot change it after that), and the match once its last round is confirmed.
 * A device that did not play the round (the shared screen, a latecomer, a bot id) owes nothing.
 */
export function dueReports(
  room: DiceRoom,
  me: string,
  confirmedTick: number,
  sent: ReadonlySet<string>,
): DueReport[] {
  if (!me || isBotId(me)) return [];
  const due: DueReport[] = [];
  for (const record of room.history) {
    const key = `${room.matchId}:${record.round}`;
    if (
      sent.has(key) ||
      record.tick > confirmedTick ||
      !record.finishers.includes(me)
    )
      continue;
    const result = roundResult(room, record.round);
    if (result) due.push({ key, path: "round-results", result });
  }
  const last = room.history.at(-1),
    key = `${room.matchId}:match`;
  if (
    room.stage === "over" &&
    last &&
    last.tick <= confirmedTick &&
    !sent.has(key)
  ) {
    const result = matchResult(room);
    if (result?.finishers.includes(me))
      due.push({ key, path: "results", result });
  }
  return due;
}

export { sendReport, type ReportTransport } from "fuse-ui/receipt-reporting";
