import { historyOnlyRegistration, type MatchResult } from "fuse-platform";
import {
  isHistoryBot,
  parseHookHistoryPlayer,
  type HookHistoryPlayer,
} from "./online/activity.js";
/** Competitive rounds produce history; free play awards no result, rating or progression. */
export const hookRegistration = {
  ...historyOnlyRegistration({
    id: "hook-havok",
    isBot: isHistoryBot,
  }),
  parseStats: parseHookHistoryPlayer,
  validField: (players: readonly HookHistoryPlayer[]) =>
    players.length <= 5 &&
    players.every(
      (player) =>
        player.map === players[0]?.map && player.rules === players[0]?.rules,
    ),
  activity: (result: MatchResult<HookHistoryPlayer>) => ({
    title:
      result.players[0]?.rules === "score"
        ? "Hook score"
        : "Last keeper standing",
    context: { map: result.players[0]?.map ?? "crossroads" },
  }),
  activityPlayer: (player: HookHistoryPlayer) => ({
    score: player.points,
    stats: {
      points: player.points,
      knockouts: player.knockouts,
      falls: player.falls,
      thrown: player.thrown,
    },
  }),
};
