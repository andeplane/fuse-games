import type { MatchResult, PlayerResult } from "fuse-platform";
import type { IncredibleFuseRoom } from "./rules.js";
export type IncredibleFusePlayerResult = PlayerResult;

/** Freeze team placement at the solve tick. Builders can move or leave once results are visible. */
export function matchResult(
  room: IncredibleFuseRoom,
): MatchResult<PlayerResult> | undefined {
  const r = room.history[0];
  if (room.stage !== "over" || !r?.finishers.length) return;
  return {
    matchId: room.matchId,
    length: 1,
    finishers: [...r.finishers],
    players: r.players.map((p) => ({
      playerId: p.id,
      name: p.name,
      slot: p.slot,
      roundsPlayed: 1,
      roundWins: p.finished ? 1 : 0,
      matchScoreUnits: p.finished ? 1 : 0,
      matchPlacement: p.finished ? 1 : r.finishers.length + 1,
      earlyExits: p.finished ? 0 : 1,
    })),
  };
}
