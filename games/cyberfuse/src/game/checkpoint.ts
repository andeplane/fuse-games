import {
  hashCheckpointJson,
  uint32,
  type SeatRecord,
  type Stage,
} from "fuse-netcode";
import { parseHistoryReceipts } from "fuse-platform/history-api";
import {
  DOGFIGHT_WIN_TARGET,
  MAX_DOGFIGHT_ROUNDS,
  standings,
} from "./result.js";
import { parseCyberfuseStats } from "./stats.js";
import { isMissionState } from "../sim/index.js";
import { CAMPAIGNS, DOGFIGHTS } from "../campaign/index.js";
import {
  CAPACITY,
  MAX_WATCHERS,
  isBotId,
  validName,
  parseSettings,
  plain,
  validBits,
} from "./basics.js";
import {
  armory,
  validLoadout,
  bySlot,
  playerKey,
  validMatchId,
  seedFor,
  type CyberfuseRoom,
  type Operative,
} from "./rules.js";

function decodeOperative(raw: unknown): Operative | undefined {
  if (!plain(raw)) return;
  const { id, name, slot, bot } = raw;
  if (
    !playerKey(id) ||
    !validName(name) ||
    !uint32(slot) ||
    slot >= CAPACITY ||
    typeof bot !== "boolean" ||
    bot !== isBotId(id)
  )
    return;
  return { id, name, slot, bot };
}
function decodeSeat(raw: unknown): SeatRecord | undefined {
  if (
    !plain(raw) ||
    Object.keys(raw).some(
      (k) =>
        ![
          "id",
          "name",
          "slot",
          "avatarId",
          "connected",
          "bot",
          "watcher",
          "generation",
          "away",
        ].includes(k),
    )
  )
    return;
  const {
    id,
    name,
    slot,
    avatarId,
    connected,
    bot,
    watcher,
    generation,
    away,
  } = raw;
  if (
    !playerKey(id) ||
    !validName(name) ||
    typeof connected !== "boolean" ||
    typeof bot !== "boolean" ||
    bot !== isBotId(id) ||
    (watcher !== undefined && watcher !== true) ||
    (away !== undefined && away !== true) ||
    (away && (connected || bot)) ||
    (bot && (!connected || watcher || generation !== undefined)) ||
    (!bot && !uint32(generation)) ||
    typeof slot !== "number" ||
    (watcher ? slot !== -1 : !uint32(slot) || slot >= CAPACITY) ||
    (watcher ? avatarId !== "" : avatarId !== "robot")
  )
    return;
  return {
    id,
    name,
    slot,
    avatarId: watcher ? "" : "robot",
    connected,
    bot,
    ...(watcher ? { watcher: true } : {}),
    ...(away ? { away: true } : {}),
    ...(uint32(generation) ? { generation } : {}),
  };
}
export function encodeRoom(r: CyberfuseRoom): unknown[] {
  return [
    r.matchId,
    r.round,
    r.stage,
    r.settings,
    [...r.seats.values()].sort(bySlot),
    r.mode,
    r.campaign,
    r.roster,
    r.held,
    r.world,
    r.history,
    r.firstRound,
    r.armoryKey,
    r.loadouts,
  ];
}
export function decodeRoom(
  fields: readonly unknown[],
  tick: number,
): CyberfuseRoom | undefined {
  if (fields.length !== 14 || !uint32(tick)) return;
  const [
    matchId,
    round,
    stage,
    rawSettings,
    rawSeats,
    mode,
    campaign,
    rawRoster,
    rawHeld,
    rawWorld,
    rawHistory,
    firstRound,
    armoryKey,
    rawLoadouts,
  ] = fields;
  const settings = parseSettings(rawSettings);
  if (
    !settings ||
    !validMatchId(matchId) ||
    !uint32(round) ||
    !uint32(firstRound) ||
    firstRound < 1 ||
    (stage === "lobby" ? firstRound !== 1 : firstRound > round) ||
    (mode === "dogfight" && firstRound !== 1) ||
    typeof stage !== "string" ||
    !["lobby", "running", "between", "over"].includes(stage) ||
    (mode !== "campaign" && mode !== "dogfight") ||
    !uint32(campaign) ||
    campaign >= (mode === "campaign" ? CAMPAIGNS.length : DOGFIGHTS.length) ||
    round >
      (mode === "campaign"
        ? CAMPAIGNS[campaign]!.missions.length
        : MAX_DOGFIGHT_ROUNDS) ||
    !Array.isArray(rawSeats) ||
    rawSeats.length > CAPACITY + MAX_WATCHERS ||
    !Array.isArray(rawRoster) ||
    rawRoster.length > CAPACITY ||
    typeof armoryKey !== "string" ||
    !plain(rawLoadouts) ||
    Object.keys(rawLoadouts).length > CAPACITY ||
    !plain(rawHeld)
  )
    return;
  const seats = new Map<string, SeatRecord>();
  const slots = new Set<number>();
  let watchers = 0;
  for (const value of rawSeats) {
    const seat = decodeSeat(value);
    if (!seat || seats.has(seat.id)) return;
    if (seat.watcher) {
      if (++watchers > MAX_WATCHERS) return;
    } else {
      if (slots.has(seat.slot)) return;
      slots.add(seat.slot);
    }
    seats.set(seat.id, seat);
  }
  const roster: Operative[] = [];
  for (const value of rawRoster) {
    const entry = decodeOperative(value);
    if (
      !entry ||
      Object.keys(value).length !== 4 ||
      roster.some((p) => p.id === entry.id || p.slot === entry.slot)
    )
      return;
    roster.push(entry);
  }

  const loadouts: CyberfuseRoom["loadouts"] = {};
  const shop = armory({
    stage: stage as Stage,
    round,
    settings,
    mode,
    campaign,
  });
  if (armoryKey !== "" && armoryKey !== shop?.key) return;
  for (const [id, kit] of Object.entries(rawLoadouts)) {
    const seat = seats.get(id);
    if (
      !seat ||
      seat.bot ||
      seat.watcher ||
      !armoryKey ||
      !shop ||
      !validLoadout(kit) ||
      !kit.length ||
      !kit.every((w) => shop.spec.allowedWeapons.includes(w)) ||
      (stage === "between" && !roster.some((p) => p.id === id))
    )
      return;
    loadouts[id] = [...kit];
  }
  const held: CyberfuseRoom["held"] = {};
  if (Object.keys(rawHeld).length > CAPACITY) return;
  for (const [id, raw] of Object.entries(rawHeld)) {
    const seat = seats.get(id);
    if (
      !roster.some((p) => p.id === id && !p.bot) ||
      !seat?.connected ||
      !plain(raw) ||
      Object.keys(raw).length !== 2 ||
      !validBits(raw.bits) ||
      !uint32(raw.generation) ||
      raw.generation !== seat.generation
    )
      return;
    held[id] = { bits: raw.bits, generation: raw.generation };
  }
  const history = parseHistoryReceipts(
    rawHistory,
    tick,
    parseCyberfuseStats,
    playerKey,
    isBotId,
    128,
  );
  if (
    !history ||
    history.some(
      (h) =>
        h.result.players.length > CAPACITY ||
        h.result.players.some(
          (p) =>
            !validName(p.name) || p.slot >= CAPACITY || p.matchScoreUnits > 1e9,
        ),
    )
  )
    return;

  const current = history.filter((h) => h.result.matchId === matchId);
  const completed = current.filter((h) => h.result.round !== undefined);
  if (
    stage !== "lobby" &&
    (completed.length !==
      (stage === "running" ? round - firstRound : round - firstRound + 1) ||
      completed.some(
        (h, index) =>
          h.result.round !== index + firstRound ||
          h.result.players.length !== roster.length ||
          h.result.players.some(
            (p) =>
              !roster.some(
                (entry) => entry.id === p.playerId && entry.slot === p.slot,
              ),
          ),
      ) ||
      current.filter((h) => h.result.round === undefined).length !==
        Number(stage === "over"))
  )
    return;
  let world = null;
  if (stage === "lobby") {
    if (round !== 0 || rawWorld !== null || roster.length) return;
  } else {
    if (!roster.length || !round || !isMissionState(rawWorld)) return;
    world = rawWorld;
    const actorSeats = world.actors
      .filter((a) => a.seat !== null)
      .map((a) => a.seat);
    if (
      world.mode !== mode ||
      world.campaign !== campaign ||
      world.mission !== (mode === "campaign" ? round - 1 : campaign) ||
      world.seed !== seedFor(matchId, round) ||
      actorSeats.length !== roster.length ||
      !roster.every((p) => actorSeats.includes(p.id)) ||
      (stage === "running") !== (world.outcome === "playing") ||
      (stage === "between" &&
        mode === "campaign" &&
        (world.outcome !== "victory" ||
          round >= CAMPAIGNS[campaign]!.missions.length)) ||
      (stage === "over" &&
        mode === "campaign" &&
        world.outcome === "victory" &&
        round < CAMPAIGNS[campaign]!.missions.length)
    )
      return;
  }
  if (mode === "dogfight" && (stage === "between" || stage === "over")) {
    const scores = standings({ history, matchId, roster });
    if (
      (stage === "over") !==
      (round === MAX_DOGFIGHT_ROUNDS ||
        scores.some((p) => p.wins >= DOGFIGHT_WIN_TARGET))
    )
      return;
  }
  if (stage !== "running" && Object.keys(held).length) return;
  return {
    tick,
    matchId,
    round,
    stage: stage as Stage,
    settings,
    seats,
    mode,
    campaign,
    firstRound,
    armoryKey,
    loadouts,
    roster,
    held,
    world: world && structuredClone(world),
    history,
  };
}
export function hashRoom(room: CyberfuseRoom): string {
  return hashCheckpointJson([room.tick, ...encodeRoom(room)]);
}
