import { historyOnlyRegistration } from "fuse-platform";

/** Frozen outcomes and activity; ratings and progression remain disabled. */
export const bombersRegistration = historyOnlyRegistration({
  id: "fuse-bombers",
  isBot: (id) => /^bot:[1-9][0-9]*$/.test(id),
});
