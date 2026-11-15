import type { MatchResult } from "fuse-platform";
import { MOST_RATING } from "../basics.js";
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
import type { FusemaniaStats } from "../platform.js";
import { standings, type Room } from "./game.js";

/**
 * A finished match as every replica computes it, for the room service (`parseFusemaniaStats` in `../platform.ts` is
 * its boundary). Everything is read from what the fold froze on the deciding tick (the world, the roster the match
 * started with and who was still seated), so every device writes the same bytes however seats change afterwards.
 */
export type FusemaniaPlayerResult = FusemaniaStats;

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
    const aggregate = session.scores.map((score, slot): FusemaniaPlayerResult => {
      const record = session.records[slot]!;
      return {
        playerId: score.id, name: score.name, slot,
        roundsPlayed: record.roundsPlayed,
        roundWins: score.wins,
        matchScoreUnits: score.points,
        matchPlacement: places.findIndex(each => each.id === score.id) + 1,
        earlyExits: record.earlyExits,
        rating: Math.floor(score.points / session.length),
        combo: record.combo, marvelous: record.marvelous, perfect: record.perfect, great: record.great, steps: record.steps, misses: record.misses,
        sessionLength: session.length,
      };
    });
    return { matchId: session.id, length: session.length, winnerId: places[0]!.id, finishers: [...room.decided.finishers], players: aggregate };
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
  return { matchId: room.session?.id ?? room.matchId, length: 1, round: room.session?.done ?? 1, winnerId: room.decided.winner, finishers: [...room.decided.finishers], players: list };
}
