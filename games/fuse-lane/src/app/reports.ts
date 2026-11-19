import type { MatchReceipt } from "fuse-ui/receipt-reporting";
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
export type DueReport = MatchReceipt<FuseLanePlayerResult, "results">;

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

export { sendReport, type ReportTransport } from "fuse-ui/receipt-reporting";
