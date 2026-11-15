import type { MatchResult } from "fuse-platform";
import {
  parseHistoryReceipts,
  type HistoryReceipt,
} from "fuse-platform/history-api";
import { MOST_RATING, isBotId } from "../basics.js";
import {
  BOO,
  GOOD,
  GREAT,
  MARVELOUS,
  MISS,
  PERFECT,
  ranking,
  rating,
  type Library,
} from "../engine/index.js";
import {
  parseFusemaniaStats,
  validFusemaniaField,
  type FusemaniaStats,
} from "../platform.js";
import { standings, type Room } from "./game.js";
import { playerKey, validMatchId } from "./names.js";

/**
 * A finished match as every replica computes it, for the room service (`parseFusemaniaStats` in `../platform.ts` is
 * its boundary). Everything is read from what the fold froze on the deciding tick (the world, the roster the match
 * started with and who was still seated), so every device writes the same bytes however seats change afterwards.
 */
export type FusemaniaPlayerResult = FusemaniaStats;
export type FusemaniaReceipt = HistoryReceipt<FusemaniaPlayerResult>;
export const RESULT_PARENTS = 8;
const RECEIPTS_PER_PARENT = 11;

function players(
  library: Library,
  room: Room,
): FusemaniaPlayerResult[] | undefined {
  const { decided, roster, world } = room;
  if (room.stage !== "over" || !decided || !world) return;
  const places = ranking(library, world);
  return roster.map((entrant) => {
    const player = world.players[entrant.slot]!,
      placement = places.indexOf(entrant.slot) + 1,
      counts = player.counts;
    const score = Math.min(
      MOST_RATING,
      rating(library.steps(world.song, player.chart)!, player.score),
    );
    return {
      songId: world.song,
      chart: player.chart,
      mode: world.mode,
      ...(room.session ? { sessionLength: room.session.length } : {}),
      playerId: entrant.id,
      name: entrant.name,
      slot: entrant.slot,
      roundsPlayed: 1,
      roundWins: placement === 1 ? 1 : 0,
      matchScoreUnits: score,
      matchPlacement: placement,
      earlyExits: entrant.bot || decided.finishers.includes(entrant.id) ? 0 : 1,
      rating: score,
      combo: player.best,
      marvelous: counts[MARVELOUS]!,
      perfect: counts[PERFECT]!,
      great: counts[GREAT]!,
      steps:
        counts[MARVELOUS]! +
        counts[PERFECT]! +
        counts[GREAT]! +
        counts[GOOD]! +
        counts[BOO]!,
      misses: counts[MISS]!,
    };
  });
}

/** The whole match, which credits account totals; undefined until the match is over. */
export function matchResult(
  library: Library,
  room: Room,
): MatchResult<FusemaniaPlayerResult> | undefined {
  const list = players(library, room);
  if (!list || !room.decided) return;
  const session = room.session;
  if (session) {
    if (session.done !== session.length) return;
    const places = standings(session.scores);
    const aggregate = session.scores.map(
      (score, slot): FusemaniaPlayerResult => {
        const record = session.records[slot]!;
        return {
          playerId: score.id,
          name: score.name,
          slot,
          roundsPlayed: record.roundsPlayed,
          roundWins: score.wins,
          matchScoreUnits: score.points,
          matchPlacement: places.findIndex((each) => each.id === score.id) + 1,
          earlyExits: record.earlyExits,
          rating: Math.floor(score.points / session.length),
          combo: record.combo,
          marvelous: record.marvelous,
          perfect: record.perfect,
          great: record.great,
          steps: record.steps,
          misses: record.misses,
          sessionLength: session.length,
        };
      },
    );
    return {
      matchId: session.id,
      length: session.length,
      winnerId: places[0]!.id,
      finishers: [...room.decided.finishers],
      players: aggregate,
    };
  }
  return {
    matchId: room.matchId,
    length: 1,
    winnerId: room.decided.winner,
    finishers: [...room.decided.finishers],
    players: list,
  };
}

/** Each completed song rates once; a playlist's songs share their stable parent match id. */
export function roundResult(
  library: Library,
  room: Room,
): MatchResult<FusemaniaPlayerResult> | undefined {
  const list = players(library, room);
  if (!list || !room.decided) return;
  return {
    matchId: room.session?.id ?? room.matchId,
    length: 1,
    round: room.session?.done ?? 1,
    roundDuration: {
      version: 1,
      ticks: room.decided.clock - room.matchStartTick,
    },
    winnerId: room.decided.winner,
    finishers: [...room.decided.finishers],
    players: list,
  };
}

/** Frozen on the deciding tick, before the next lobby/rematch can replace the world's result. */
export function currentHistoryReceipts(
  library: Library,
  room: Room,
): FusemaniaReceipt[] {
  if (!room.decided) return [];
  const round = roundResult(library, room),
    match = matchResult(library, room);
  return [round, match].flatMap((result) =>
    result ? [{ tick: room.decided!.clock, result }] : [],
  );
}

export function captureHistoryReceipts(library: Library, room: Room): void {
  const current = currentHistoryReceipts(library, room);
  const first = current[0];
  if (!first) return;
  let group = room.recentResults.at(-1);
  if (
    group?.some(
      (receipt) =>
        receipt.tick === first.tick &&
        receipt.result.matchId === first.result.matchId &&
        receipt.result.round === first.result.round,
    )
  )
    return;
  const last = group?.at(-1)?.result;
  // Reused host ids must not append another completed run into an already closed parent.
  if (
    group?.[0]?.result.matchId === first.result.matchId &&
    last &&
    (last.round === undefined || (first.result.round ?? 0) <= last.round)
  ) {
    room.recentResults = room.recentResults.filter(
      (receipts) => receipts[0]?.result.matchId !== first.result.matchId,
    );
    group = undefined;
  }
  if (!group || group[0]!.result.matchId !== first.result.matchId) {
    room.recentResults = room.recentResults.filter(
      (receipts) => receipts[0]?.result.matchId !== first.result.matchId,
    );
    group = [];
    room.recentResults.push(group);
    if (room.recentResults.length > RESULT_PARENTS) room.recentResults.shift();
  }
  group.push(...structuredClone(current));
}

/** Browser-safe checkpoint boundary, including game counters, parent identity, ordinal and field invariants. */
export function parseRecentResults(
  raw: unknown,
  tick: number,
  library: Library,
): FusemaniaReceipt[][] | undefined {
  if (!Array.isArray(raw) || raw.length > RESULT_PARENTS) return;
  const groups: FusemaniaReceipt[][] = [];
  const parents = new Set<string>();
  let previousTick = 0;
  for (const value of raw) {
    const receipts = parseHistoryReceipts(
      value,
      tick,
      (player, rounds) =>
        parseFusemaniaStats(player, rounds, library, playerKey),
      playerKey,
      isBotId,
      RECEIPTS_PER_PARENT,
    );
    const first = receipts?.[0];
    if (
      !first ||
      !validMatchId(first.result.matchId) ||
      parents.has(first.result.matchId) ||
      first.tick <= previousTick
    )
      return;
    const parent = first.result.matchId,
      length = first.result.players[0]!.sessionLength ?? 1;
    if (receipts.length > length + 1) return;
    let ordinal = 0,
      lastRoundTick = 0;
    for (const [index, receipt] of receipts.entries()) {
      const result = receipt.result;
      if (
        result.matchId !== parent ||
        !validFusemaniaField(result.players) ||
        result.players.some(
          (player) => (player.sessionLength ?? 1) !== length,
        ) ||
        result.winnerId !==
          result.players.find((player) => player.matchPlacement === 1)?.playerId
      )
        return;
      if (result.round !== undefined) {
        if (
          result.round !== ++ordinal ||
          ordinal > length ||
          receipt.tick <= lastRoundTick
        )
          return;
        lastRoundTick = receipt.tick;
      } else if (
        index !== receipts.length - 1 ||
        ordinal !== length ||
        result.length !== length ||
        receipt.tick !== lastRoundTick
      )
        return;
    }
    if (ordinal === length && receipts.at(-1)!.result.round !== undefined)
      return;
    previousTick = receipts.at(-1)!.tick;
    parents.add(parent);
    groups.push(receipts);
  }
  return groups;
}

/** Recent immutable outcomes, detached from rollback-owned state. The caller supplies a closed proof tick. */
export function historyReceipts(
  _library: Library,
  room: Pick<Room, "recentResults">,
): FusemaniaReceipt[] {
  return structuredClone(room.recentResults.flat());
}
