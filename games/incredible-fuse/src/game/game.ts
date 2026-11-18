import { defaultText, type RollbackGame } from "fuse-netcode";
import {
  decodeRoom,
  encodeRoom,
  hashRoom,
  orderedSeats,
} from "./checkpoint.js";
import {
  CAPACITY,
  MAX_WATCHERS,
  createRoom,
  foldTick,
  machineLifecycle,
  isAvatar,
  isIncredibleFuseEntry,
  parseSettings,
  players,
  seatName,
  type IncredibleFuseRoom,
  type IncredibleFuseEntry,
  type IncredibleFuseEvent,
  type IncredibleFuseSettings,
} from "./rules.js";
import {
  createMachine,
  createWorkshop,
  FREE_WORKSHOP,
  validWorkshopBlueprint,
  type WorkshopBlueprint,
} from "./machine.js";
export function incredibleFuseView(room: IncredibleFuseRoom) {
  return {
    tick: room.tick,
    phase: room.stage,
    round: room.round,
    players: players(room).map(
      ({ id, name, slot, avatarId, bot, connected }) => ({
        id,
        name,
        slot,
        avatarId,
        bot,
        connected,
      }),
    ),
    watchers: orderedSeats(room)
      .filter((s) => s.watcher)
      .map(({ id, name, connected }) => ({ id, name, connected })),
    machine: structuredClone(room.machine),
  };
}
export type IncredibleFuseView = ReturnType<typeof incredibleFuseView>;
export const incredibleFuseGame: RollbackGame<
  IncredibleFuseRoom,
  IncredibleFuseEntry,
  IncredibleFuseView,
  IncredibleFuseEvent,
  IncredibleFuseSettings
> = {
  id: "incredible-fuse",
  rules: "incredible-fuse-1",
  isEntry: isIncredibleFuseEntry,
  createRoom,
  createTicker: () => foldTick,
  scope: (room) => ({ matchId: room.matchId, round: room.round }),
  clock: (room) => room.tick,
  steps: () => 1,
  maxSteps: 1,
  view: incredibleFuseView,
  hash: hashRoom,
  checkpoint: { leading: 5, encode: encodeRoom, decode: decodeRoom },
  members: orderedSeats,
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
  text: {
    ...defaultText,
    solo: "Solo workshop",
    needTwo: "Take a seat to begin.",
  },
};

/** One solo runtime owns its imported, immutable starting layout across retries and fresh runs. */
export function privateWorkshopGame(
  blueprint: WorkshopBlueprint,
): typeof incredibleFuseGame {
  if (!validWorkshopBlueprint(blueprint))
    throw new Error("Invalid workshop layout");
  const saved = structuredClone(blueprint);
  const initialize = (index: number) =>
    index === FREE_WORKSHOP ? createWorkshop(saved) : createMachine(index);
  const lifecycle = machineLifecycle(initialize);
  return {
    ...incredibleFuseGame,
    createRoom: (id, settings) => createRoom(id, settings, initialize),
    checkpoint: {
      ...incredibleFuseGame.checkpoint,
      decode: (fields, tick) => decodeRoom(fields, tick, true),
    },
    createTicker: () => (room, creator, streams) =>
      foldTick(room, creator, streams, lifecycle),
  };
}
