import type { MatchReceipt } from "fuse-ui/receipt-reporting";
import {
  STEPS_PER_TICK,
  matchResult,
  roundResult,
  type KillerFusePlayerResult,
  type Room,
} from "../online/index.js";

/** One result this device owes the room service: a rated round receipt, or the whole match. */
export type DueReport = MatchReceipt<KillerFusePlayerResult>;

/**
 * The reports this device should send now. Every seated human reports what its own replica computed, and the service
 * keeps a result once a majority agree, so only confirmed history goes in: a game once the confirmed tick reaches the
 * tick it was recorded at (a rollback cannot change it after that), and the set once its last game is confirmed.
 * `confirmedTick` is the runtime's, on the game clock: `STEPS_PER_TICK` to a log tick.
 * A device that did not play the game (the shared screen, a watcher, a latecomer) owes nothing, and neither does
 * anyone for a game the platform cannot rate (`roundResult` is undefined when six people played it).
 */
export function dueReports(
  room: Room,
  me: string,
  confirmedTick: number,
  sent: ReadonlySet<string>,
): DueReport[] {
  if (!me) return [];
  const due: DueReport[] = [];
  for (const record of room.results) {
    const key = `${room.matchId}:${record.round}`;
    if (
      sent.has(key) ||
      record.tick * STEPS_PER_TICK > confirmedTick ||
      !record.present.includes(me)
    )
      continue;
    const result = roundResult(room, record.round);
    if (result) due.push({ key, path: "round-results", result });
  }
  const last = room.results.at(-1),
    key = `${room.matchId}:match`;
  if (
    room.stage === "over" &&
    last &&
    last.tick * STEPS_PER_TICK <= confirmedTick &&
    !sent.has(key)
  ) {
    const result = matchResult(room);
    if (result?.finishers.includes(me))
      due.push({ key, path: "results", result });
  }
  return due;
}

export { sendReport, type ReportTransport } from "fuse-ui/receipt-reporting";
