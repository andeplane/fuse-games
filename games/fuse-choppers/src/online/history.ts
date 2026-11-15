import type { MatchResult, PlayerResult } from "fuse-platform";
import type { HistoryReceipt } from "fuse-ui/results-history";
import type { View } from "./game.js";
import { parseHistoryReceipts, parseHistoryPlayer } from "fuse-platform/history-api";
import { playerKey, validName } from "./names.js";

/** Checkpoint boundary for bounded previous matches; canonical ordering preserves hashes after restore. */
export function parsePastMatches(raw:unknown,tick:number):HistoryReceipt[][]|undefined{
  if(!Array.isArray(raw)||raw.length>8)return;
  if(!raw.every(Array.isArray)||raw.reduce((count,group)=>count+group.length,0)>128)return;
  const groups:HistoryReceipt[][]=[];
  for(const group of raw){
    const receipts=parseHistoryReceipts(group,tick,(raw,rounds)=>{const p=parseHistoryPlayer(raw,rounds);return p&&validName(p.name)?p:undefined;},playerKey,id=>id.startsWith("bot:"),100);
    if(!receipts?.length)return;
    if(new Set(receipts.map(r=>r.result.matchId)).size!==1||new Set(receipts.map(r=>r.result.round??"match")).size!==receipts.length)return;
    groups.push(receipts);
  }
  return groups;
}

/** Preserve whole recent matches while bounding checkpoint payloads independently of match length. */
export function retainPastMatches(previous:readonly HistoryReceipt[][], current:HistoryReceipt[],tick:number):HistoryReceipt[][]|undefined{
  const groups=[...previous,current].slice(-8);
  while(groups.reduce((count,group)=>count+group.length,0)>128)groups.shift();
  return parsePastMatches(groups,tick);
}

/** Frozen round rosters survive departures and recap changes. Read only from a confirmed frame. */
export function currentHistoryReceipts(frame: Pick<View,"results"|"stage"|"matchId"|"winner">): HistoryReceipt[] {
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

export function historyReceipts(frame:Pick<View,"pastMatches"|"results"|"stage"|"matchId"|"winner">):HistoryReceipt[]{return [...frame.pastMatches.flat(),...currentHistoryReceipts(frame)];}
