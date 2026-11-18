import { defaultText, type RollbackGame } from "fuse-netcode";
import { decodeRoom, encodeRoom, hashRoom } from "./checkpoint.js";
import { SIM_HZ } from "./simulation.js";
import {
  CAPACITY,
  MAX_WATCHERS,
  LOG_HZ,
  clockAt,
  createRoom,
  foldTick,
  isAvatar,
  isFuseheadsEntry,
  parseSettings,
  players,
  seatName,
  type FuseheadsEntry,
  type FuseheadsEvent,
  type FuseheadsRoom,
  type FuseheadsSettings,
} from "./rules.js";

export function fuseheadsView(room: FuseheadsRoom) {
  const world = room.world;
  return {
    tick: clockAt(room.tick),
    phase: room.stage,
    round: room.round,
    world: world && structuredClone(world),
    outcome: world?.outcome ?? "playing",
    players: players(room).map((seat) => {
      const participant = room.participants.find(
        (p) => p.id === seat.id && p.slot === seat.slot,
      );
      return {
        id: seat.id,
        name: seat.name,
        slot: seat.slot,
        avatarId: seat.avatarId,
        bot: false,
        connected: seat.connected,
        participating: !!participant,
        score: participant
          ? (world?.players.find((p) => p.slot === seat.slot)?.score ?? 0)
          : 0,
      };
    }),
    watchers: [...room.seats.values()]
      .filter((s) => s.watcher)
      .map((s) => ({ id: s.id, name: s.name, connected: s.connected }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}
export type FuseheadsView = ReturnType<typeof fuseheadsView>;
export const fuseheadsGame: RollbackGame<
  FuseheadsRoom,
  FuseheadsEntry,
  FuseheadsView,
  FuseheadsEvent,
  FuseheadsSettings
> = {
  id: "fuseheads",
  rules: "fuseheads-1",
  isEntry: isFuseheadsEntry,
  createRoom,
  createTicker: () => foldTick,
  scope: (r) => ({ matchId: r.matchId, round: r.round }),
  clock: (r) => clockAt(r.tick),
  steps: (r) => clockAt(r.tick + 1) - clockAt(r.tick),
  maxSteps: Math.ceil(SIM_HZ / LOG_HZ),
  view: fuseheadsView,
  hash: hashRoom,
  checkpoint: { leading: 1, encode: encodeRoom, decode: decodeRoom },
  members: (r) =>
    [...r.seats.values()].sort(
      (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : 1),
    ),
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
    botId: () => "bot:1",
    botName: () => "Bot",
    solo: { name: "You", bots: 0 },
  },
  text: { ...defaultText, needTwo: "Take a seat to begin." },
};
