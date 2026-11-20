import {
  ACTION,
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  SPECTATOR,
  applyManagementTick,
  isManagementEntry,
  memberId,
  uint32,
  type LifecycleHooks,
  type ManagedRoom,
  type ManagementEntry,
  type SeatRecord,
  type Stage,
  type StreamEntries,
} from "fuse-netcode";
import { CAPACITY, MAX_NAME, isBotId, validName } from "./basics.js";
import {
  MAPS,
  actBattle,
  createBattle,
  isBattleAction,
  tickBattle,
  type BattleAction,
  type BattleState,
  type MapId,
} from "./simulation.js";
export * from "./basics.js";

export const MAX_WATCHERS = 8;
export const PLAY = 20;
export interface FuseParticlesSettings {
  map: MapId;
  seed: number;
  display: boolean;
}
export const DEFAULT_SETTINGS: FuseParticlesSettings = {
  map: "random",
  seed: 1729,
  display: false,
};
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: typeof PLAY,
  matchId: string,
  action: BattleAction,
];
export type FuseParticlesEntry =
  ManagementEntry<FuseParticlesSettings> | PlayEntry;
export type Fighter = Pick<SeatRecord, "id" | "name" | "slot" | "bot">;
export interface FuseParticlesRoom extends ManagedRoom<FuseParticlesSettings> {
  tick: number;
  round: number;
  stage: Stage;
  matchId: string;
  fighters: Fighter[];
  battle: BattleState | null;
  decidedTick: number;
  finishers: string[];
}

export function seatName(raw: string): string | undefined {
  const value = Array.from(raw.trim()).slice(0, MAX_NAME).join("").trim();
  return validName(value) ? value : undefined;
}
export const isAvatar = (value: unknown): value is string => value === "robot";
export const validMatchId = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7e]{1,64}$/.test(value);
export const playerKey = (value: unknown): value is string =>
  memberId(value) && !Object.hasOwn(Object.prototype, value);

export function parseSettings(raw: unknown): FuseParticlesSettings | undefined {
  if (!raw || typeof raw !== "object" || Object.keys(raw).length !== 3) return;
  const { map, seed, display } = raw as Partial<FuseParticlesSettings>;
  if (
    map === undefined ||
    !MAPS.includes(map) ||
    !uint32(seed) ||
    typeof display !== "boolean"
  )
    return;
  return { map, seed, display };
}

const payloads = {
  name: validName,
  avatar: isAvatar,
  capacity: CAPACITY,
  settings: (raw: unknown) => parseSettings(raw) !== undefined,
};
export function isFuseParticlesEntry(raw: unknown): raw is FuseParticlesEntry {
  if (isManagementEntry(raw, payloads)) {
    switch (raw[2]) {
      case ACTION:
        return validMatchId(raw[4]);
      case BOT:
        return isBotId(raw[4]);
      case SPECTATOR:
        return playerKey(raw[4]) && !isBotId(raw[4]);
      case JOIN:
      case LEAVE:
      case PRESENCE:
        return playerKey(raw[3]) && !isBotId(raw[3]);
      default:
        return true;
    }
  }
  return (
    Array.isArray(raw) &&
    raw.length === 5 &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    raw[2] === PLAY &&
    validMatchId(raw[3]) &&
    isBattleAction(raw[4])
  );
}

export function createRoom(
  matchId: string,
  settings: FuseParticlesSettings,
): FuseParticlesRoom {
  return {
    tick: 0,
    round: 1,
    matchId,
    settings: { ...settings },
    seats: new Map(),
    stage: "lobby",
    fighters: [],
    battle: null,
    decidedTick: 0,
    finishers: [],
  };
}
export function players(room: FuseParticlesRoom): SeatRecord[] {
  return [...room.seats.values()]
    .filter((seat) => !seat.watcher)
    .sort((a, b) => a.slot - b.slot);
}
function start(room: FuseParticlesRoom, matchId: string) {
  const seats = players(room).filter((seat) => seat.bot || seat.connected);
  if (seats.length < 2 || seats.every((seat) => seat.bot)) return;
  room.fighters = seats.map(({ id, name, slot, bot }) => ({
    id,
    name,
    slot,
    bot,
  }));
  room.matchId = matchId;
  room.battle = createBattle(
    room.settings.seed,
    room.settings.map,
    seats.map((seat) => seat.bot),
  );
  room.stage = "running";
  room.decidedTick = 0;
  room.finishers = [];
}
const lifecycle: LifecycleHooks<FuseParticlesRoom, FuseParticlesSettings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  start,
  rematch: start,
  lobby(room, matchId) {
    room.matchId = matchId;
    room.stage = "lobby";
    room.battle = null;
    room.fighters = [];
    room.finishers = [];
    room.decidedTick = 0;
  },
};

export function foldTick(
  room: FuseParticlesRoom,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<FuseParticlesEntry>>,
): never[] {
  const tick = room.tick + 1;
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  if (room.stage === "running" && room.battle) {
    room.fighters.forEach((fighter, index) => {
      const seat = room.seats.get(fighter.id);
      if (!seat?.connected || seat.bot || seat.watcher) return;
      const stream = streams.get(seat.id);
      const source =
        stream?.generation === seat.generation
          ? stream
          : stream?.retired?.find((old) => old.generation === seat.generation);
      for (const entry of source?.entries ?? [])
        if (entry[1] === tick && entry[2] === PLAY && entry[3] === room.matchId)
          actBattle(room.battle!, index, entry[4]);
    });
    tickBattle(room.battle);
    if (room.battle.winner !== null) {
      room.stage = "over";
      room.decidedTick = tick;
      room.finishers = room.fighters
        .filter(
          (fighter) => !fighter.bot && room.seats.get(fighter.id)?.connected,
        )
        .map((fighter) => fighter.id)
        .sort();
    }
  }
  room.tick = tick;
  return [];
}
