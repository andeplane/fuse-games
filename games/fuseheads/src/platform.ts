import { historyOnlyRegistration } from "fuse-platform";

/** Clearing an underworld is a shared outcome. Both players can succeed together. */
export const fuseheadsRegistration = historyOnlyRegistration({
  id: "fuseheads",
  isBot: () => false,
  activityPlayer: (player) => ({ score: player.matchScoreUnits }),
});
