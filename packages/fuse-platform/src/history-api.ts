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

function validRoundDuration(
  raw: unknown,
): raw is { version: 1; ticks: number } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const { version, ticks, ...rest } = raw as Record<string, unknown>;
  return (
    !Object.keys(rest).length &&
    version === 1 &&
    typeof ticks === "number" &&
    Number.isSafeInteger(ticks) &&
    ticks >= 0 &&
    ticks <= 0xffffffff
  );
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
      (round === undefined || !validRoundDuration(roundDuration))) ||
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
    ...(validRoundDuration(roundDuration)
      ? { roundDuration: { version: 1 as const, ticks: roundDuration.ticks } }
      : {}),
    length,
    ...(winnerId === undefined ? {} : { winnerId: winnerId as string }),
    finishers: [...finishers].sort(),
    players: players.sort(
      (a, b) => a.slot - b.slot || (a.playerId < b.playerId ? -1 : 1),
    ),
  };
}

const MAX_RETAINED_MATCHES = 8;
const MAX_RETAINED_RECEIPTS = 128;
const MAX_RECEIPTS_PER_MATCH = 100;

/** Retain bounded, complete match groups under the game's name and member rules. */
export function createPastMatchHistory(
  validName: (name: unknown) => boolean,
  playerKey: (value: unknown) => value is string,
  isBot: (id: string) => boolean,
) {
  /** Checkpoint boundary for bounded previous matches; canonical ordering preserves hashes after restore. */
  function parsePastMatches(
    raw: unknown,
    tick: number,
  ): HistoryReceipt[][] | undefined {
    if (!Array.isArray(raw) || raw.length > MAX_RETAINED_MATCHES) return;
    if (
      !raw.every(Array.isArray) ||
      raw.reduce((count, group) => count + group.length, 0) >
        MAX_RETAINED_RECEIPTS
    )
      return;
    const groups: HistoryReceipt[][] = [];
    for (const group of raw) {
      const receipts = parseHistoryReceipts(
        group,
        tick,
        (raw, rounds) => {
          const p = parseHistoryPlayer(raw, rounds);
          return p && validName(p.name) ? p : undefined;
        },
        playerKey,
        isBot,
        MAX_RECEIPTS_PER_MATCH,
      );
      if (!receipts?.length) return;
      if (
        new Set(receipts.map((r) => r.result.matchId)).size !== 1 ||
        new Set(receipts.map((r) => r.result.round ?? "match")).size !==
          receipts.length
      )
        return;
      groups.push(receipts);
    }
    return groups;
  }

  /** Preserve whole recent matches while bounding checkpoint payloads independently of match length. */
  function retainPastMatches(
    previous: readonly HistoryReceipt[][],
    current: HistoryReceipt[],
    tick: number,
  ): HistoryReceipt[][] | undefined {
    const groups = [...previous, current].slice(-MAX_RETAINED_MATCHES);
    let count = groups.reduce((total, group) => total + group.length, 0);
    while (count > MAX_RETAINED_RECEIPTS) count -= groups.shift()!.length;
    return parsePastMatches(groups, tick);
  }

  return { parsePastMatches, retainPastMatches };
}
