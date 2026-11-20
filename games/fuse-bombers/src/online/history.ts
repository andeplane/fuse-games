import type { MatchResult, PlayerResult } from "fuse-platform";
import type { HistoryReceipt } from "fuse-ui/results-history";
import type { View } from "./game.js";
import { createPastMatchHistory } from "fuse-platform/history-api";
import { BOT_PREFIX, playerKey, validName } from "./names.js";

export const { parsePastMatches, retainPastMatches } = createPastMatchHistory(
  validName,
  playerKey,
  (id) => id.startsWith(BOT_PREFIX),
);

/** Every receipt uses the roster frozen by the completed round, never the mutable recap seats. */
export function currentHistoryReceipts(
  frame: Pick<View, "results" | "stage" | "matchId" | "winner">,
): HistoryReceipt[] {
  const receipts: HistoryReceipt[] = frame.results.map((round) => ({
    tick: round.tick,
    result: {
      matchId: frame.matchId,
      round: round.round,
      length: 1,
      ...(round.winner ? { winnerId: round.winner } : {}),
      finishers: [...round.finishers],
      players: round.players.map((p) => ({ ...p })),
    },
  }));
  const last = frame.results.at(-1);
  if (frame.stage !== "over" || !last) return receipts;
  const combined = new Map<string, PlayerResult>();
  for (const { result } of receipts)
    for (const p of result.players) {
      const previous = combined.get(p.playerId);
      combined.set(p.playerId, {
        ...p,
        roundsPlayed: (previous?.roundsPlayed ?? 0) + 1,
        roundWins: (previous?.roundWins ?? 0) + p.roundWins,
        matchScoreUnits: (previous?.matchScoreUnits ?? 0) + p.matchScoreUnits,
        earlyExits: 0,
      });
    }
  const rank = (p: PlayerResult) =>
    p.playerId === frame.winner ? Infinity : p.roundWins;
  const players = [...combined.values()].map((p) => ({
    ...p,
    matchPlacement:
      1 + [...combined.values()].filter((q) => rank(q) > rank(p)).length,
    earlyExits: Number(
      !p.playerId.startsWith("bot:") && !last.finishers.includes(p.playerId),
    ),
  }));
  const result: MatchResult = {
    matchId: frame.matchId,
    length: frame.results.length,
    ...(frame.winner ? { winnerId: frame.winner } : {}),
    finishers: [...last.finishers],
    players,
  };
  receipts.push({ tick: last.tick, result });
  return receipts;
}

export function historyReceipts(
  frame: Pick<View, "pastMatches" | "results" | "stage" | "matchId" | "winner">,
): HistoryReceipt[] {
  return [...frame.pastMatches.flat(), ...currentHistoryReceipts(frame)];
}
