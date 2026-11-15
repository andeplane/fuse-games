import type { MatchResult, PlayerResult } from "fuse-platform";
import { parseHistoryPlayer } from "fuse-platform/history-api";
import type { Room } from "./game.js";
import { playerKey, validMatchId, validName } from "./names.js";

export interface ShiftCompletion {
  clock: number;
  result: MatchResult;
}
export const isHunterBot = (id: string) => /^bot:[0-9]+$/.test(id);
export function shiftReceipts(
  room: Room,
): { tick: number; result: MatchResult }[] {
  return room.completions.flatMap((completion) => [
    { tick: completion.clock, result: { ...completion.result, round: 1 } },
    { tick: completion.clock, result: completion.result },
  ]);
}

/** Freeze the shift once, before recap joins, renames or ready votes can change it. */
export function completeShift(room: Room, clock: number): ShiftCompletion {
  const hunters = room.world!.hunters;
  const players: PlayerResult[] = [...hunters]
    .sort((a, b) => a.slot - b.slot)
    .map((hunter) => {
      const seat = room.seats.get(hunter.id);
      const place =
        1 + hunters.filter((other) => other.score > hunter.score).length;
      return {
        playerId: hunter.id,
        name: seat?.name ?? "Hunter",
        slot: hunter.slot,
        roundsPlayed: 1,
        roundWins: place === 1 && hunter.score > 0 ? 1 : 0,
        matchScoreUnits: hunter.score,
        matchPlacement: place,
        earlyExits:
          isHunterBot(hunter.id) || (seat?.connected && !seat.watcher) ? 0 : 1,
      };
    });
  const winners = players.filter(
    (player) => player.matchPlacement === 1 && player.matchScoreUnits > 0,
  );
  return {
    clock,
    result: {
      matchId: room.matchId,
      length: 1,
      ...(winners.length === 1 ? { winnerId: winners[0]!.playerId } : {}),
      finishers: players
        .filter((player) => !isHunterBot(player.playerId) && !player.earlyExits)
        .map((player) => player.playerId)
        .sort(),
      players,
    },
  };
}
const plain = (raw: unknown): raw is Record<string, unknown> =>
  !!raw && typeof raw === "object" && !Array.isArray(raw);
const count = (raw: unknown): raw is number =>
  Number.isSafeInteger(raw) && Number(raw) >= 0;
/** The checkpoint receipt is bounded and validated independently of live recap seats. */
export function parseShiftCompletion(
  raw: unknown,
): ShiftCompletion | undefined {
  if (
    !plain(raw) ||
    Object.keys(raw).length !== 2 ||
    !count(raw.clock) ||
    !raw.clock ||
    !plain(raw.result)
  )
    return;
  const result = raw.result;
  if (
    !Object.keys(result).every((key) =>
      ["matchId", "length", "winnerId", "finishers", "players"].includes(key),
    ) ||
    !validMatchId(result.matchId) ||
    result.length !== 1 ||
    !Array.isArray(result.players) ||
    result.players.length < 2 ||
    result.players.length > 5 ||
    !Array.isArray(result.finishers)
  )
    return;
  const players: PlayerResult[] = [];
  for (const raw of result.players) {
    const player = parseHistoryPlayer(raw, 1);
    if (
      !player ||
      !playerKey(player.playerId) ||
      !validName(player.name) ||
      player.roundsPlayed !== 1 ||
      player.slot > 4 ||
      player.matchPlacement > result.players.length ||
      !count(player.matchScoreUnits) ||
      player.matchScoreUnits > 1_000_000
    )
      return;
    players.push(player);
  }
  if (
    new Set(players.map((player) => player.playerId)).size !== players.length ||
    new Set(players.map((player) => player.slot)).size !== players.length ||
    players.some(
      (player, index) => index && player.slot <= players[index - 1]!.slot,
    )
  )
    return;
  const finishers = players
    .filter((player) => !isHunterBot(player.playerId) && !player.earlyExits)
    .map((player) => player.playerId)
    .sort();
  if (JSON.stringify(result.finishers) !== JSON.stringify(finishers)) return;
  for (const player of players) {
    const place =
      1 +
      players.filter((other) => other.matchScoreUnits > player.matchScoreUnits)
        .length;
    if (
      player.matchPlacement !== place ||
      player.roundWins !== (place === 1 && player.matchScoreUnits > 0 ? 1 : 0)
    )
      return;
  }
  const winners = players.filter(
    (player) => player.matchPlacement === 1 && player.matchScoreUnits > 0,
  );
  const winnerId = winners.length === 1 ? winners[0]!.playerId : undefined;
  if (result.winnerId !== winnerId) return;
  return {
    clock: raw.clock,
    result: {
      matchId: result.matchId,
      length: 1,
      ...(winnerId ? { winnerId } : {}),
      finishers,
      players,
    },
  };
}
