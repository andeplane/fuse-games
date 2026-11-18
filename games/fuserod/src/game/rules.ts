import {
  applyManagementTick,
  isManagementEntry,
  uint32,
  type LifecycleHooks,
  type ManagedRoom,
  type ManagementEntry,
  type SeatRecord,
  type StreamEntries,
} from "fuse-netcode";
import type { HistoryReceipt } from "fuse-platform/history-api";
import {
  CAPACITY,
  finishUnits,
  isBotId,
  isDirection,
  matchId,
  metres,
  parseSettings,
  released,
  validId,
  validName,
  type Direction,
  type FuserodSettings,
} from "./basics.js";
import { advanceRace, createRace, racerViews, type Race } from "./race.js";
import { raceResult } from "./result.js";
import type { FuserodStats } from "./history-stats.js";
export { seatName } from "./basics.js";
export type FuserodEntry =
  | ManagementEntry<FuserodSettings>
  | [
      seq: number,
      tick: number,
      kind: 0,
      match: string,
      throttle: boolean,
      brake: boolean,
      steer: Direction,
      shift: Direction,
    ];
export interface FuserodRoom extends ManagedRoom<FuserodSettings> {
  tick: number;
  matchId: string;
  stage: "lobby" | "running" | "over";
  race: Race | null;
  history: HistoryReceipt<FuserodStats>[];
}
export const isAvatar = (v: unknown): v is "robot" => v === "robot";
export function isEntry(raw: unknown): raw is FuserodEntry {
  if (
    isManagementEntry(raw, {
      name: validName,
      avatar: isAvatar,
      settings: (v) => !!parseSettings(v),
      capacity: CAPACITY,
    })
  ) {
    switch (raw[2]) {
      case 10:
      case 11:
      case 12:
        return validId(raw[3]) && !isBotId(raw[3]);
      case 14:
        return matchId(raw[4]);
      case 15:
        return isBotId(raw[4]);
      case 16:
        return validId(raw[4]) && !isBotId(raw[4]);
      default:
        return true;
    }
  }
  return (
    Array.isArray(raw) &&
    raw.length === 8 &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    raw[2] === 0 &&
    matchId(raw[3]) &&
    typeof raw[4] === "boolean" &&
    typeof raw[5] === "boolean" &&
    isDirection(raw[6]) &&
    isDirection(raw[7])
  );
}
export function seats(room: FuserodRoom): SeatRecord[] {
  return [...room.seats.values()].sort((a, b) => a.slot - b.slot);
}
export function createRoom(
  matchId: string,
  settings: FuserodSettings,
): FuserodRoom {
  return {
    matchId,
    settings: { ...settings },
    seats: new Map(),
    tick: 0,
    stage: "lobby",
    race: null,
    history: [],
  };
}
function start(room: FuserodRoom, id: string): void {
  const drivers = seats(room).filter((s) => s.connected && !s.watcher);
  if (
    !drivers.length ||
    (room.settings.variant === "timed" && drivers.every((s) => s.bot))
  )
    return;
  room.matchId = id;
  room.stage = "running";
  room.race = createRace(drivers, room.settings, room.tick + 1, id);
}
const hooks: LifecycleHooks<FuserodRoom, FuserodSettings> = {
  stage: (r) => r.stage,
  parseSettings,
  maxWatchers: 0,
  start,
  rematch: start,
  lobby(room, id) {
    room.matchId = id;
    room.stage = "lobby";
    room.race = null;
  },
};
export function foldTick(
  room: FuserodRoom,
  creator: string,
  streams: ReadonlyMap<string, StreamEntries<FuserodEntry>>,
): never[] {
  const tick = room.tick + 1;
  const generations = new Map(
    [...room.seats].map(([id, s]) => [id, s.generation]),
  );
  applyManagementTick(room, tick, creator, streams, hooks);
  const race = room.race;
  if (race && room.stage === "running") {
    for (const racer of race.racers) {
      if (racer.bot) continue;
      const seat = room.seats.get(racer.id);
      if (!seat?.connected || seat.generation !== generations.get(racer.id)) {
        racer.input = released();
        racer.motor.pendingShift = 0;
      }
      if (!seat?.connected) continue;
      const stream = streams.get(racer.id);
      const source =
        stream?.generation === seat.generation
          ? stream
          : stream?.retired?.find((s) => s.generation === seat.generation);
      for (const e of source?.entries ?? []) {
        if (e[1] !== tick || e[2] !== 0 || e[3] !== room.matchId) continue;
        // Multiple changes can share a tick. A release of the pedal must not erase a gear tap.
        racer.input = {
          throttle: e[4],
          brake: e[5],
          steer: e[6],
          shift: e[7] || racer.input.shift,
        };
      }
    }
    advanceRace(race);
    if (race.ended) {
      room.stage = "over";
      const finishers = race.racers
        .filter((r) => !r.bot && room.seats.get(r.id)?.connected)
        .map((r) => r.id)
        .sort();
      const result = raceResult(race, room.matchId, finishers);
      room.history.push(
        {
          tick,
          result: {
            ...result,
            round: 1,
            roundDuration: {
              version: 1,
              ticks: race.elapsed - race.treeTicks,
            },
          },
        },
        { tick, result },
      );
      room.history = room.history.slice(-8);
    }
  }
  room.tick = tick;
  return [];
}
export function fuserodView(room: FuserodRoom) {
  const { race } = room;
  const { route, variant } = race?.settings ?? room.settings;
  return {
    tick: room.tick,
    matchId: room.matchId,
    phase: room.stage,
    round: 1 as const,
    players: seats(room).map((s) => ({ ...s })),
    racers: race ? racerViews(race) : [],
    countdown: race ? Math.max(0, race.treeTicks - race.elapsed) : 0,
    raceTicks: race ? Math.max(0, race.elapsed - race.treeTicks) : 0,
    finishDistance: metres(finishUnits(route, variant)),
    route,
    variant,
    policePhase: race?.police.phase ?? 0,
    winnerId: race?.winnerId ?? null,
    history: structuredClone(room.history),
  };
}
export type FuserodView = ReturnType<typeof fuserodView>;
