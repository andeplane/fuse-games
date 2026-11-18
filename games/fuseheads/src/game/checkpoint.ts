import { uint32, type SeatRecord, type Stage } from "fuse-netcode";
import {
  parseHistoryPlayer,
  parseHistoryReceipts,
} from "fuse-platform/history-api";
import { levelCount } from "../levels/index.js";
import { validWorld } from "./simulation.js";
import {
  BETWEEN_TICKS,
  CAPACITY,
  MAX_RECEIPTS,
  MAX_WATCHERS,
  clockAt,
  isAvatar,
  parseSettings,
  parseSave,
  playerKey,
  validMask,
  validMatchId,
  validName,
  type FuseheadsRoom,
  type Participant,
} from "./rules.js";

export function encodeRoom(room: FuseheadsRoom): unknown[] {
  const seats = [...room.seats.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  return [
    [room.matchId, room.round, room.stage, room.resumeAt, room.pendingSave],
    { ...room.settings },
    seats.map((s) => [
      s.id,
      s.name,
      s.slot,
      s.avatarId,
      s.connected,
      !!s.watcher,
      s.generation,
      !!s.away,
    ]),
    room.participants.map((p) => [
      p.id,
      p.name,
      p.slot,
      p.generation,
      p.mask,
      [...p.pending],
      p.initialScore,
    ]),
    room.world && structuredClone(room.world),
    structuredClone(room.receipts),
  ];
}
const slot = (v: unknown): v is number => uint32(v) && v < CAPACITY;
function readSeats(raw: unknown): Map<string, SeatRecord> | undefined {
  if (!Array.isArray(raw) || raw.length > CAPACITY + MAX_WATCHERS) return;
  const seats = new Map<string, SeatRecord>(),
    slots = new Set<number>();
  let watchers = 0;
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 8) return;
    const [id, name, index, avatarId, connected, watcher, generation, away] =
      item;
    if (
      !playerKey(id) ||
      seats.has(id) ||
      !validName(name) ||
      typeof connected !== "boolean" ||
      typeof watcher !== "boolean" ||
      !uint32(generation) ||
      typeof away !== "boolean" ||
      (away && connected)
    )
      return;
    if (watcher) {
      if (index !== -1 || avatarId !== "" || ++watchers > MAX_WATCHERS) return;
    } else {
      if (!slot(index) || slots.has(index) || !isAvatar(avatarId)) return;
      slots.add(index);
    }
    seats.set(id, {
      id,
      name,
      slot: index,
      avatarId,
      connected,
      bot: false,
      generation,
      ...(watcher ? { watcher: true } : {}),
      ...(away ? { away: true } : {}),
    });
  }
  return seats;
}
function readParticipants(raw: unknown): Participant[] | undefined {
  if (!Array.isArray(raw) || raw.length > CAPACITY) return;
  const out: Participant[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 7) return;
    const [id, name, index, generation, mask, pending, initialScore] = item;
    if (
      !playerKey(id) ||
      out.some((p) => p.id === id) ||
      !validName(name) ||
      !slot(index) ||
      index <= (out.at(-1)?.slot ?? -1) ||
      !uint32(generation) ||
      !validMask(mask) ||
      !Array.isArray(pending) ||
      pending.length > 2 ||
      !pending.every(validMask) ||
      !uint32(initialScore)
    )
      return;
    out.push({
      id,
      name,
      slot: index,
      generation,
      mask,
      pending: [...pending],
      initialScore,
    });
  }
  return out;
}
const stages: readonly Stage[] = ["lobby", "running", "between", "over"];
export function decodeRoom(
  fields: readonly unknown[],
  tick: number,
  localContinuation = false,
): FuseheadsRoom | undefined {
  if (!uint32(tick) || fields.length !== 6) return;
  const [header, rawSettings, rawSeats, rawParticipants, world, rawReceipts] =
    fields;
  if (!Array.isArray(header) || header.length !== 5) return;
  const [matchId, round, stage, resumeAt, rawSave] = header;
  const pendingSave = rawSave === null ? null : parseSave(rawSave);
  if (
    pendingSave === undefined ||
    (pendingSave && (!localContinuation || stage !== "lobby"))
  )
    return;
  if (
    !validMatchId(matchId) ||
    !uint32(round) ||
    round < 1 ||
    !stages.includes(stage) ||
    !uint32(resumeAt)
  )
    return;
  const settings = parseSettings(rawSettings),
    seats = readSeats(rawSeats),
    participants = readParticipants(rawParticipants);
  if (!settings || !seats || !participants) return;
  const receipts = parseHistoryReceipts(
    rawReceipts,
    clockAt(tick),
    parseHistoryPlayer,
    playerKey,
    () => false,
    MAX_RECEIPTS,
  );
  if (!receipts || receipts.some((r) => r.result.players.length > CAPACITY))
    return;
  if (world !== null && !validWorld(world)) return;
  if (stage === "lobby") {
    if (world || participants.length || round !== 1 || resumeAt !== 0) return;
  } else {
    if (
      !world ||
      world.levelIndex !== round - 1 ||
      round > levelCount(world.pack) ||
      !participants.length ||
      world.players.length !== participants.length ||
      !participants.every((p) => world.players.some((s) => s.slot === p.slot))
    )
      return;
    if ((stage === "running") !== (world.outcome === "playing")) return;
    if (
      stage === "running" &&
      !participants.every((p) => {
        const s = seats.get(p.id);
        return s && !s.watcher && s.slot === p.slot;
      })
    )
      return;
    if (stage === "between") {
      if (
        world.outcome !== "cleared" ||
        round >= levelCount(world.pack) ||
        resumeAt === 0 ||
        resumeAt > tick + BETWEEN_TICKS
      )
        return;
    } else if (
      resumeAt !== 0 ||
      (stage === "over" &&
        world.outcome === "cleared" &&
        round < levelCount(world.pack))
    )
      return;
  }
  return {
    pendingSave,
    tick,
    matchId,
    round,
    stage,
    resumeAt,
    settings,
    seats,
    participants,
    world: world && structuredClone(world),
    receipts,
  };
}
export function hashRoom(room: FuseheadsRoom): string {
  const text = JSON.stringify(
    [room.tick, ...encodeRoom(room)],
    (_key, value: unknown) => {
      if (value && typeof value === "object" && !Array.isArray(value))
        return Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
        );
      return value;
    },
  );
  let a = 0x811c9dc5,
    b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (
    (a >>> 0).toString(16).padStart(8, "0") +
    (b >>> 0).toString(16).padStart(8, "0")
  );
}
