import {
  ACTION,
  BOT,
  JOIN,
  PRESENCE,
  SPECTATOR,
  applyManagementTick,
  isManagementEntry,
  memberId,
  roomManager,
  uint32,
  type LifecycleHooks,
  type ManagedRoom,
  type ManagementEntry,
  type SeatRecord,
  type Stage,
  type StreamEntries,
} from "fuse-netcode";
import type { HistoryReceipt } from "fuse-platform/history-api";
import {
  botControl,
  createMission,
  SIM_HZ,
  stepMission,
  type MissionState,
} from "../sim/index.js";
import { CAMPAIGNS, DOGFIGHTS, defaultLoadout } from "../campaign/index.js";
import {
  CAPACITY,
  MAX_WATCHERS,
  UP,
  DOWN,
  LEFT,
  RIGHT,
  FIRE,
  SPECIAL,
  isBotId,
  validBits,
  validName,
  parseSettings,
  type CyberfuseSettings,
} from "./basics.js";
import { finishRound } from "./result.js";

export const PLAY = 0,
  ADVANCE = 1;
export const validMatchId = (raw: unknown): raw is string =>
  typeof raw === "string" && /^[\x21-\x7e]{1,64}$/.test(raw);
export const playerKey = (raw: unknown): raw is string =>
  memberId(raw) && !(raw in Object.prototype);
export const isAvatar = (raw: unknown): raw is string => raw === "robot";
export type CyberfuseEntry =
  | ManagementEntry<CyberfuseSettings>
  | [number, number, typeof PLAY, string, number, number]
  | [number, number, typeof ADVANCE, string, number];
export type CyberfuseEvent = never;
export interface Operative {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
}
export interface CyberfuseRoom extends ManagedRoom<CyberfuseSettings> {
  tick: number;
  matchId: string;
  round: number;
  stage: Stage;
  world: MissionState | null;
  roster: Operative[];
  held: Record<string, { bits: number; generation: number }>;
  mode: CyberfuseSettings["mode"];
  campaign: number;
  history: HistoryReceipt[];
}
export const bySlot = (
  a: { id: string; slot: number },
  b: { id: string; slot: number },
) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const players = (room: CyberfuseRoom) =>
  [...room.seats.values()].filter((s) => !s.watcher).sort(bySlot);
export function isCyberfuseEntry(raw: unknown): raw is CyberfuseEntry {
  if (
    isManagementEntry(raw, {
      name: validName,
      avatar: isAvatar,
      settings: (v) => !!parseSettings(v),
      capacity: CAPACITY,
    })
  ) {
    if (raw[2] === ACTION) return validMatchId(raw[4]);
    const id =
      raw[2] === BOT || raw[2] === SPECTATOR
        ? raw[4]
        : raw[2] <= PRESENCE
          ? raw[3]
          : undefined;
    if (id !== undefined && !playerKey(id)) return false;
    if (raw[2] === BOT) return typeof id === "string" && isBotId(id);
    if (raw[2] === JOIN || raw[2] === SPECTATOR)
      return typeof id === "string" && !isBotId(id);
    return true;
  }
  return (
    Array.isArray(raw) &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    validMatchId(raw[3]) &&
    uint32(raw[4]) &&
    raw[4] > 0 &&
    ((raw[2] === PLAY && raw.length === 6 && validBits(raw[5])) ||
      (raw[2] === ADVANCE && raw.length === 5))
  );
}
export function seedFor(match: string, round: number): number {
  let hash = 2166136261;
  for (const char of match + "#" + round)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
export function createRoom(
  matchId: string,
  settings: CyberfuseSettings,
): CyberfuseRoom {
  return {
    tick: 0,
    matchId,
    settings: { ...settings },
    stage: "lobby",
    round: 0,
    seats: new Map(),
    world: null,
    held: {},
    roster: [],
    mode: settings.mode,
    campaign: settings.campaign ?? 0,
    history: [],
  };
}
function begin(room: CyberfuseRoom): void {
  const index = room.mode === "campaign" ? room.round - 1 : room.campaign;
  const mission =
    room.mode === "campaign"
      ? CAMPAIGNS[room.campaign]!.missions[index]!
      : DOGFIGHTS[index]!;
  const selected = (room.settings.loadout ?? []).filter((id) =>
    mission.allowedWeapons.includes(id),
  );
  const loadouts = Object.fromEntries(
    room.roster.map((p, i) => [
      p.id,
      selected.length ? selected : defaultLoadout(i, mission),
    ]),
  );
  room.held = {};
  room.world = createMission(
    seedFor(room.matchId, room.round),
    room.roster.map((p) => p.id),
    room.mode,
    index,
    { campaign: room.campaign, loadouts },
  );
  room.stage = "running";
}
function start(room: CyberfuseRoom, matchId: string) {
  const roster: Operative[] = players(room)
    .filter((s) => s.connected || s.bot)
    .map(({ id, name, bot, slot }) => ({ id, name, bot, slot }));
  if (!roster.length || room.history.some((h) => h.result.matchId === matchId))
    return;
  room.mode = room.settings.mode;
  room.campaign = room.settings.campaign ?? 0;
  if (room.mode === "dogfight" && roster.length === 1) {
    let n = 1;
    while (room.seats.has("bot:" + n)) n++;
    roster.push({
      id: "bot:" + n,
      name: "Sparring drone",
      bot: true,
      slot: (roster[0]!.slot + 1) % CAPACITY,
    });
    roster.sort(bySlot);
  }
  room.roster = roster;
  room.matchId = matchId;
  room.round = 1;
  begin(room);
}
const lifecycle: LifecycleHooks<CyberfuseRoom, CyberfuseSettings> = {
  stage: (r) => r.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  start,
  rematch: start,
  lobby(room, matchId) {
    Object.assign(room, {
      matchId,
      round: 0,
      stage: "lobby",
      world: null,
      held: {},
      roster: [],
    });
  },
};
/** DPMI timer interrupts drive 70 game updates per second. Deriving the phase from the log tick also restores it on rollback. */
export const clockAt = (logTick: number) => Math.floor((logTick * SIM_HZ) / 20);
const controls = (bits: number) => ({
  dx: Number(!!(bits & RIGHT)) - Number(!!(bits & LEFT)),
  dy: Number(!!(bits & DOWN)) - Number(!!(bits & UP)),
  fire: !!(bits & FIRE),
  special: !!(bits & SPECIAL),
});
function ownEntries(
  id: string,
  seat: SeatRecord | undefined,
  streams: ReadonlyMap<string, StreamEntries<CyberfuseEntry>>,
  tick: number,
) {
  const stream = streams.get(id);
  const batch =
    stream?.generation === seat?.generation
      ? stream
      : stream?.retired?.find((old) => old.generation === seat?.generation);
  return batch?.entries.filter((e) => e[1] === tick) ?? [];
}
export function foldTick(
  room: CyberfuseRoom,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<CyberfuseEntry>>,
): never[] {
  const tick = room.tick + 1;
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  if (room.stage === "between") {
    const manager = roomManager(room.seats.values(), creatorId);
    for (const id of new Set([creatorId, manager])) {
      const seat = room.seats.get(id);
      const stream = streams.get(id);
      const entries = seat
        ? ownEntries(id, seat, streams, tick)
        : (stream?.entries ?? []);
      if (
        entries.some(
          (e) =>
            e[1] === tick &&
            e[2] === ADVANCE &&
            e[3] === room.matchId &&
            e[4] === room.round,
        )
      ) {
        room.round++;
        begin(room);
        break;
      }
    }
  }
  if (room.stage === "running" && room.world) {
    // Presence and generation changes cancel a held control before a new stream can contribute.
    for (const p of room.roster) {
      const seat = room.seats.get(p.id);
      if (
        !seat?.connected ||
        seat.bot ||
        room.held[p.id]?.generation !== seat.generation
      )
        delete room.held[p.id];
      if (!seat?.connected || seat.bot) continue;
      for (const e of ownEntries(p.id, seat, streams, tick)) {
        if (e[2] === PLAY && e[3] === room.matchId && e[4] === room.round)
          room.held[p.id] = { bits: e[5], generation: seat.generation! };
      }
    }
    for (let i = clockAt(room.tick); i < clockAt(tick); i++) {
      const world: MissionState = room.world;
      const inputs = Object.fromEntries(
        room.roster.map((p) => [
          p.id,
          p.bot || !room.seats.get(p.id)?.connected
            ? botControl(world, p.id)
            : controls(room.held[p.id]?.bits ?? 0),
        ]),
      );
      room.world = stepMission(world, inputs);
      if (room.world.outcome !== "playing") {
        finishRound(room, tick);
        break;
      }
    }
  }
  room.tick = tick;
  return [];
}
