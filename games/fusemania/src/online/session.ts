import { uint32 } from "fuse-netcode";
import { MOST_NOTES, validName } from "../basics.js";
import {
  FULL_RATING,
  rating,
  songStats,
  type Library,
} from "../engine/index.js";
import type { Room } from "./game.js";
import { playerKey, validMatchId } from "./names.js";

/** How long a session can be, in songs. */
export const SESSION_LENGTHS: readonly number[] = [1, 3, 5, 10];
/** The most riders a session keeps a total for: the ones who left longest ago and scored least make room. */
export const SESSION_SCORES = 16;

/** One rider's total over a session's songs. */
export interface SessionScore {
  id: string;
  name: string;
  /** The ratings of the songs it finished, added up. */
  points: number;
  /** The songs it won. */
  wins: number;
}
/** One rider's standings and frozen counters over the songs they completed. */
export interface SessionTotal extends SessionScore {
  bot: boolean;
  roundsPlayed: number;
  earlyExits: number;
  combo: number;
  marvelous: number;
  perfect: number;
  great: number;
  steps: number;
  misses: number;
}
/** Several songs played as one contest: the room adds every finished song's ratings up. */
export interface Session {
  /** Stable parent match identity across song restarts and the lobby between songs. */
  id: string;
  /** Songs the session plays: 3, 5 or 10. */
  length: number;
  /** Songs finished. */
  done: number;
  /** The songs started, in order: the finished ones, then the one being played. A song given up is not kept. */
  songs: string[];
  /** A total per rider, in the order they first finished a song. */
  totals: SessionTotal[];
}
/** A session as the screen shows it. */
export interface SessionView {
  id: string;
  length: number;
  done: number;
  songs: string[];
  /** The totals, the leader's first: by points, then by songs won. */
  standings: SessionScore[];
}

/** The standings of a session's totals: by points, then by songs won, then in the order riders joined it. */
export const standings = (scores: readonly SessionScore[]): SessionScore[] =>
  scores
    .slice()
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
    .map(({ id, name, points, wins }) => ({ id, name, points, wins }));

export function decodeSession(
  raw: unknown,
  known: (song: string) => boolean,
): Session | null | undefined {
  if (raw === null) return null;
  if (!Array.isArray(raw) || raw.length !== 6) return;
  const [length, done, songs, scores, sessionId, records] = raw as unknown[];
  if (
    !Number.isInteger(length) ||
    length === 1 ||
    !SESSION_LENGTHS.includes(length as number) ||
    !uint32(done) ||
    done > (length as number) ||
    !Array.isArray(songs) ||
    (songs.length !== done && songs.length !== done + 1) ||
    songs.length > (length as number) ||
    !songs.every((song) => typeof song === "string" && known(song)) ||
    !Array.isArray(scores) ||
    scores.length > SESSION_SCORES ||
    (done === 0 && scores.length > 0) ||
    !validMatchId(sessionId) ||
    !Array.isArray(records) ||
    records.length !== scores.length
  )
    return;
  const totals: SessionTotal[] = [];
  const ids = new Set<string>();
  let won = 0;
  for (const [index, score] of (scores as unknown[]).entries()) {
    const record: unknown = records[index];
    if (
      !Array.isArray(score) ||
      score.length !== 4 ||
      !Array.isArray(record) ||
      record.length !== 10
    )
      return;
    const [id, name, points, wins] = score as unknown[];
    const [
      recordId,
      bot,
      roundsPlayed,
      earlyExits,
      combo,
      marvelous,
      perfect,
      great,
      steps,
      misses,
    ] = record as unknown[];
    if (
      !playerKey(id) ||
      ids.has(id) ||
      !validName(name) ||
      !uint32(points) ||
      !uint32(wins) ||
      recordId !== id ||
      typeof bot !== "boolean" ||
      !uint32(roundsPlayed) ||
      roundsPlayed < 1 ||
      roundsPlayed > done ||
      !uint32(earlyExits) ||
      earlyExits > roundsPlayed ||
      !uint32(combo) ||
      combo > MOST_NOTES ||
      !uint32(marvelous) ||
      !uint32(perfect) ||
      !uint32(great) ||
      !uint32(steps) ||
      !uint32(misses) ||
      marvelous + perfect + great > steps ||
      combo > steps ||
      steps + misses > roundsPlayed * MOST_NOTES ||
      // A doubled stretch can take one song's rating past the full one, never past twice it.
      points > roundsPlayed * 2 * FULL_RATING ||
      wins > roundsPlayed
    )
      return;
    ids.add(id);
    won += wins;
    totals.push({
      id,
      name,
      points,
      wins,
      bot,
      roundsPlayed,
      earlyExits,
      combo,
      marvelous,
      perfect,
      great,
      steps,
      misses,
    });
  }
  // Every finished song had one winner; a rider dropped from the list took its wins along.
  if (won > done) return;
  return {
    id: sessionId,
    length: length as number,
    done,
    songs: [...(songs as string[])],
    totals,
  };
}

/** Preserve the checkpoint's score and statistics tuple layout for existing peers. */
export function encodeSession(session: Session | null): unknown {
  if (!session) return null;
  return [
    session.length,
    session.done,
    [...session.songs],
    session.totals.map((score) => [
      score.id,
      score.name,
      score.points,
      score.wins,
    ]),
    session.id,
    session.totals.map((record) => [
      record.id,
      record.bot,
      record.roundsPlayed,
      record.earlyExits,
      record.combo,
      record.marvelous,
      record.perfect,
      record.great,
      record.steps,
      record.misses,
    ]),
  ];
}

/** Adds a finished song to the session's totals. */
export function settleSession(room: Room, library: Library): void {
  const { session, world, decided } = room;
  if (!session || !world || !decided) return;
  session.done++;
  const active = new Set(room.roster.map((entrant) => entrant.id));
  for (const entrant of room.roster) {
    const player = world.players[entrant.slot]!;
    let total = session.totals.find((each) => each.id === entrant.id);
    if (!total && session.totals.length >= SESSION_SCORES) {
      // Full: the rider who is gone and has the least makes room.
      let out = -1;
      for (const [index, each] of session.totals.entries()) {
        if (active.has(each.id)) continue;
        if (out < 0 || each.points < session.totals[out]!.points) out = index;
      }
      if (out < 0) continue;
      session.totals.splice(out, 1);
    }
    if (!total) {
      total = {
        id: entrant.id,
        name: entrant.name,
        points: 0,
        wins: 0,
        bot: entrant.bot,
        roundsPlayed: 0,
        earlyExits: 0,
        combo: 0,
        marvelous: 0,
        perfect: 0,
        great: 0,
        steps: 0,
        misses: 0,
      };
      session.totals.push(total);
    }
    total.name = entrant.name;
    total.points += rating(
      library.steps(world.song, player.chart)!,
      player.score,
    );
    if (entrant.id === decided.winner) total.wins++;
    total.roundsPlayed++;
    total.earlyExits +=
      entrant.bot || decided.finishers.includes(entrant.id) ? 0 : 1;
    const stats = songStats(player);
    total.combo = Math.max(total.combo, stats.combo);
    total.marvelous += stats.marvelous;
    total.perfect += stats.perfect;
    total.great += stats.great;
    total.steps += stats.steps;
    total.misses += stats.misses;
  }
}
