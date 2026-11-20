import type { MatchResult } from "fuse-platform";
import type { FuseParticlesStats } from "../platform.js";
import type { FuseParticlesRoom } from "./rules.js";
export type FuseParticlesPlayerResult = FuseParticlesStats;

export function matchResult(
  room: FuseParticlesRoom,
  round?: 1,
): MatchResult<FuseParticlesStats> | undefined {
  const battle = room.battle;
  if (room.stage !== "over" || !battle || battle.winner === null) return;
  const winnerId = room.fighters[battle.winner]?.id;
  return {
    matchId: room.matchId,
    length: 1,
    finishers: [...room.finishers],
    ...(winnerId === undefined ? {} : { winnerId }),
    ...(round
      ? { round, roundDuration: { version: 1, ticks: battle.tick } }
      : {}),
    players: room.fighters.map((fighter, index) => {
      const core = battle.cores[index]!;
      const hp = Math.max(0, Math.ceil(core.hp));
      return {
        playerId: fighter.id,
        name: fighter.name,
        slot: fighter.slot,
        roundsPlayed: 1,
        roundWins: fighter.id === winnerId ? 1 : 0,
        matchScoreUnits: hp,
        matchPlacement:
          1 + battle.cores.filter((other) => other.hp > core.hp).length,
        earlyExits: fighter.bot || room.finishers.includes(fighter.id) ? 0 : 1,
        hp,
        kills: core.kills,
      };
    }),
  };
}
