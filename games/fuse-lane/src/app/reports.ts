import type { MatchResult } from "fuse-platform";
import {
  isBotId,
  matchResult,
  type FuseLanePlayerResult,
  type FuseLaneRoom,
} from "../game/index.js";

/**
 * The one result this device owes the room service: the whole match. Results are best effort and sent once: the page
 * marks the key sent before it posts, and a post that fails after `sendReport`'s retries is not tried again (the
 * other finishers' reports usually carry the match; a lost one costs a history entry, never the game).
 */
export interface DueReport {
  /** Unique per match, so a report is sent once. */
  key: string;
  path: "results";
  result: MatchResult<FuseLanePlayerResult>;
}

/**
 * The reports this device should send now. Every seated human reports what its own replica computed, and the service
 * keeps a result once a majority agree, so only confirmed history goes in: the match once the confirmed tick reaches
 * the tick it ended at (`phaseEnd` once it is over), when no rollback can change it. A device that did not finish the
 * match (the shared screen, a latecomer, a bot id) owes nothing.
 */
export function dueReports(
  room: FuseLaneRoom,
  me: string,
  confirmedTick: number,
  sent: ReadonlySet<string>,
): DueReport[] {
  if (!me || isBotId(me) || room.stage !== "over") return [];
  const key = `${room.matchId}:match`;
  if (sent.has(key) || room.phaseEnd > confirmedTick) return [];
  const result = matchResult(room);
  return result?.finishers.includes(me)
    ? [{ key, path: "results", result }]
    : [];
}

/** A one-human local match has no rollback or room capability. Shared sign-in transport owns the final solo ID. */
export function localReports(
  room: FuseLaneRoom,
  humans: readonly string[],
  signedIn: boolean,
  sent: ReadonlySet<string>,
): DueReport[] {
  if (!signedIn || humans.length !== 1) return [];
  const me = humans[0]!;
  const id = (value: string) => (value === me ? "solo" : value);
  return dueReports(room, me, room.tick, sent).flatMap((report) => {
    // Other people in pass-and-play cannot be claimed by this browser's one signed-in account.
    if (
      report.result.players.some(
        (player) => player.playerId !== me && !isBotId(player.playerId),
      )
    )
      return [];
    return [
      {
        ...report,
        result: {
          ...report.result,
          ...(report.result.winnerId === undefined
            ? {}
            : { winnerId: id(report.result.winnerId) }),
          finishers: report.result.finishers.map(id),
          players: report.result.players.map((player) => ({
            ...player,
            playerId: id(player.playerId),
          })),
        },
      },
    ];
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
