import type { MatchResult } from "fuse-platform";
import type { CyberfuseRoom } from "../game/index.js";
export interface DueReport {
  key: string;
  path: "results" | "round-results";
  result: MatchResult;
}
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
