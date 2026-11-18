import { historyOnlyRegistration, type MatchResult } from "fuse-platform";
import { CAPACITY, isBotId } from "./game/basics.js";
import { parseFuserodStats, type FuserodStats } from "./game/history-stats.js";
export const fuserodRegistration = {
  ...historyOnlyRegistration({ id: "fuserod", isBot: isBotId }),
  parseStats: parseFuserodStats,
  validField: (players: readonly FuserodStats[]) =>
    players.length > 0 &&
    players.length <= CAPACITY &&
    players.every(
      (p) =>
        p.route === players[0]!.route && p.raceTicks === players[0]!.raceTicks,
    ),
  activity: (result: MatchResult<FuserodStats>) => ({
    context: { map: result.players[0]?.route ?? "strip" },
  }),
  activityPlayer: (p: FuserodStats) => ({
    stats: { distance: p.distance, raceTicks: p.raceTicks },
  }),
};
