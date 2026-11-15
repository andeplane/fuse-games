import test from "node:test";
import assert from "node:assert/strict";
import { parseMatchResult } from "fuse-platform";
import { DEFAULT_SETTINGS } from "../src/engine/index.js";
import { createRoom, view, type RoundResult } from "../src/online/game.js";
import { historyReceipts, parsePastMatches, retainPastMatches } from "../src/online/history.js";
import type { HistoryReceipt } from "fuse-ui/results-history";
import { freightRegistration } from "../src/platform.js";
const a="a".repeat(24),b="b".repeat(24);
test("retained history caps total receipts and drops oldest complete groups",()=>{
  const group=(index:number):HistoryReceipt[]=>{
    const players=(length:number,count:number)=>Array.from({length:count},(_,slot)=>({playerId:(slot+1).toString(16).padStart(24,"0"),name:"🚁".repeat(18),slot,roundsPlayed:length,roundWins:length,matchScoreUnits:Number.MAX_SAFE_INTEGER,matchPlacement:1,earlyExits:0}));
    const six=players(1,6),finishers=six.map(p=>p.playerId);
    const rounds:HistoryReceipt[]=Array.from({length:57},(_,i)=>({tick:index*100+i+1,result:{matchId:`long-${index}`,round:i+1,length:1,finishers:[...finishers],players:six.map(p=>({...p}))}}));
    rounds.push({tick:index*100+57,result:{matchId:`long-${index}`,length:57,finishers:[...finishers],players:players(57,128)}});
    return rounds;
  };
  let retained:HistoryReceipt[][]=[];
  for(let i=0;i<10;i++){
    retained=retainPastMatches(retained,group(i),10000)!;
    assert.ok(retained);assert.ok(retained.flat().length<=128);assert.ok(retained.length<=8);
  }
  assert.deepEqual(retained.map(items=>items[0]!.result.matchId),["long-8","long-9"]);
  assert.equal(retained.flat().length,116);
  assert.ok(Buffer.byteLength(JSON.stringify(retained))<500_000,"bounded application JSON stays below the 2.6 MB whole-snapshot limit");
  assert.equal(parsePastMatches([group(0),group(1),group(2)],10000),undefined,"decoder refuses an oversized archive");
  assert.equal(parsePastMatches(Array.from({length:9},()=>[group(0)[0]!]),10000),undefined,"decoder refuses too many groups");
});
const account={validName:(v:unknown):v is string=>typeof v==="string",validAvatar:(v:unknown):v is string=>typeof v==="string",nameRule:"name",fallbackName:"Driver"};
test("Freight reports shared wins and delivered wagons without inventing a sole winner",()=>{
  const frame=view(createRoom("m",DEFAULT_SETTINGS));
  const round=(number:number):RoundResult=>({round:number,tick:number*100,finishers:[a,b],winners:[a,b],placings:[a,b].map((id,slot)=>({id,name:slot?"Bo":"Ada",slot,bot:false,score:10,place:1,stolen:0,stranded:0}))});
  frame.results=[round(1),round(2)];frame.stage="over";frame.winners=[a,b];
  const reports=historyReceipts(frame);assert.equal(reports.length,3);
  for(const {result}of reports){assert.equal(result.winnerId,undefined);assert.ok(parseMatchResult(freightRegistration,account,result));}
  assert.deepEqual(reports[2]!.result.players.map(p=>[p.roundWins,p.matchScoreUnits,p.matchPlacement]),[[2,20,1],[2,20,1]]);
  frame.seats=[];frame.wins={};assert.deepEqual(historyReceipts(frame),reports);
});
