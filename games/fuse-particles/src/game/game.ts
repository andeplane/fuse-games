import {
  defaultText,
  type RollbackGame,
  type SeatRecord,
  type Stage,
} from "fuse-netcode";
import { decodeRoom, encodeRoom, hashRoom } from "./checkpoint.js";
import {
  BOT_PREFIX,
  CAPACITY,
  MAX_WATCHERS,
  createRoom,
  foldTick,
  isAvatar,
  isFuseParticlesEntry,
  parseSettings,
  players,
  seatName,
  type Fighter,
  type FuseParticlesEntry,
  type FuseParticlesRoom,
  type FuseParticlesSettings,
} from "./rules.js";
import type { BattleState } from "./simulation.js";

export interface FuseParticlesView {
  tick: number;
  phase: Stage;
  round: number;
  matchId: string;
  players: SeatRecord[];
  fighters: Fighter[];
  battle: BattleState | null;
}
export const fuseParticlesGame: RollbackGame<
  FuseParticlesRoom,
  FuseParticlesEntry,
  FuseParticlesView,
  never,
  FuseParticlesSettings
> = {
  id: "fuse-particles",
  rules: "fuse-particles-1",
  isEntry: isFuseParticlesEntry,
  createRoom,
  createTicker: () => foldTick,
  scope: (room) => ({ matchId: room.matchId, round: room.round }),
  clock: (room) => room.tick,
  steps: () => 1,
  maxSteps: 1,
  view: (room) => ({
    tick: room.tick,
    phase: room.stage,
    round: room.round,
    matchId: room.matchId,
    players: players(room),
    fighters: room.fighters,
    battle: room.battle,
  }),
  hash: hashRoom,
  checkpoint: { leading: 3, encode: encodeRoom, decode: decodeRoom },
  members: (room) =>
    [...room.seats.values()].sort(
      (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : 1),
    ),
  seat: (room, id) => room.seats.get(id),
  stage: (room) => room.stage,
  settings: (room) => room.settings,
  seating: {
    capacity: CAPACITY,
    maxWatchers: MAX_WATCHERS,
    seatName,
    isAvatar,
    defaultAvatar: "robot",
    parseSettings,
    soloSettings: (settings) => ({ ...settings, display: false }),
    sharedScreen: (settings) => settings.display,
    botId(room, pending) {
      let number = 1;
      while (
        room.seats.has(BOT_PREFIX + number) ||
        pending.has(BOT_PREFIX + number)
      )
        number++;
      return BOT_PREFIX + number;
    },
    botName: (slot) => "Bot " + (slot + 1),
    solo: { name: "You", bots: 1 },
  },
  text: defaultText,
};
