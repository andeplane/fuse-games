import { decodeTraffic } from "./traffic.js";
import { uint32, type SeatRecord } from "fuse-netcode";
import { parseHistoryReceipts } from "fuse-platform/history-api";
import { motorGears, isMotorState } from "../motor/index.js";
import {
  CAPACITY,
  COUNTDOWN_TICKS,
  courseLayout,
  finishUnits,
  MAX_RACE_TICKS,
  integer,
  isBotId,
  isDirection,
  matchId,
  object,
  parseSettings,
  validId,
  validName,
} from "./basics.js";
import { createRoom, isAvatar, seats, type FuserodRoom } from "./rules.js";
import { parseFuserodStats } from "./history-stats.js";
import {
  seedForMatch,
  treeDuration,
  retired,
  soloFinish,
  greenTick,
  brokeOut,
  raceLimit,
  type Race,
  type Racer,
} from "./race.js";

function encodeSeat(s: SeatRecord) {
  return [
    s.id,
    s.name,
    s.slot,
    s.bot,
    s.connected,
    s.generation ?? null,
    s.away ?? false,
    s.avatarId,
  ];
}
function decodeSeat(v: unknown): SeatRecord | undefined {
  if (!Array.isArray(v) || v.length !== 8) return;
  const [id, name, slot, bot, connected, generation, away, avatarId] = v;
  if (
    !validId(id) ||
    !validName(name) ||
    !integer(slot, 0, CAPACITY - 1) ||
    typeof bot !== "boolean" ||
    bot !== isBotId(id) ||
    typeof connected !== "boolean" ||
    typeof away !== "boolean" ||
    !isAvatar(avatarId)
  )
    return;
  if (
    bot
      ? generation !== null || !connected || away
      : !uint32(generation) || (away && connected)
  )
    return;
  return {
    id,
    name,
    slot,
    bot,
    connected,
    avatarId,
    ...(bot ? {} : { generation }),
    ...(away ? { away: true } : {}),
  };
}
function decodeRacer(v: unknown): Racer | undefined {
  if (!object(v) || Object.keys(v).length !== 13) return;
  const {
    id,
    name,
    slot,
    bot,
    x,
    input,
    motor,
    bank,
    crashed,
    laneFault,
    falseStart,
    stagedFirst,
    finishTicks,
  } = v;
  if (
    !validId(id) ||
    !validName(name) ||
    !integer(slot, 0, CAPACITY - 1) ||
    typeof bot !== "boolean" ||
    bot !== isBotId(id) ||
    !integer(x, -1450, 1450) ||
    !integer(bank, -48, 30) ||
    typeof crashed !== "boolean" ||
    typeof laneFault !== "boolean" ||
    typeof falseStart !== "boolean" ||
    typeof stagedFirst !== "boolean" ||
    !integer(finishTicks, 0, MAX_RACE_TICKS) ||
    !object(input) ||
    Object.keys(input).length !== 4 ||
    typeof input.throttle !== "boolean" ||
    typeof input.brake !== "boolean" ||
    !isDirection(input.steer) ||
    !isDirection(input.shift) ||
    !isMotorState(motor)
  )
    return;
  return {
    id,
    name,
    slot,
    bot,
    x,
    input: {
      throttle: input.throttle,
      brake: input.brake,
      steer: input.steer,
      shift: input.shift,
    },
    motor: structuredClone(motor),
    bank,
    crashed,
    laneFault,
    falseStart,
    stagedFirst,
    finishTicks,
  };
}
function decodeRace(v: unknown, room: FuserodRoom): Race | undefined {
  if (!object(v) || Object.keys(v).length !== 10) return;
  const {
    layout,
    startTick,
    treeTicks,
    police,
    elapsed,
    ended,
    winnerId,
    racers: raw,
    settings: rawSettings,
    traffic: rawTraffic,
  } = v;
  const settings = parseSettings(rawSettings);
  if (
    !settings ||
    !integer(layout, 0, 9) ||
    layout !== courseLayout(settings.route, seedForMatch(room.matchId)) ||
    !integer(treeTicks, 1, COUNTDOWN_TICKS) ||
    treeTicks !== treeDuration(settings.variant, seedForMatch(room.matchId)) ||
    !object(police) ||
    Object.keys(police).length !== 2 ||
    !integer(police.phase, 0, 4) ||
    !integer(police.position, 0, 37760) ||
    !integer(startTick, 1, room.tick) ||
    !integer(elapsed, 1, COUNTDOWN_TICKS + MAX_RACE_TICKS) ||
    elapsed > room.tick - startTick + 1 ||
    typeof ended !== "boolean" ||
    ended !== (room.stage === "over") ||
    (!ended && elapsed !== room.tick - startTick + 1) ||
    !Array.isArray(raw) ||
    raw.length < 1 ||
    raw.length > CAPACITY
  )
    return;
  const racers: Racer[] = [];
  for (const next of raw) {
    const r = decodeRacer(next);
    if (!r || racers.some((other) => other.id === r.id || other.slot >= r.slot))
      return;
    if (!ended) {
      const seat = room.seats.get(r.id);
      if (!seat || seat.slot !== r.slot || seat.bot !== r.bot) return;
    }
    if (
      (settings.route !== "aqueduct" && r.bank !== 0) ||
      r.motor.gear >
        motorGears(r.bot ? { gearbox: settings.opponent } : settings) ||
      (settings.variant === "timed" && r.bot) ||
      ((r.laneFault || r.falseStart || r.stagedFirst) &&
        settings.variant !== "timed" &&
        settings.variant !== "grudge")
    )
      return;
    racers.push(r);
  }
  const seed = seedForMatch(room.matchId);
  const patrol =
    settings.route === "canyon" &&
    !settings.king &&
    racers.filter((r) => !r.bot).length === 1 &&
    racers.some((r) => r.bot) &&
    seed % 4 === 0;
  if (
    police.position !== (patrol ? (110 + ((seed >>> 8) % 240)) * 64 : 0) ||
    (!patrol && police.phase !== 0) ||
    (winnerId !== null && !validId(winnerId))
  )
    return;
  const traffic = decodeTraffic(rawTraffic, settings.route, seed);
  if (!traffic) return;
  const race: Race = {
    layout,
    traffic,
    settings,
    startTick,
    treeTicks,
    elapsed,
    ended,
    winnerId,
    racers,
    police: {
      phase: police.phase as Race["police"]["phase"],
      position: police.position,
    },
  };
  const finish = finishUnits(settings.route, settings.variant);
  for (const r of racers) {
    if (
      r.motor.position >= finish !== r.finishTicks > 0 ||
      (r.finishTicks &&
        (retired(r) || r.finishTicks > elapsed - greenTick(race, r))) ||
      (elapsed <= greenTick(race, r) &&
        (r.motor.position !== 0 || (r.bot && r.motor.steps !== 0)))
    )
      return;
  }
  const eligible = racers.filter((r) => !retired(r) && !brokeOut(race, r));
  const original = soloFinish(race);
  const winner = eligible.find((r) => r.id === winnerId);
  const finished = eligible.some((r) => r.finishTicks > 0);
  const forfeit = racers.length > 1 && eligible.length === 1;
  if (
    elapsed > treeTicks + raceLimit(race) ||
    (original && police.phase !== 4 && winnerId !== original) ||
    (!original &&
      winnerId !== null &&
      (!winner || (!winner.finishTicks && !forfeit))) ||
    (winnerId !== null) !==
      (police.phase !== 4 && (finished || forfeit || !!original)) ||
    ended !==
      (!!winnerId ||
        police.phase === 4 ||
        !eligible.length ||
        elapsed === treeTicks + raceLimit(race)) ||
    (ended && elapsed <= treeTicks && !racers.some((r) => r.falseStart))
  )
    return;
  return race;
}
export function encodeRoom(r: FuserodRoom): unknown[] {
  return [
    r.matchId,
    r.stage,
    structuredClone(r.settings),
    seats(r).map(encodeSeat),
    structuredClone(r.race),
    structuredClone(r.history),
  ];
}
export function decodeRoom(
  fields: readonly unknown[],
  tick: number,
): FuserodRoom | undefined {
  if (fields.length !== 6 || !uint32(tick)) return;
  const [id, stage, rawSettings, rawSeats, race, rawHistory] = fields;
  const settings = parseSettings(rawSettings);
  const history = parseHistoryReceipts(
    rawHistory,
    tick,
    parseFuserodStats,
    validId,
    isBotId,
    8,
  );
  if (
    !settings ||
    !history ||
    history.length % 2 !== 0 ||
    !matchId(id) ||
    (stage !== "running" && stage !== "lobby" && stage !== "over") ||
    !Array.isArray(rawSeats) ||
    rawSeats.length > CAPACITY
  )
    return;
  for (let i = 0; i < history.length; i += 2) {
    const round = history[i]!,
      match = history[i + 1]!;
    const { round: roundIndex, roundDuration, ...summary } = round.result;
    if (
      roundIndex !== 1 ||
      roundDuration?.ticks !== round.result.players[0]?.raceTicks ||
      round.tick !== match.tick ||
      JSON.stringify(summary) !== JSON.stringify(match.result)
    )
      return;
  }
  const room = createRoom(id, settings);
  room.tick = tick;
  room.stage = stage;
  room.history = history;
  const slots = new Set<number>();
  for (const raw of rawSeats) {
    const seat = decodeSeat(raw);
    if (!seat || room.seats.has(seat.id) || slots.has(seat.slot)) return;
    slots.add(seat.slot);
    room.seats.set(seat.id, seat);
  }
  if (stage === "lobby") {
    if (race !== null) return;
  } else {
    const decoded = decodeRace(race, room);
    if (!decoded) return;
    room.race = decoded;
    if (stage === "over") {
      const decision = history.at(-1);
      if (
        decision?.result.matchId !== id ||
        decision.tick !== decoded.startTick + decoded.elapsed - 1 ||
        decision.result.winnerId !== (decoded.winnerId ?? undefined)
      )
        return;
    }
  }
  return room;
}
/** Canonical object keys keep the hash independent of MessagePack map/key insertion order. */
export function hashRoom(room: FuserodRoom): string {
  const text = JSON.stringify(
    [room.tick, ...encodeRoom(room)],
    (_key: string, v: unknown) =>
      object(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, v[k]]),
          )
        : v,
  );
  let a = 0x811c9dc5,
    b = 0x12345678;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(i), 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
