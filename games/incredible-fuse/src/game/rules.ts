import {
  ACTION,
  BOT,
  applyManagementTick,
  isManagementEntry,
  uint32,
  type LifecycleHooks,
  type ManagedRoom,
  type ManagementEntry,
  type SeatRecord,
  type StreamEntries,
  entriesForGeneration,
} from "fuse-netcode";
import { CAPACITY, MAX_WATCHERS, validName, isAvatar } from "./basics.js";
import {
  FREE_WORKSHOP,
  createMachine,
  stepMachine,
  applyMachine,
  validCommand,
  type Machine,
  type MachineCommand,
} from "./machine.js";
export * from "./basics.js";

export const EDIT = 0;
export interface IncredibleFuseSettings {
  puzzleIndex: number;
  display: boolean;
}
export const DEFAULT_SETTINGS: IncredibleFuseSettings = {
  puzzleIndex: 0,
  display: false,
};
export function parseSettings(
  raw: unknown,
): IncredibleFuseSettings | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const { puzzleIndex, display } = raw as Partial<IncredibleFuseSettings>;
  if (
    Object.keys(raw).length === 2 &&
    uint32(puzzleIndex) &&
    puzzleIndex <= FREE_WORKSHOP &&
    typeof display === "boolean"
  )
    return { puzzleIndex, display };
}
export const validMatchId = (v: unknown): v is string =>
  typeof v === "string" && /^[\x21-\x7e]{1,64}$/.test(v);
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: typeof EDIT,
  match: string,
  round: number,
  command: MachineCommand,
];
export type IncredibleFuseEntry =
  ManagementEntry<IncredibleFuseSettings> | PlayEntry;
const payloads = {
  name: validName,
  avatar: isAvatar,
  settings: (raw: unknown) => parseSettings(raw) !== undefined,
  capacity: CAPACITY,
};
export function isIncredibleFuseEntry(
  raw: unknown,
): raw is IncredibleFuseEntry {
  if (isManagementEntry(raw, payloads))
    return raw[2] !== BOT && (raw[2] !== ACTION || validMatchId(raw[4]));
  return (
    Array.isArray(raw) &&
    raw.length === 6 &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    raw[2] === EDIT &&
    validMatchId(raw[3]) &&
    raw[4] === 1 &&
    validCommand(raw[5])
  );
}
export interface FinishedPlayer {
  id: string;
  name: string;
  slot: number;
  finished: boolean;
}
export interface RoundRecord {
  round: number;
  tick: number;
  durationTicks: number;
  finishers: string[];
  players: FinishedPlayer[];
}
export type IncredibleFuseEvent = { type: "solved"; puzzle: number };
export interface IncredibleFuseRoom extends ManagedRoom<IncredibleFuseSettings> {
  tick: number;
  matchId: string;
  round: 1;
  stage: "lobby" | "running" | "over";
  roundStartTick: number;
  machine: Machine;
  history: RoundRecord[];
}
export function createRoom(
  matchId: string,
  settings: IncredibleFuseSettings,
  initialize = createMachine,
): IncredibleFuseRoom {
  return {
    tick: 0,
    matchId,
    round: 1,
    stage: "lobby",
    roundStartTick: 0,
    seats: new Map(),
    settings: { ...settings },
    machine: initialize(settings.puzzleIndex),
    history: [],
  };
}
export function players(room: IncredibleFuseRoom): SeatRecord[] {
  return [...room.seats.values()]
    .filter((s) => !s.watcher)
    .sort((a, b) => a.slot - b.slot);
}
function reset(
  room: IncredibleFuseRoom,
  matchId: string,
  stage: "lobby" | "running",
  initialize: typeof createMachine,
) {
  room.matchId = matchId;
  room.stage = stage;
  room.roundStartTick = stage === "lobby" ? 0 : room.tick + 1;
  room.machine = initialize(room.settings.puzzleIndex);
  room.history = [];
}
export function machineLifecycle(
  initialize: typeof createMachine,
): LifecycleHooks<IncredibleFuseRoom, IncredibleFuseSettings> {
  function start(room: IncredibleFuseRoom, matchId: string) {
    if (players(room).some((s) => s.connected && !s.bot))
      reset(room, matchId, "running", initialize);
  }
  return {
    stage: (room) => room.stage,
    maxWatchers: MAX_WATCHERS,
    parseSettings,
    start,
    rematch: start,
    lobby: (room, id) => reset(room, id, "lobby", initialize),
  };
}
const standardLifecycle = machineLifecycle(createMachine);

/** Management first, then each connected builder in slot order. Run physics once after all edits at this tick. */
export function foldTick(
  room: IncredibleFuseRoom,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<IncredibleFuseEntry>>,
  lifecycle = standardLifecycle,
): IncredibleFuseEvent[] {
  const tick = room.tick + 1;
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  room.tick = tick;
  if (room.stage !== "running") return [];
  const seats = players(room);
  for (const seat of seats) {
    if (!seat.connected || seat.bot) continue;
    const current = streams.get(seat.id);
    const entries = entriesForGeneration(current, seat.generation);
    for (const entry of entries) {
      if (
        entry[1] === tick &&
        entry[2] === EDIT &&
        entry[3] === room.matchId &&
        entry[4] === room.round
      )
        applyMachine(room.machine, entry[5]);
    }
  }
  stepMachine(room.machine);
  if (room.machine.mode !== "solved") return [];
  room.stage = "over";
  const roster = seats.map(({ id, name, slot, connected }) => ({
    id,
    name,
    slot,
    finished: connected,
  }));
  room.history = [
    {
      round: 1,
      tick,
      durationTicks: tick - room.roundStartTick,
      players: roster,
      finishers: roster
        .filter((s) => s.finished)
        .map((s) => s.id)
        .sort(),
    },
  ];
  return [{ type: "solved", puzzle: room.machine.puzzle }];
}
