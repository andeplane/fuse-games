import { historyOnlyRegistration } from "fuse-platform";

/** Outcomes and activity without introducing ranked play or progression. */
export const choppersRegistration = historyOnlyRegistration({
  id: "fuse-choppers",
  isBot: (id) => /^bot:[1-9][0-9]*$/.test(id),
});
