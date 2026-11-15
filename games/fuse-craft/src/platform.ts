import { historyOnlyRegistration } from "fuse-platform";
import { isCraftBot } from "./online/result.js";

/** Confirmed outcomes enter shared history without introducing ranked progression. */
export const craftRegistration = historyOnlyRegistration({
  id: "fuse-craft",
  isBot: isCraftBot,
  activityPlayer(player) {
    return { label: "Structures built", stats: { built: player.matchScoreUnits } };
  },
});
