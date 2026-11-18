import { uint32, type SeatRecord } from "fuse-netcode";
import { decodeBattle } from "./simulation.js";
import {
  CAPACITY,
  MAX_WATCHERS,
  isAvatar,
  isBotId,
  parseSettings,
  playerKey,
  validMatchId,
  validName,
  type Fighter,
  type FuseParticlesRoom,
} from "./rules.js";

export function encodeRoom(room: FuseParticlesRoom): unknown[] {
  const seats = [...room.seats.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((seat) => [
      seat.id,
      seat.name,
      seat.slot,
      seat.avatarId,
      seat.connected,
      seat.bot,
      Boolean(seat.watcher),
      Boolean(seat.away),
      seat.generation ?? null,
    ]);
  return [
    room.matchId,
    room.stage,
    room.settings,
    seats,
    room.fighters.map((f) => [f.id, f.name, f.slot, f.bot]),
    room.battle,
    room.decidedTick,
    room.finishers,
  ];
}

function decodeFighter(raw: unknown): Fighter | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return;
  const [id, name, slot, bot] = raw;
  if (
    !playerKey(id) ||
    !validName(name) ||
    !uint32(slot) ||
    slot >= CAPACITY ||
    typeof bot !== "boolean" ||
    isBotId(id) !== bot
  )
    return;
  return { id, name, slot, bot };
}

function decodeSeat(raw: unknown): SeatRecord | undefined {
  if (!Array.isArray(raw) || raw.length !== 9) return;
  const [id, name, slot, avatarId, connected, bot, watcher, away, generation] =
    raw;
  if (
    !playerKey(id) ||
    !validName(name) ||
    typeof connected !== "boolean" ||
    typeof away !== "boolean" ||
    typeof watcher !== "boolean" ||
    typeof bot !== "boolean" ||
    bot !== isBotId(id) ||
    (away && (connected || bot)) ||
    (bot ? generation !== null : !uint32(generation))
  )
    return;
  if (
    watcher
      ? slot !== -1 || avatarId !== "" || bot
      : !uint32(slot) || slot >= CAPACITY || !isAvatar(avatarId)
  )
    return;
  return {
    id,
    name,
    slot,
    avatarId,
    connected,
    bot,
    ...(watcher ? { watcher } : {}),
    ...(away ? { away } : {}),
    ...(generation === null ? {} : { generation }),
  };
}

export function decodeRoom(
  raw: unknown,
  tick: number,
): FuseParticlesRoom | undefined {
  if (!Array.isArray(raw) || raw.length !== 8 || !uint32(tick)) return;
  const [
    matchId,
    stage,
    config,
    rawSeats,
    rawFighters,
    rawBattle,
    decidedTick,
    finishers,
  ] = raw;
  const settings = parseSettings(config);
  if (
    !validMatchId(matchId) ||
    !settings ||
    !(stage === "lobby" || stage === "running" || stage === "over") ||
    !Array.isArray(rawSeats) ||
    rawSeats.length > CAPACITY + MAX_WATCHERS ||
    !Array.isArray(rawFighters) ||
    rawFighters.length > CAPACITY ||
    !Array.isArray(finishers) ||
    finishers.length > CAPACITY ||
    new Set(finishers).size !== finishers.length ||
    !uint32(decidedTick) ||
    decidedTick > tick
  )
    return;
  const seats = new Map<string, SeatRecord>();
  const slots = new Set<number>();
  for (const rawSeat of rawSeats) {
    const seat = decodeSeat(rawSeat);
    if (!seat || seats.has(seat.id) || (!seat.watcher && slots.has(seat.slot)))
      return;
    seats.set(seat.id, seat);
    if (!seat.watcher) slots.add(seat.slot);
  }
  if (seats.size - slots.size > MAX_WATCHERS) return;
  const fighters: Fighter[] = [];
  for (const rawFighter of rawFighters) {
    const fighter = decodeFighter(rawFighter);
    if (
      !fighter ||
      fighters.some((f) => f.id === fighter.id) ||
      fighter.slot <= (fighters.at(-1)?.slot ?? -1)
    )
      return;
    fighters.push(fighter);
  }
  if (!finishers.every((id) => fighters.some((f) => !f.bot && f.id === id)))
    return;
  const battle = rawBattle === null ? null : decodeBattle(rawBattle);
  if (battle === undefined) return;
  if (stage === "lobby") {
    if (battle || fighters.length || finishers.length || decidedTick) return;
  } else {
    if (
      !battle ||
      fighters.length < 2 ||
      battle.cores.length !== fighters.length ||
      fighters.every((f) => f.bot)
    )
      return;
    if (
      stage === "running"
        ? battle.winner !== null || decidedTick !== 0 || finishers.length !== 0
        : battle.winner === null || decidedTick === 0
    )
      return;
  }
  return {
    tick,
    round: 1,
    matchId,
    stage,
    settings,
    seats,
    fighters,
    battle,
    decidedTick,
    finishers,
  };
}

export function hashRoom(room: FuseParticlesRoom): string {
  const payload = JSON.stringify([room.tick, ...encodeRoom(room)]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++)
    hash = Math.imul(hash ^ payload.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
