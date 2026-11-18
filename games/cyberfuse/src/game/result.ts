import type { MatchResult, PlayerResult } from "fuse-platform";
import { CAMPAIGNS } from "../campaign/index.js";
import type { CyberfuseRoom } from "./rules.js";
export type CyberfusePlayerResult = PlayerResult;
export const DOGFIGHT_WIN_TARGET = 5;
export const MAX_DOGFIGHT_ROUNDS = 99; // A platform match may record at most 99 rounds (simultaneous KOs can draw).
export function standings(
  room: Pick<CyberfuseRoom, "history" | "matchId" | "roster">,
) {
  const rounds = room.history.filter(
    (r) => r.result.matchId === room.matchId && r.result.round !== undefined,
  );
  return room.roster.map((p) => {
    const receipts = rounds.flatMap((r) =>
      r.result.players.filter((row) => row.playerId === p.id),
    );
    return {
      ...p,
      played: receipts.length,
      wins: receipts.reduce((total, r) => total + r.roundWins, 0),
      score: receipts.reduce((total, r) => total + r.matchScoreUnits, 0),
    };
  });
}

/** Keep frozen, confirmed-tick receipts through rematch or a quick return to the lobby. */
export function finishRound(room: CyberfuseRoom, tick: number): void {
  const world = room.world!;
  const winners = new Set(world.winners);
  const finishers = room.roster
    .filter((p) => !p.bot && room.seats.get(p.id)?.connected)
    .map((p) => p.id)
    .sort();
  const players = room.roster.map((p) => ({
    playerId: p.id,
    name: p.name,
    slot: p.slot,
    roundsPlayed: 1,
    roundWins: Number(winners.has(p.id)),
    matchScoreUnits: Math.max(
      0,
      world.actors.find((a) => a.seat === p.id)?.score ?? 0,
    ),
    matchPlacement:
      room.mode === "dogfight" && winners.size && !winners.has(p.id) ? 2 : 1,
    earlyExits: Number(!p.bot && !finishers.includes(p.id)),
  }));
  const winner =
    room.mode === "dogfight" && world.winners.length === 1
      ? { winnerId: world.winners[0]! }
      : {};
  const round: MatchResult = {
    matchId: room.matchId,
    round: room.round,
    length: 1,
    roundDuration: { version: 1, ticks: world.tick },
    finishers,
    players,
    ...winner,
  };
  room.history.push({ tick, result: round });
  room.held = {};

  const totals = standings(room);
  const best = Math.max(...totals.map((p) => p.wins));
  const next =
    room.mode === "campaign"
      ? world.outcome === "victory" &&
        room.round < CAMPAIGNS[room.campaign]!.missions.length
      : best < DOGFIGHT_WIN_TARGET && room.round < MAX_DOGFIGHT_ROUNDS;
  if (next) room.stage = "between";
  else {
    room.stage = "over";
    const leaders = totals.filter((p) => p.wins === best);
    room.history.push({
      tick,
      result: {
        matchId: room.matchId,
        length: room.round,
        finishers,
        ...(room.mode === "dogfight" && leaders.length === 1
          ? { winnerId: leaders[0]!.id }
          : {}),
        players: totals.map((p) => ({
          playerId: p.id,
          name: p.name,
          slot: p.slot,
          roundsPlayed: p.played,
          roundWins: p.wins,
          matchScoreUnits: p.score,
          matchPlacement:
            room.mode === "campaign"
              ? 1
              : 1 + totals.filter((other) => other.wins > p.wins).length,
          earlyExits: Number(!p.bot && !finishers.includes(p.id)),
        })),
      },
    });
  }
  room.history = room.history.slice(-128);
}
