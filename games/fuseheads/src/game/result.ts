import type { MatchResult, PlayerResult } from "fuse-platform";
import type { FuseheadsRoom } from "./rules.js";
import type { World } from "./simulation.js";

export type FuseheadsPlayerResult = PlayerResult;

/** Each level gets a final co-op history entry. A long expedition can exceed the platform's 99-round match limit. */
export function levelResult(
  room: FuseheadsRoom,
  world: World,
): MatchResult<PlayerResult> {
  const cleared = world.outcome === "cleared";
  return {
    matchId: `${room.matchId}:level:${room.round}`,
    length: 1,
    finishers: room.participants
      .filter((p) => room.seats.get(p.id)?.connected)
      .map((p) => p.id)
      .sort(),
    players: room.participants.map((p) => ({
      playerId: p.id,
      name: p.name,
      slot: p.slot,
      roundsPlayed: 1,
      roundWins: cleared ? 1 : 0,
      matchScoreUnits: Math.max(
        0,
        (world.players.find((player) => player.slot === p.slot)?.score ?? 0) -
          p.initialScore,
      ),
      matchPlacement: 1,
      earlyExits: room.seats.get(p.id)?.connected ? 0 : 1,
    })),
  };
}
