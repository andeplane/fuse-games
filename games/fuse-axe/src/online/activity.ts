import type { MatchResult, PlayerResult } from "fuse-platform";
import { parseHistoryPlayer } from "fuse-platform/history-api";

export const isHistoryBot = (id: string) => /^bot:[1-9][0-9]*$/.test(id);
export interface AxeHistoryPlayer extends PlayerResult {
  damage: number;
  knockdowns: number;
  outcome: "clear" | "victory" | "defeat";
}
export function parseAxeHistoryPlayer(raw: unknown, rounds: number): AxeHistoryPlayer | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const { damage, knockdowns, outcome, ...base } = raw as Record<string, unknown>;
  const player = parseHistoryPlayer(base, rounds);
  const counter = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000;
  if (!player || rounds > 4 || !counter(damage) || !counter(knockdowns) || !["clear", "victory", "defeat"].includes(String(outcome)) || player.matchPlacement !== 1 || player.roundWins !== 0 || player.matchScoreUnits > rounds) return;
  return { ...player, damage, knockdowns, outcome: outcome as AxeHistoryPlayer["outcome"] };
}
export interface AxeHistoryReceipt { tick: number; result: MatchResult<AxeHistoryPlayer> }

/** The party shares an outcome. There is no competitive player winner. */
export function runResult(history: readonly AxeHistoryReceipt[], matchId: string, rounds: number, outcome: "victory" | "defeat", finishers: readonly string[]): MatchResult<AxeHistoryPlayer> | undefined {
  const players = new Map<string, AxeHistoryPlayer>();
  for (const receipt of history) {
    if (receipt.result.round === undefined) continue;
    for (const row of receipt.result.players) {
      const old = players.get(row.playerId);
      players.set(row.playerId, {
        ...row, outcome, roundsPlayed: (old?.roundsPlayed ?? 0) + 1,
        matchScoreUnits: (old?.matchScoreUnits ?? 0) + row.matchScoreUnits,
        damage: (old?.damage ?? 0) + row.damage,
        knockdowns: (old?.knockdowns ?? 0) + row.knockdowns,
        earlyExits: finishers.includes(row.playerId) || isHistoryBot(row.playerId) ? 0 : 1,
      });
    }
  }
  if (!players.size) return;
  return { matchId, length: rounds, finishers: [...finishers].filter(id => players.has(id)).sort(), players: [...players.values()].sort((a, b) => a.slot - b.slot || a.playerId.localeCompare(b.playerId)) };
}
