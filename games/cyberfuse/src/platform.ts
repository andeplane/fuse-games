import { historyOnlyRegistration } from "fuse-platform";
import { isBotId } from "./game/basics.js";

export const cyberfuseRegistration = historyOnlyRegistration({
  id: "cyberfuse",
  isBot: isBotId,
  activity: (result) => ({
    title:
      result.round === undefined
        ? "Operation complete"
        : `Mission ${result.round}`,
    context: { missions: result.length },
  }),
  activityPlayer: (player) => ({
    label: "Operative",
    score: player.matchScoreUnits,
    stats: { missionsPlayed: player.roundsPlayed, wins: player.roundWins },
  }),
});
