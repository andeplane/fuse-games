import type { PlayerResult } from "fuse-platform";
import { parseHistoryPlayer } from "fuse-platform/history-api";
export interface CyberfuseStats extends PlayerResult {
  /** Signed DOS score; friendly fire can cost more than the operative earned. */
  score: number;
  bonus: number;
  survived: boolean;
  kills: number;
  friendlies: number;
}
export function parseCyberfuseStats(
  raw: unknown,
  rounds: number,
): CyberfuseStats | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const { score, bonus, survived, kills, friendlies, ...base } = raw as Record<
    string,
    unknown
  >;
  const player = parseHistoryPlayer(base, rounds);
  const integer = (v: unknown, signed = false): v is number =>
    typeof v === "number" &&
    Number.isSafeInteger(v) &&
    v >= (signed ? -1e9 : 0) &&
    v <= 1e9;
  if (
    !player ||
    !integer(score, true) ||
    !integer(bonus, true) ||
    typeof survived !== "boolean" ||
    !integer(kills) ||
    !integer(friendlies) ||
    player.slot >= 5 ||
    player.roundWins > player.roundsPlayed ||
    player.matchScoreUnits !== Math.max(0, score)
  )
    return;
  return { ...player, score, bonus, survived, kills, friendlies };
}
