import { defaultText, type RollbackGame } from "fuse-netcode";
import {
  CAPACITY,
  parseSettings,
  seatName,
  type FuserodSettings,
} from "./basics.js";
import { decodeRoom, encodeRoom, hashRoom } from "./checkpoint.js";
import {
  createRoom,
  foldTick,
  fuserodView,
  isAvatar,
  isEntry,
  seats,
  type FuserodEntry,
  type FuserodRoom,
  type FuserodView,
} from "./rules.js";
export * from "./basics.js";
export * from "./rules.js";
export { decodeRoom, encodeRoom, hashRoom } from "./checkpoint.js";
export const fuserodGame: RollbackGame<
  FuserodRoom,
  FuserodEntry,
  FuserodView,
  never,
  FuserodSettings
> = {
  id: "fuserod",
  rules: "fuserod-1",
  isEntry,
  createRoom,
  createTicker: () => foldTick,
  scope: (r) => ({ matchId: r.matchId, round: 1 }),
  clock: (r) => r.tick,
  steps: () => 1,
  maxSteps: 1,
  view: fuserodView,
  hash: hashRoom,
  checkpoint: { leading: 6, encode: encodeRoom, decode: decodeRoom },
  members: seats,
  seat: (r, id) => r.seats.get(id),
  stage: (r) => r.stage,
  settings: (r) => r.settings,
  matchSettings: (r) => r.race?.settings ?? r.settings,
  seating: {
    capacity: CAPACITY,
    minPlayers: 1,
    maxWatchers: 0,
    seatName,
    isAvatar,
    defaultAvatar: "robot",
    parseSettings,
    soloSettings: (s) => ({ ...s, display: false }),
    sharedScreen: (s) => s.display,
    botId(room, pending) {
      let number = 1;
      while (room.seats.has(`bot:${number}`) || pending.has(`bot:${number}`))
        number++;
      return `bot:${number}`;
    },
    botName: (slot) => ["Mica", "Sparks", "Jet", "Indigo", "Rivet"][slot]!,
    solo: { name: "You", bots: 1 },
  },
  text: defaultText,
};
