import test from "node:test";
import assert from "node:assert/strict";
import { parseMatchResult } from "fuse-platform";
import { DEFAULT_SETTINGS } from "../src/engine/index.js";
import { createRoom, view, type RoundResult } from "../src/online/game.js";
import { historyReceipts } from "../src/online/history.js";
import { freightRegistration } from "../src/platform.js";
const a="a".repeat(24),b="b".repeat(24);
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
