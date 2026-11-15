import { historyOnlyRegistration } from "fuse-platform";
import { isHunterBot } from "./online/result.js";
/** Completed shifts use shared history without creating competitive ratings. */
export const graveyardRegistration = historyOnlyRegistration({
  id: "graveyard-shift",
  isBot: isHunterBot,
  activity: () => ({ title: "Shift complete", context: { scoreUnit: "energy" } }),
});
