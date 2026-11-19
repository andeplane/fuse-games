import { historyOnlyRegistration } from "fuse-platform";
export const incredibleFuseRegistration = historyOnlyRegistration({
  id: "incredible-fuse",
  isBot: () => false,
  activity: () => ({
    title: "Machine completed",
    context: { playStyle: "Cooperative" },
  }),
});
