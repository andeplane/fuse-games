import { historyOnlyRegistration } from "fuse-platform";
import { isFrontBot } from "./online/result.js";

/** Team outcomes enter shared history without introducing Elo or progression. */
export const frontRegistration = historyOnlyRegistration({
  id: "fuse-front",
  isBot: isFrontBot,
  activityPlayer(player) {
    return { label: `${player.slot % 2 === 0 ? "Blue" : "Red"} team · controller at match end`, stats: {} };
  },
  activity(result) {
    const blue = result.players.find(player => player.slot % 2 === 0)?.roundWins;
    const red = result.players.find(player => player.slot % 2 === 1)?.roundWins;
    return { title: blue ? "Blue team won" : red ? "Red team won" : "Draw" };
  },
});
