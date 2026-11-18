import { defaultText, type RollbackGame } from "fuse-netcode";
import {
  CAPACITY,
  MAX_WATCHERS,
  parseSettings,
  seatName,
  type CyberfuseSettings,
} from "./basics.js";
import {
  bySlot,
  clockAt,
  createRoom,
  foldTick,
  isAvatar,
  isCyberfuseEntry,
  players,
  type CyberfuseRoom,
  type CyberfuseEntry,
  type CyberfuseEvent,
} from "./rules.js";
import { standings } from "./result.js";
import { decodeRoom, encodeRoom, hashRoom } from "./checkpoint.js";

export function cyberfuseView(room: CyberfuseRoom) {
  return {
    tick: clockAt(room.tick),
    phase: room.stage,
    round: room.round,
    players: players(room).map((seat) => ({ ...seat })),
    watchers: [...room.seats.values()]
      .filter((s) => s.watcher)
      .sort(bySlot)
      .map((seat) => ({ ...seat })),
    world: room.world,
    outcome: room.world?.outcome ?? null,
    winners: room.world?.winners ?? [],
    results: standings(room).map((p) => ({
      ...p,
      score:
        p.score +
        (room.stage === "running"
          ? (room.world?.actors.find((a) => a.seat === p.id)?.score ?? 0)
          : 0),
    })),
  };
}
export type CyberfuseView = ReturnType<typeof cyberfuseView>;
export const cyberfuseGame: RollbackGame<
  CyberfuseRoom,
  CyberfuseEntry,
  CyberfuseView,
  CyberfuseEvent,
  CyberfuseSettings
> = {
  id: "cyberfuse",
  rules: "cyberfuse-1",
  isEntry: isCyberfuseEntry,
  createRoom,
  createTicker: () => foldTick,
  scope: (r) => ({ matchId: r.matchId, round: r.round }),
  clock: (r) => clockAt(r.tick),
  steps: (r) => clockAt(r.tick + 1) - clockAt(r.tick),
  maxSteps: 4,
  view: cyberfuseView,
  hash: hashRoom,
  checkpoint: { leading: 3, encode: encodeRoom, decode: decodeRoom },
  members: (r) => [...r.seats.values()].sort(bySlot),
  seat: (r, id) => r.seats.get(id),
  stage: (r) => r.stage,
  settings: (r) => r.settings,
  seating: {
    capacity: CAPACITY,
    minPlayers: 1,
    maxWatchers: MAX_WATCHERS,
    seatName,
    isAvatar,
    defaultAvatar: "robot",
    parseSettings,
    soloSettings: (s) => ({ ...s, display: false }),
    sharedScreen: (s) => s.display,
    solo: { name: "Operative", bots: 0 },
    botId(r, pending) {
      let n = 1;
      while (
        r.seats.has("bot:" + n) ||
        pending.has("bot:" + n) ||
        r.roster.some((p) => p.id === "bot:" + n)
      )
        n++;
      return "bot:" + n;
    },
    botName: (slot) => "Drone " + (slot + 1),
  },
  text: { ...defaultText, needTwo: "Take a seat to launch the mission." },
};
