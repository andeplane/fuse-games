import { historyOnlyRegistration } from "fuse-platform";
import { parseBallHistoryPlayer } from "./online/activity.js";
/** History is shared across games; this experiment awards no rating or progression. */
export const ballBrosRegistration = {
  ...historyOnlyRegistration({
    id: "ball-bros",
    isBot: (id) => /^bot-[1-9][0-9]*$/.test(id),
  }),
  parseStats: parseBallHistoryPlayer,
  validField: (
    players: readonly import("./online/activity.js").BallHistoryPlayer[],
  ) =>
    players.length <= 5 &&
    players.every((player) => player.mapId === players[0]?.mapId),
  activity: (
    result: import("fuse-platform").MatchResult<
      import("./online/activity.js").BallHistoryPlayer
    >,
  ) => ({ context: { map: result.players[0]?.mapId ?? "classic" } }),
  activityPlayer: (
    player: import("./online/activity.js").BallHistoryPlayer,
  ) => ({
    stats: { saves: player.saves, broken: player.broken, armor: player.armor },
  }),
};
