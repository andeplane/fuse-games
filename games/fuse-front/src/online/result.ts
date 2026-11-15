import type { MatchResult, PlayerResult } from "fuse-platform";
import { parseHistoryPlayer } from "fuse-platform/history-api";
import { memberId, type SeatRecord } from "fuse-netcode";
import { DRAW, teamOf, type World } from "../engine/index.js";

export const isFrontBot = (id: string) => /^bot:[0-5]$/.test(id);
export interface FrontDecision { tick: number; players: PlayerResult[]; finishers: string[] }
/** A slot belongs to whoever controls it at the deciding tick; unoccupied slots are AI. */
export function frontDecision(world: World, seats: Iterable<SeatRecord>, tick: number): FrontDecision {
  const roster = [...seats], finishers: string[] = [];
  const players = world.players.map(player => {
    const seat = roster.find(seat => seat.slot === player.seat && !seat.watcher && seat.connected && !seat.bot);
    const playerId = seat?.id ?? `bot:${player.seat}`;
    if (seat) finishers.push(playerId);
    const won = world.winner !== DRAW && teamOf(player.seat) === world.winner;
    return { playerId, name: seat?.name ?? `AI ${player.seat + 1}`, slot: player.seat, roundsPlayed: 1, roundWins: won ? 1 : 0, matchScoreUnits: won ? 1 : 0, matchPlacement: world.winner === DRAW || won ? 1 : 2, earlyExits: 0 };
  });
  return { tick, players, finishers: finishers.sort() };
}
export function parseFrontDecision(raw: unknown, world: World | null, tick: number): FrontDecision | null | undefined {
  if (raw === null) return world && world.winner >= 0 ? undefined : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !world || world.winner < 0) return;
  const data = raw as Record<string, unknown>;
  if (Object.keys(data).sort().join() !== "finishers,players,tick" || !Number.isSafeInteger(data.tick) || Number(data.tick) < 1 || Number(data.tick) > tick || !Array.isArray(data.players) || data.players.length !== world.players.length || !Array.isArray(data.finishers)) return;
  const players = data.players.map(player => parseHistoryPlayer(player, 1));
  if (!players.every((player): player is PlayerResult => !!player)) return;
  const ids = players.map(player => player.playerId);
  if (new Set(ids).size !== ids.length || players.some((player, index) => player.slot !== world.players[index]!.seat || !memberId(player.playerId) || player.playerId in Object.prototype || player.name.length < 1 || player.name.length > 36 || /[\u0000-\u001f\u007f]/.test(player.name) || player.roundsPlayed !== 1 || player.earlyExits !== 0 || player.roundWins !== (world.winner !== DRAW && teamOf(player.slot) === world.winner ? 1 : 0) || player.matchScoreUnits !== player.roundWins || player.matchPlacement !== (world.winner === DRAW || player.roundWins ? 1 : 2))) return;
  const finishers = data.finishers;
  if (finishers.length !== players.filter(player => !isFrontBot(player.playerId)).length || !finishers.every((id: unknown, index: number) => typeof id === "string" && ids.includes(id) && !isFrontBot(id) && (index === 0 || finishers[index - 1] < id))) return;
  return { tick: Number(data.tick), players, finishers: [...finishers] };
}
export function frontResults(matchId: string, decided: FrontDecision | null): { tick: number; result: MatchResult }[] {
  if (!decided) return [];
  const result: MatchResult = { matchId, length: 1, players: structuredClone(decided.players), finishers: [...decided.finishers] };
  return [{ tick: decided.tick, result: { ...result, round: 1 } }, { tick: decided.tick, result }];
}
