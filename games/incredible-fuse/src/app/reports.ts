import type { MatchResult } from "fuse-platform";
import {
  matchResult,
  type IncredibleFusePlayerResult,
  type IncredibleFuseRoom,
} from "../game/index.js";

export interface DueReport {
  key: string;
  path: "results";
  result: MatchResult<IncredibleFusePlayerResult>;
}

/** Only a participating builder's confirmed puzzle finish belongs in match history. */
export function dueReports(
  room: IncredibleFuseRoom,
  me: string,
  confirmedTick: number,
  sent: ReadonlySet<string>,
): DueReport[] {
  const record = room.history.at(-1);
  const key = room.matchId + ":match";
  if (
    room.stage !== "over" ||
    !record ||
    record.tick > confirmedTick ||
    !record.finishers.includes(me) ||
    sent.has(key)
  )
    return [];
  const result = matchResult(room);
  return result ? [{ key, path: "results", result }] : [];
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
