import {
  ACTION,
  BOT,
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
import type { HistoryReceipt } from "fuse-platform/history-api";
import { getLevel, levelCount } from "../levels/index.js";
import {
  CAPACITY,
  MAX_WATCHERS,
  isAvatar,
  validMatchId,
  validName,
} from "./basics.js";
import {
  createWorld,
  stepWorld,
  SIM_HZ,
  type Pack,
  type World,
} from "./simulation.js";
import { levelResult } from "./result.js";
export * from "./basics.js";

export const INPUT = 1;
export const MAX_RECEIPTS = 8;
export const BETWEEN_TICKS = 40;
export const LOG_HZ = 20;
export const clockAt = (tick: number) => Math.floor((tick * SIM_HZ) / LOG_HZ);
export interface FuseheadsSettings {
  display: boolean;
  pack: Pack;
}
export const DEFAULT_SETTINGS: FuseheadsSettings = {
  display: false,
  pack: "original",
};
export interface FuseheadsSave {
  version: 1;
  nextLevel: number;
  pack: Pack;
  rng: number;
  tnt: number;
  players: { slot: number; lives: number; score: number }[];
}

/** Only a living team at a ruler checkpoint can continue an expedition. */
export function parseSave(raw: unknown): FuseheadsSave | undefined {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== 6
  )
    return;
  const { version, nextLevel, pack, rng, tnt, players } =
    raw as Partial<FuseheadsSave>;
  if (
    version !== 1 ||
    (pack !== "original" && pack !== "bonus") ||
    !uint32(nextLevel) ||
    nextLevel < 2 ||
    nextLevel > levelCount(pack) ||
    (nextLevel - 1) % 6 !== 0 ||
    !getLevel(nextLevel - 1, pack).boss ||
    !uint32(rng) ||
    !uint32(tnt) ||
    tnt > 3 ||
    !Array.isArray(players) ||
    players.length < 1 ||
    players.length > 2
  )
    return;
  if (
    !players.every(
      (p, i) =>
        p &&
        typeof p === "object" &&
        Object.keys(p).length === 3 &&
        p.slot === i &&
        uint32(p.lives) &&
        p.lives <= 99 &&
        uint32(p.score) &&
        p.score <= 99_999_999,
    ) ||
    !players.some((p) => p.lives > 0)
  )
    return;
  return {
    version,
    pack,
    nextLevel,
    rng,
    tnt,
    players: players.map(({ slot, lives, score }) => ({ slot, lives, score })),
  };
}
export function saveAfterRuler(room: FuseheadsRoom): FuseheadsSave | undefined {
  const w = room.world;
  if (room.stage !== "between" || !w || w.outcome !== "cleared") return;
  return parseSave({
    version: 1,
    pack: w.pack,
    nextLevel: room.round + 1,
    rng: w.rng,
    tnt: w.tnt,
    players: w.players.map(({ slot, lives, score }) => ({
      slot,
      lives,
      score,
    })),
  });
}
export type InputEntry = [
  seq: number,
  tick: number,
  kind: typeof INPUT,
  match: string,
  round: number,
  mask: number,
];
export type FuseheadsEntry = ManagementEntry<FuseheadsSettings> | InputEntry;
export type FuseheadsEvent = {
  type: "level-ended";
  round: number;
  cleared: boolean;
};
export interface Participant {
  id: string;
  name: string;
  slot: number;
  /** Stream generation and last held controls are both restored on rollback. */
  generation: number;
  mask: number;
  pending: number[];
  initialScore: number;
}
export interface FuseheadsRoom extends ManagedRoom<FuseheadsSettings> {
  /** Only a local runtime can install a continuation in its initial lobby. */
  pendingSave: FuseheadsSave | null;
  tick: number;
  matchId: string;
  round: number;
  stage: Stage;
  participants: Participant[];
  world: World | null;
  resumeAt: number;
  receipts: HistoryReceipt[];
}

export function parseSettings(raw: unknown): FuseheadsSettings | undefined {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== 2
  )
    return;
  const { display, pack } = raw as Partial<FuseheadsSettings>;
  if (typeof display === "boolean" && (pack === "original" || pack === "bonus"))
    return { display, pack };
}
export const playerKey = (raw: unknown): raw is string =>
  memberId(raw) && !(raw in Object.prototype);
export const validMask = (mask: unknown): mask is number =>
  uint32(mask) && mask <= 7;
const payloads = {
  name: validName,
  avatar: isAvatar,
  settings: (raw: unknown) => !!parseSettings(raw),
  capacity: CAPACITY,
};
export function isFuseheadsEntry(raw: unknown): raw is FuseheadsEntry {
  if (isManagementEntry(raw, payloads)) {
    switch (raw[2]) {
      case BOT:
        return false;
      case ACTION:
        return validMatchId(raw[4]);
      case SPECTATOR:
        return playerKey(raw[4]);
      default:
        return raw[2] > PRESENCE || playerKey(raw[3]);
    }
  }
  return (
    Array.isArray(raw) &&
    raw.length === 6 &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    raw[2] === INPUT &&
    validMatchId(raw[3]) &&
    uint32(raw[4]) &&
    raw[4] > 0 &&
    validMask(raw[5])
  );
}
export function createRoom(
  matchId: string,
  settings: FuseheadsSettings,
): FuseheadsRoom {
  return {
    pendingSave: null,
    tick: 0,
    matchId,
    round: 1,
    stage: "lobby",
    settings: { ...settings },
    seats: new Map(),
    participants: [],
    world: null,
    resumeAt: 0,
    receipts: [],
  };
}
export function players(room: FuseheadsRoom): SeatRecord[] {
  return [...room.seats.values()]
    .filter((s) => !s.watcher)
    .sort((a, b) => a.slot - b.slot);
}
function seedOf(matchId: string): number {
  let seed = 0x811c9dc5;
  for (let n = 0; n < matchId.length; n++)
    seed = Math.imul(seed ^ matchId.charCodeAt(n), 0x01000193);
  return seed >>> 0;
}

function startLevel(
  room: FuseheadsRoom,
  previous?: World,
  save?: FuseheadsSave,
): void {
  const active = players(room).filter(
    (s) =>
      s.connected || (previous && room.participants.some((p) => p.id === s.id)),
  );
  // A replacement who takes a vacant slot between levels starts with fresh lives and points.
  const returning = new Set(
    active
      .filter((s) =>
        room.participants.some((p) => p.slot === s.slot && p.id === s.id),
      )
      .map((s) => s.slot),
  );
  const carry = previous && {
    ...previous,
    players: previous.players.filter((p) => returning.has(p.slot)),
  };
  room.world = createWorld(
    room.round - 1,
    active.map((s) => s.slot),
    save?.rng ?? previous?.rng ?? seedOf(room.matchId),
    save ?? carry,
    save?.pack ?? previous?.pack ?? room.settings.pack,
  );
  room.participants = active.map((s) => ({
    id: s.id,
    name: s.name,
    slot: s.slot,
    generation: s.generation!,
    mask: 0,
    pending: [],
    initialScore: room.world!.players.find((p) => p.slot === s.slot)!.score,
  }));
  room.stage = "running";
  room.resumeAt = 0;
}
function reset(room: FuseheadsRoom, matchId: string): void {
  room.pendingSave = null;
  room.matchId = matchId;
  room.round = 1;
  room.world = null;
  room.participants = [];
  room.resumeAt = 0;
  room.stage = "lobby";
}
function start(room: FuseheadsRoom, matchId: string): void {
  if (!players(room).some((s) => s.connected)) return;
  const save = room.pendingSave;
  reset(room, matchId);
  if (save) room.round = save.nextLevel;
  startLevel(room, undefined, save ?? undefined);
}
const hooks: LifecycleHooks<FuseheadsRoom, FuseheadsSettings> = {
  stage: (r) => r.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  start,
  rematch: start,
  lobby: reset,
};

function queueInputs(
  room: FuseheadsRoom,
  p: Participant,
  streams: ReadonlyMap<string, StreamEntries<FuseheadsEntry>>,
  tick: number,
): void {
  const seat = room.seats.get(p.id);
  if (!seat?.connected || seat.watcher || seat.slot !== p.slot) {
    p.mask = 0;
    p.pending = [];
    return;
  }
  if (p.generation !== seat.generation) {
    p.mask = 0;
    p.pending = [];
    p.generation = seat.generation!;
  }
  const stream = streams.get(p.id);
  const source =
    stream?.generation === p.generation
      ? stream
      : stream?.retired?.find((s) => s.generation === p.generation);
  for (const entry of source?.entries ?? []) {
    if (
      entry[1] !== tick ||
      entry[2] !== INPUT ||
      entry[3] !== room.matchId ||
      entry[4] !== room.round ||
      entry[5] === (p.pending.at(-1) ?? p.mask)
    )
      continue;
    // Two transitions preserve a short tap. A burst still ends in the sender's latest state.
    if (p.pending.length === 2) p.pending.pop();
    p.pending.push(entry[5]);
  }
}
export function foldTick(
  room: FuseheadsRoom,
  creator: string,
  streams: ReadonlyMap<string, StreamEntries<FuseheadsEntry>>,
): FuseheadsEvent[] {
  const tick = room.tick + 1,
    events: FuseheadsEvent[] = [];
  applyManagementTick(room, tick, creator, streams, hooks);
  if (room.stage === "between" && tick >= room.resumeAt && room.world) {
    if (players(room).some((s) => s.connected)) {
      room.round++;
      startLevel(room, room.world);
    }
  }
  const world = room.world;
  if (room.stage === "running" && world) {
    for (const p of room.participants) queueInputs(room, p, streams, tick);
    const count = clockAt(tick) - clockAt(tick - 1);
    for (let step = 0; step < count && world.outcome === "playing"; step++) {
      const inputs = [0, 0];
      for (const p of room.participants) {
        const mask = p.pending.shift();
        if (mask !== undefined) p.mask = mask;
        inputs[p.slot] = p.mask;
      }
      stepWorld(world, inputs);
    }
    if (world.outcome !== "playing") {
      room.receipts.push({
        tick: clockAt(tick),
        result: levelResult(room, world),
      });
      if (room.receipts.length > MAX_RECEIPTS) room.receipts.shift();
      const cleared = world.outcome === "cleared";
      room.stage =
        cleared && room.round < levelCount(world.pack) ? "between" : "over";
      room.resumeAt = room.stage === "between" ? tick + BETWEEN_TICKS : 0;
      events.push({ type: "level-ended", round: room.round, cleared });
    }
  }
  room.tick = tick;
  return events;
}
