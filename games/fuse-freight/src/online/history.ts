import type { MatchResult, PlayerResult } from "fuse-platform";
import type { HistoryReceipt } from "fuse-ui/results-history";
import type { View } from "./game.js";

/** Frozen round deliveries and rosters; later lobby changes never rewrite these results. */
export function historyReceipts(frame: View): HistoryReceipt[] {
  const receipts:HistoryReceipt[]=frame.results.map(round=>({tick:round.tick,result:{matchId:frame.matchId,round:round.round,length:1,...(round.winners.length===1?{winnerId:round.winners[0]!}:{}),finishers:[...round.finishers],players:round.placings.map(p=>({playerId:p.id,name:p.name,slot:p.slot,roundsPlayed:1,roundWins:Number(round.winners.includes(p.id)),matchScoreUnits:p.score,matchPlacement:p.place,earlyExits:Number(!p.bot&&!round.finishers.includes(p.id))}))}}));
  const last=frame.results.at(-1);
  if(frame.stage!=="over"||!last)return receipts;
  const combined=new Map<string,PlayerResult>();
  for(const {result} of receipts)for(const p of result.players){const previous=combined.get(p.playerId);combined.set(p.playerId,{...p,roundsPlayed:(previous?.roundsPlayed??0)+1,roundWins:(previous?.roundWins??0)+p.roundWins,matchScoreUnits:(previous?.matchScoreUnits??0)+p.matchScoreUnits,earlyExits:0});}
  const better=(a:PlayerResult,b:PlayerResult)=>a.roundWins>b.roundWins||a.roundWins===b.roundWins&&a.matchScoreUnits>b.matchScoreUnits;
  const players=[...combined.values()].map(p=>({...p,matchPlacement:1+[...combined.values()].filter(q=>better(q,p)).length,earlyExits:Number(!last.placings.some(q=>q.id===p.playerId)||!last.finishers.includes(p.playerId)&&!last.placings.find(q=>q.id===p.playerId)?.bot)}));
  const result:MatchResult={matchId:frame.matchId,length:frame.results.length,...(frame.winners.length===1?{winnerId:frame.winners[0]!}:{}),finishers:[...last.finishers],players};
  receipts.push({tick:last.tick,result});return receipts;
}
