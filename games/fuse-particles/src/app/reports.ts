import type { MatchResult } from "fuse-platform";
import {
  isBotId,
  matchResult,
  type FuseParticlesPlayerResult,
  type FuseParticlesRoom,
} from "../game/index.js";

/** One result this device owes the room service: a rated round receipt, or the whole match. */
export interface DueReport {
  /** Unique per match and round, so a report is sent once. */
  key: string;
  path: "round-results" | "results";
  result: MatchResult<FuseParticlesPlayerResult>;
}

/**
 * The reports this device should send now. Every seated human reports what its own replica computed, and the service
 * keeps a result once a majority agree, so only confirmed history goes in: a round once the confirmed tick reaches the
 * tick it was decided at (a rollback cannot change it after that), and the match once its last round is confirmed.
 * A device that did not play the round (the shared screen, a latecomer, a bot id) owes nothing.
 */
export function dueReports(
  room: FuseParticlesRoom,
  me: string,
  confirmedTick: number,
  sent: ReadonlySet<string>,
): DueReport[] {
  if (
    !me ||
    isBotId(me) ||
    !room.finishers.includes(me) ||
    !room.decidedTick ||
    room.decidedTick > confirmedTick
  )
    return [];
  const match = matchResult(room),
    round = matchResult(room, 1);
  if (!match || !round) return [];
  return (
    [
      { key: room.matchId + ":1", path: "round-results", result: round },
      { key: room.matchId + ":match", path: "results", result: match },
    ] satisfies DueReport[]
  ).filter((report) => !sent.has(report.key));
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
          ...(transport.roomToken === undefined
            ? {}
            : { Authorization: `Bearer ${transport.roomToken}` }),
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
