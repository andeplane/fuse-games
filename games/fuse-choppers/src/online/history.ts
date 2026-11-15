import type { MatchResult, PlayerResult } from "fuse-platform";
import type { HistoryReceipt } from "fuse-ui/results-history";
import type { View } from "./game.js";

/** Frozen round rosters survive departures and recap changes. Read only from a confirmed frame. */
export function historyReceipts(frame: View): HistoryReceipt[] {
  const receipts: HistoryReceipt[] = frame.results.map(round => {
    const players: PlayerResult[] = round.placings.map((p, i) => ({ playerId:p.id,name:p.name,slot:p.slot,roundsPlayed:1,roundWins:Number(p.id === round.winner),matchScoreUnits:Number(p.id === round.winner),matchPlacement:i+1,earlyExits:Number(!p.bot && !round.finishers.includes(p.id)) }));
    return { tick:round.tick,result:{matchId:frame.matchId,round:round.round,length:1,...(round.winner ? {winnerId:round.winner}:{}),finishers:[...round.finishers],players} };
  });
  const last = frame.results.at(-1);
  if (frame.stage !== "over" || !last) return receipts;
  const combined = new Map<string,PlayerResult>();
  for (const {result} of receipts) for (const p of result.players) {
    const previous = combined.get(p.playerId);
    combined.set(p.playerId,{...p,roundsPlayed:(previous?.roundsPlayed??0)+1,roundWins:(previous?.roundWins??0)+p.roundWins,matchScoreUnits:(previous?.matchScoreUnits??0)+p.matchScoreUnits,earlyExits:0});
  }
  const rank = (p:PlayerResult) => p.playerId === frame.winner ? Infinity : p.roundWins;
  const players = [...combined.values()].map(p=>({...p,matchPlacement:1+[...combined.values()].filter(q=>rank(q)>rank(p)).length,earlyExits:Number(!last.placings.some(q=>q.id===p.playerId) || !last.finishers.includes(p.playerId) && !last.placings.find(q=>q.id===p.playerId)?.bot)}));
  const result:MatchResult={matchId:frame.matchId,length:frame.results.length,...(frame.winner?{winnerId:frame.winner}:{}),finishers:[...last.finishers],players};
  receipts.push({tick:last.tick,result});
  return receipts;
}
