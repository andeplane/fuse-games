import { memberId, uint32, type SeatRecord } from "fuse-netcode";
import {
  CAPACITY,
  MAX_WATCHERS,
  validName,
  isAvatar,
  validMatchId,
  parseSettings,
  type FinishedPlayer,
  type IncredibleFuseRoom,
  type RoundRecord,
} from "./rules.js";
import { FREE_WORKSHOP, validMachine } from "./machine.js";

const plain = (raw: unknown): raw is Record<string, unknown> =>
  raw !== null && typeof raw === "object" && !Array.isArray(raw);
export function orderedSeats(room: IncredibleFuseRoom) {
  return [...room.seats.values()].sort(
    (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : 1),
  );
}
export function encodeRoom(room: IncredibleFuseRoom): unknown[] {
  return [
    room.matchId,
    room.stage,
    room.roundStartTick,
    room.settings,
    orderedSeats(room),
    room.machine,
    room.history,
  ];
}
function decodeSeats(raw: unknown): Map<string, SeatRecord> | undefined {
  if (!Array.isArray(raw) || raw.length > CAPACITY + MAX_WATCHERS) return;
  const seats = new Map<string, SeatRecord>(),
    slots = new Set<number>();
  let watchers = 0;
  for (const item of raw) {
    if (!plain(item)) return;
    const {
      id,
      name,
      slot,
      avatarId,
      connected,
      away,
      watcher,
      generation,
      bot,
    } = item;
    if (
      !memberId(id) ||
      seats.has(id) ||
      !validName(name) ||
      typeof connected !== "boolean" ||
      bot !== false ||
      !uint32(generation) ||
      (away !== undefined && (away !== true || connected)) ||
      (watcher !== undefined && watcher !== true)
    )
      return;
    if (watcher) {
      if (slot !== -1 || avatarId !== "" || ++watchers > MAX_WATCHERS) return;
    } else if (
      !uint32(slot) ||
      slot >= CAPACITY ||
      slots.has(slot) ||
      !isAvatar(avatarId)
    )
      return;
    else slots.add(slot);
    seats.set(id, {
      id,
      name,
      slot,
      avatarId,
      connected,
      bot,
      generation,
      ...(watcher ? { watcher } : {}),
      ...(away ? { away } : {}),
    });
  }
  return seats;
}
function record(
  raw: unknown,
  start: number,
  now: number,
): RoundRecord | undefined {
  if (
    !plain(raw) ||
    raw.round !== 1 ||
    !uint32(raw.tick) ||
    raw.tick < start ||
    raw.tick > now ||
    raw.durationTicks !== raw.tick - start ||
    !Array.isArray(raw.players) ||
    !raw.players.length ||
    raw.players.length > CAPACITY ||
    !Array.isArray(raw.finishers)
  )
    return;
  const players: FinishedPlayer[] = [],
    ids = new Set<string>();
  let previous = -1;
  for (const p of raw.players) {
    if (
      !plain(p) ||
      !memberId(p.id) ||
      ids.has(p.id) ||
      !validName(p.name) ||
      !uint32(p.slot) ||
      p.slot >= CAPACITY ||
      p.slot <= previous ||
      typeof p.finished !== "boolean"
    )
      return;
    ids.add(p.id);
    previous = p.slot;
    players.push({
      id: p.id,
      name: p.name,
      slot: p.slot,
      finished: p.finished,
    });
  }
  const finishers = players
    .filter((p) => p.finished)
    .map((p) => p.id)
    .sort();
  if (
    raw.finishers.length !== finishers.length ||
    !finishers.every((id, i) => id === (raw.finishers as unknown[])[i])
  )
    return;
  return {
    round: 1,
    tick: raw.tick,
    durationTicks: raw.tick - start,
    players,
    finishers,
  };
}
export function decodeRoom(
  fields: readonly unknown[],
  tick: number,
  privateWorkshop = false,
): IncredibleFuseRoom | undefined {
  if (fields.length !== 7 || !uint32(tick)) return;
  const [
    matchId,
    stage,
    roundStartTick,
    rawSettings,
    rawSeats,
    machine,
    records,
  ] = fields;
  const settings = parseSettings(rawSettings),
    seats = decodeSeats(rawSeats);
  if (
    !validMatchId(matchId) ||
    !settings ||
    !seats ||
    !uint32(roundStartTick) ||
    roundStartTick > tick ||
    (stage !== "lobby" && stage !== "running" && stage !== "over") ||
    !validMachine(machine) ||
    machine.imported !==
      (privateWorkshop && machine.puzzle === FREE_WORKSHOP) ||
    !Array.isArray(records) ||
    records.length !== (stage === "over" ? 1 : 0) ||
    (stage === "lobby") !== (roundStartTick === 0) ||
    (stage === "over") !== (machine.mode === "solved") ||
    (stage === "lobby" && machine.mode !== "build")
  )
    return;
  const history: RoundRecord[] = [];
  if (stage === "over") {
    const finished = record(records[0], roundStartTick, tick);
    if (!finished) return;
    history.push(finished);
  }
  return {
    tick,
    matchId,
    round: 1,
    stage,
    roundStartTick,
    settings,
    seats,
    machine: structuredClone(machine),
    history,
  };
}

export function hashRoom(room: IncredibleFuseRoom): string {
  const text = JSON.stringify(
    [room.tick, ...encodeRoom(room)],
    (_key, value: unknown) =>
      plain(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
          )
        : value,
  );
  let a = 0x811c9dc5,
    b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x01000193) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
