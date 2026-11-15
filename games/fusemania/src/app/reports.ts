import type { MatchResult } from "fuse-platform";
import { isBotId } from "../basics.js";
import type { Library } from "../engine/index.js";
import type { Room } from "../online/game.js";
import {
  matchResult,
  roundResult,
  type FusemaniaPlayerResult,
} from "../online/result.js";

/** One result this device owes the room service: the match as a rating receipt, or as the whole match. */
export interface DueReport {
  /** Unique per match and kind, so a report is sent once. */
  key: string;
  path: "round-results" | "results";
  result: MatchResult<FusemaniaPlayerResult>;
}

/**
 * The reports this device should send now. Every player still seated at the end reports what its own replica
 * computed, and the service keeps a result once enough of them agree, so only confirmed history goes in: nothing is
 * due until the confirmed log tick (`runtime.confirmedTick()`) reaches the tick the match was decided on, after
 * which no rollback can change it. Each song owes a numbered rating receipt under its session's parent id;
 * the final song also owes the aggregate match, which credits career totals once. A single song owes both.
 * A device that did not finish the song (the shared
 * screen, a watcher, a player who left, a bot id) owes nothing; `sent` holds the keys already sent.
 */
export function dueReports(
  library: Library,
  room: Room,
  me: string,
  confirmedTick: number,
  sent: ReadonlySet<string>,
): DueReport[] {
  const decided = room.decided;
  if (
    !me ||
    isBotId(me) ||
    room.stage !== "over" ||
    !decided ||
    decided.clock > confirmedTick ||
    !decided.finishers.includes(me)
  )
    return [];
  const due: DueReport[] = [];
  const round = roundResult(library, room),
    match = matchResult(library, room);
  if (round) {
    const key = `${round.matchId}:${round.round}`;
    if (!sent.has(key)) due.push({ key, path: "round-results", result: round });
  }
  if (match) {
    const key = `${match.matchId}:match`;
    if (!sent.has(key)) due.push({ key, path: "results", result: match });
  }
  return due;
}

export interface ReportTransport {
  fetch: typeof fetch;
  /** The room capability that proves which seat is reporting. */
  roomToken?: string;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Best effort: a lost report costs one history entry and never disturbs the game. Every device reports at the same
 * moment and their writes land on one record, so a 503 (a lost race), a 403 (the socket is reconnecting) and a dropped
 * connection are retried; any other refusal is final.
 */
export async function sendReport(
  url: string,
  report: DueReport,
  transport: ReportTransport,
  attempts = 3,
): Promise<"confirmed" | "pending" | "failed"> {
  const wait =
    transport.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await wait(500 * 2 ** attempt);
    try {
      const response = await transport.fetch(url, {
        method: "POST",
        body: JSON.stringify({ result: report.result }),
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(transport.roomToken === undefined ? {} : { Authorization: `Bearer ${transport.roomToken}` }),
        },
      });
      if (response.ok) {
        const body = (await response.json()) as { status?: unknown };
        return body.status === "confirmed" ? "confirmed" : "pending";
      }
      if (response.status !== 403 && response.status < 500) return "failed";
    } catch {
      /* offline or a dropped keepalive: try again */
    }
  }
  return "failed";
}
