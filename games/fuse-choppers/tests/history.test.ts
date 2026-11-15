import test from "node:test";
import assert from "node:assert/strict";
import { parseMatchResult } from "fuse-platform";
import { DEFAULT_SETTINGS } from "../src/engine/index.js";
import { createRoom, view, type RoundResult } from "../src/online/game.js";
import { historyReceipts } from "../src/online/history.js";
import { choppersRegistration } from "../src/platform.js";
const a="a".repeat(24),b="b".repeat(24);
const account={validName:(v:unknown):v is string=>typeof v==="string",validAvatar:(v:unknown):v is string=>typeof v==="string",nameRule:"name",fallbackName:"Pilot"};
test("Choppers exposes frozen round rosters and one linked match, preserving departures",()=>{
  const frame=view(createRoom("m",DEFAULT_SETTINGS));
  const round=(number:number,ids:string[],winner:string):RoundResult=>({round:number,tick:number*100,finishers:ids.filter(id=>!id.startsWith("bot:")),winner,placings:ids.map((id,slot)=>({id,name:id===a?"Ada":id===b?"Bo":"Bot",slot,bot:id.startsWith("bot:"),state:"crashed",lasted:30}))});
  frame.results=[round(1,[a,b,"bot:1"],a),round(2,[a,"bot:1"],"bot:1"),round(3,[a,"bot:1"],a)];frame.stage="over";frame.winner=a;
  const reports=historyReceipts(frame);assert.equal(reports.length,4);assert.deepEqual(reports.map(r=>r.result.round),[1,2,3,undefined]);
  for(const {result}of reports)assert.ok(parseMatchResult(choppersRegistration,account,result));
  const summary=reports.at(-1)!.result;assert.equal(summary.matchId,"m");assert.deepEqual(summary.finishers,[a]);
  assert.equal(summary.players.find(p=>p.playerId===b)!.roundsPlayed,1);assert.equal(summary.players.find(p=>p.playerId===b)!.earlyExits,1);assert.equal(summary.players.find(p=>p.playerId===a)!.roundWins,2);
  frame.seats=[];frame.wins={};assert.deepEqual(historyReceipts(frame),reports,"mutable recap seats cannot rewrite outcomes");
});
