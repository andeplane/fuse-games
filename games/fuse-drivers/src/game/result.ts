import type { MatchResult } from "fuse-platform";
import { playerKey, validMatchId, type FuseDriversRoom } from "./rules.js";
import { CAPACITY, MAX_ROUNDS, isBotId } from "./basics.js";
import { parseFuseDriversStats, type FuseDriversStats } from "../platform.js";
import { uint32 } from "fuse-netcode";

export const RETAINED_FINISHES = 4;
export interface FinishedRace {
  tick: number;
  matchId: string;
  round: number;
  duration: number;
  players: FuseDriversStats[];
}

export function freezeFinishedRace(
  room: FuseDriversRoom,
): FinishedRace | undefined {
  const result = matchResult(room);
  return result && room.race
    ? {
        tick: room.finishTick,
        matchId: room.matchId,
        round: room.round,
        duration: room.race.tick,
        players: result.players,
      }
    : undefined;
}

export function encodeRecentFinishes(
  finishes: readonly FinishedRace[],
): unknown[] {
  return finishes.map((f) => [
    f.tick,
    f.matchId,
    f.round,
    f.duration,
    f.players.map((p) => [
      p.playerId,
      p.name,
      p.slot,
      p.matchScoreUnits,
      p.matchPlacement,
      p.earlyExits,
      p.laps,
      p.kills,
      p.deaths,
      p.lapsLed,
      p.nitrosUsed,
    ]),
  ]);
}

export function decodeRecentFinishes(
  raw: unknown,
  tick: number,
): FinishedRace[] | undefined {
  if (!Array.isArray(raw) || raw.length > RETAINED_FINISHES) return;
  const finishes: FinishedRace[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== 5) return;
    const [at, matchId, round, duration, roster] = row;
    if (
      !uint32(at) ||
      at <= (finishes.at(-1)?.tick ?? 0) ||
      at > tick ||
      !validMatchId(matchId) ||
      !uint32(round) ||
      round === 0 ||
      round > MAX_ROUNDS ||
      !uint32(duration) ||
      duration === 0 ||
      !Array.isArray(roster) ||
      !roster.length ||
      roster.length > CAPACITY
    )
      return;
    const players: FuseDriversStats[] = [];
    for (const fields of roster) {
      if (
        !Array.isArray(fields) ||
        fields.length !== 11 ||
        !fields.slice(2).every(uint32)
      )
        return;
      const [
        playerId,
        name,
        slot,
        matchScoreUnits,
        matchPlacement,
        earlyExits,
        laps,
        kills,
        deaths,
        lapsLed,
        nitrosUsed,
      ] = fields;
      const player = parseFuseDriversStats(
        {
          playerId,
          name,
          slot,
          roundsPlayed: 1,
          roundWins: Number(matchPlacement === 1),
          matchScoreUnits,
          matchPlacement,
          earlyExits,
          laps,
          kills,
          deaths,
          lapsLed,
          nitrosUsed,
        },
        1,
        playerKey,
      );
      if (
        !player ||
        slot <= (players.at(-1)?.slot ?? -1) ||
        matchPlacement > roster.length ||
        players.some(
          (p) => p.playerId === playerId || p.matchPlacement === matchPlacement,
        )
      )
        return;
      players.push(player);
    }
    finishes.push({ tick: at, matchId, round, duration, players });
  }
  return finishes;
}

/**
 * A race's receipt, computed identically on every peer from the finished race alone.
 *
 * Nothing a player can still change afterwards may enter it, so the numbers come from the race state at
 * the tick it finished, not from the lobby a player may since have left or renamed themselves in.
 */
export function matchResult(
  room: FuseDriversRoom,
): MatchResult<FuseDriversStats> | undefined {
  const race = room.race;
  if (!race || room.stage !== "over") return;

  const seats = room.finishSeats;
  const byId = new Map(seats.map((seat) => [seat.id, seat]));
  const stats: FuseDriversStats[] = [];

  for (const [truck, id] of room.grid.entries()) {
    const seat = byId.get(id);
    const car = race.trucks[truck];
    if (!seat || !car) continue;
    const placement = race.placements.indexOf(truck) + 1;
    stats.push({
      playerId: id,
      name: seat.name,
      slot: seat.slot,
      roundsPlayed: 1,
      // One race, so a win is first place across the line.
      roundWins: placement === 1 ? 1 : 0,
      matchScoreUnits: Math.max(0, Math.round(car.progress * 100)),
      matchPlacement: placement > 0 ? placement : room.grid.length,
      earlyExits: seat.connected ? 0 : 1,
      laps: car.laps,
      // The shared career schema retains historical combat totals.
      kills: 0,
      deaths: 0,
      lapsLed: car.lapsLed,
      nitrosUsed: car.nitrosUsed,
    });
  }
  if (stats.length === 0) return;

  // One order for every peer, so equal results serialize to equal bytes.
  stats.sort((a, b) => a.slot - b.slot || (a.playerId < b.playerId ? -1 : 1));
  return resultFor(room.matchId, stats);
}

export function resultFor(
  matchId: string,
  stats: FuseDriversStats[],
): MatchResult<FuseDriversStats> {
  const finishers = [...stats]
    .filter((player) => !isBotId(player.playerId))
    .sort((a, b) => a.matchPlacement - b.matchPlacement)
    .map((player) => player.playerId);
  const winner = stats.find((player) => player.matchPlacement === 1);

  return {
    matchId,
    length: 1,
    ...(winner ? { winnerId: winner.playerId } : {}),
    finishers,
    players: stats,
  };
}

/**
 * A rating receipt for one race of a series. A race is the whole match today, so the round receipt is the
 * match result carrying its round number; it rates without crediting career totals twice.
 */
export function roundResult(
  room: FuseDriversRoom,
  round: number,
): MatchResult<FuseDriversStats> | undefined {
  if (round !== room.round) return;
  const result = matchResult(room);
  return result && room.race
    ? { ...result, round, roundDuration: { version: 1, ticks: room.race.tick } }
    : undefined;
}
