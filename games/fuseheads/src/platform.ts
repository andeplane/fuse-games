import { historyOnlyRegistration } from "fuse-platform";
import { validLevelTeam } from "./game/basics.js";

/** Clearing an underworld is a shared outcome. Both players can succeed together. */
export const fuseheadsRegistration = {
  ...historyOnlyRegistration({
    id: "fuseheads",
    isBot: () => false,
    activityPlayer: (player) => ({ score: player.matchScoreUnits }),
  }),
  validField: validLevelTeam,
};
