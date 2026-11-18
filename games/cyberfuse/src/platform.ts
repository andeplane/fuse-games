import { historyOnlyRegistration, type MatchResult } from "fuse-platform";
import { isBotId } from "./game/basics.js";
import { parseCyberfuseStats, type CyberfuseStats } from "./game/stats.js";
export const cyberfuseRegistration = {
  ...historyOnlyRegistration({ id: "cyberfuse", isBot: isBotId }),
  parseStats: parseCyberfuseStats,
  validField: (players: readonly CyberfuseStats[]) =>
    players.length <= 5 &&
    new Set(players.map((p) => p.slot)).size === players.length,
  activity: (result: MatchResult<CyberfuseStats>) => ({
    title:
      result.round === undefined
        ? "Operation complete"
        : `Mission ${result.round}`,
    context: { missions: result.length },
  }),
  activityPlayer: (player: CyberfuseStats) => ({
    label: "Operative",
    score: player.score,
    stats: {
      missionsPlayed: player.roundsPlayed,
      wins: player.roundWins,
      bonus: player.bonus,
      kills: player.kills,
      friendlies: player.friendlies,
    },
  }),
};
