import type { PlayerResult } from "./game.js";
import type { MatchResult } from "./result.js";
export type { MatchResult } from "./result.js";
import { MAX_RATED_PLAYERS } from "./rating.js";

/** The shared account display contract, applied to game receipts without changing runtime seat names. */
export function historyPlayerName(name: string): string {
  return (
    Array.from(name.replace(/[\u0000-\u001f\u007f]|\p{Cs}/gu, "").trim())
      .slice(0, 18)
      .join("")
      .trim() || "Player"
  );
}

export interface HistoryReceipt<P extends PlayerResult = PlayerResult> {
  tick: number;
  result: MatchResult<P>;
}
/** Retained irreversible outcomes are checkpoint data; predictions never enter this array. */
export function parseHistoryReceipts<P extends PlayerResult>(
  raw: unknown,
  tick: number,
  parsePlayer: (raw: unknown, rounds: number) => P | undefined,
  validId: (id: unknown) => id is string,
  isBot: (id: string) => boolean,
  max = 64,
): HistoryReceipt<P>[] | undefined {
  if (!Array.isArray(raw) || raw.length > max) return;
  const receipts: HistoryReceipt<P>[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const data = item as Record<string, unknown>;
    if (
      Object.keys(data).sort().join() !== "result,tick" ||
      !Number.isSafeInteger(data.tick) ||
      Number(data.tick) < 1 ||
      Number(data.tick) > tick ||
      (receipts.length > 0 &&
        Number(data.tick) < receipts[receipts.length - 1]!.tick)
    )
      return;
    const result = parseHistoryResult(data.result, parsePlayer, validId, isBot);
    if (!result) return;
    receipts.push({ tick: Number(data.tick), result });
  }
  return receipts;
}

const KEYS = [
  "playerId",
  "name",
  "slot",
  "roundsPlayed",
  "roundWins",
  "matchScoreUnits",
  "matchPlacement",
  "earlyExits",
];
/** Browser-safe strict base-player parser for frozen game checkpoints. Account/seat rules remain game-owned. */
export function parseHistoryPlayer(
  raw: unknown,
  rounds: number,
): PlayerResult | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).length !== KEYS.length ||
    !KEYS.every((key) => Object.hasOwn(value, key))
  )
    return;
  const {
    playerId,
    name,
    slot,
    roundsPlayed,
    roundWins,
    matchScoreUnits,
    matchPlacement,
    earlyExits,
  } = value;
  const count = (n: unknown, max: number): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= max;
  if (
    typeof playerId !== "string" ||
    typeof name !== "string" ||
    !count(slot, 127) ||
    !count(roundsPlayed, rounds) ||
    !count(roundWins, rounds) ||
    !count(earlyExits, rounds) ||
    !count(matchPlacement, 128) ||
    matchPlacement < 1 ||
    typeof matchScoreUnits !== "number" ||
    !Number.isFinite(matchScoreUnits) ||
    matchScoreUnits < 0 ||
    matchScoreUnits > Number.MAX_SAFE_INTEGER
  )
    return;
  return {
    playerId,
    name,
    slot,
    roundsPlayed,
    roundWins,
    matchScoreUnits,
    matchPlacement,
    earlyExits,
  };
}

/** Strict browser-safe checkpoint boundary; each game supplies its player, seat and bot rules. */
export function parseHistoryResult<P extends PlayerResult>(
  raw: unknown,
  parsePlayer: (raw: unknown, rounds: number) => P | undefined,
  validId: (id: unknown) => id is string,
  isBot: (id: string) => boolean,
): MatchResult<P> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const value = raw as Record<string, unknown>;
  if (
    !Object.keys(value).every((key) =>
      [
        "matchId",
        "round",
        "roundDuration",
        "length",
        "winnerId",
        "finishers",
        "players",
      ].includes(key),
    )
  )
    return;
  const {
    matchId,
    round,
    roundDuration,
    length,
    winnerId,
    finishers,
    players: rawPlayers,
  } = value;
  if (
    typeof matchId !== "string" ||
    !/^[\x21-\x7e]{1,128}$/.test(matchId) ||
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > 99 ||
    (round !== undefined &&
      (typeof round !== "number" ||
        !Number.isSafeInteger(round) ||
        round < 1 ||
        round > 1_000_000 ||
        length !== 1)) ||
    (roundDuration !== undefined &&
      (round === undefined ||
        !roundDuration ||
        typeof roundDuration !== "object" ||
        Array.isArray(roundDuration) ||
        Object.keys(roundDuration).length !== 2 ||
        (roundDuration as Record<string, unknown>).version !== 1 ||
        !Number.isSafeInteger(
          (roundDuration as Record<string, unknown>).ticks,
        ) ||
        Number((roundDuration as Record<string, unknown>).ticks) < 0 ||
        Number((roundDuration as Record<string, unknown>).ticks) >
          0xffffffff)) ||
    !Array.isArray(rawPlayers) ||
    !rawPlayers.length ||
    rawPlayers.length > 128 ||
    (round !== undefined && rawPlayers.length > MAX_RATED_PLAYERS) ||
    !Array.isArray(finishers) ||
    finishers.length > MAX_RATED_PLAYERS
  )
    return;
  const players: P[] = [];
  for (const entry of rawPlayers) {
    const player = parsePlayer(entry, length);
    if (
      !player ||
      !validId(player.playerId) ||
      !player.name.length ||
      player.name.length > 100 ||
      /[\x00-\x1f\x7f]/.test(player.name) ||
      player.matchPlacement > rawPlayers.length ||
      players.some((other) => other.playerId === player.playerId)
    )
      return;
    players.push(player);
  }
  const ids = new Set(players.map((player) => player.playerId));
  if (
    (winnerId !== undefined &&
      (typeof winnerId !== "string" || !ids.has(winnerId))) ||
    new Set(finishers).size !== finishers.length ||
    !finishers.every(
      (id) => typeof id === "string" && ids.has(id) && !isBot(id),
    )
  )
    return;
  return {
    matchId,
    ...(round === undefined ? {} : { round: round as number }),
    ...(roundDuration === undefined
      ? {}
      : {
          roundDuration: {
            version: 1 as const,
            ticks: Number((roundDuration as Record<string, unknown>).ticks),
          },
        }),
    length,
    ...(winnerId === undefined ? {} : { winnerId: winnerId as string }),
    finishers: [...finishers].sort(),
    players: players.sort(
      (a, b) => a.slot - b.slot || (a.playerId < b.playerId ? -1 : 1),
    ),
  };
}
