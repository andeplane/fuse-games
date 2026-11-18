import type { MatchResult } from "fuse-platform";
import { COUNTDOWN_TICKS, FINISH, metres } from "./basics.js";
import type { FuserodStats } from "./history-stats.js";
import { rank, type Race } from "./race.js";
export function raceResult(
  race: Race,
  matchId: string,
  finishers: string[],
): MatchResult<FuserodStats> {
  const route = race.settings.route;
  const raceTicks = race.elapsed - COUNTDOWN_TICKS;
  const positions = rank(race);
  return {
    matchId,
    length: 1,
    ...(race.winnerId ? { winnerId: race.winnerId } : {}),
    finishers,
    players: race.racers.map((r) => {
      const distance = Math.floor(
        metres(Math.min(FINISH[route], r.motor.position)),
      );
      return {
        playerId: r.id,
        name: r.name,
        slot: r.slot,
        roundsPlayed: 1,
        roundWins: Number(r.id === race.winnerId),
        matchScoreUnits: distance,
        matchPlacement: positions.indexOf(r) + 1,
        earlyExits: Number(!r.bot && !finishers.includes(r.id)),
        route,
        distance,
        raceTicks,
      };
    }),
  };
}
