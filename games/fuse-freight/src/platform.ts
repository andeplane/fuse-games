import { historyOnlyRegistration } from "fuse-platform";

/** Outcomes and activity without introducing ranked play or progression. */
export const freightRegistration = historyOnlyRegistration({
  id: "fuse-freight",
  isBot: id => /^bot:[1-9][0-9]*$/.test(id),
});
