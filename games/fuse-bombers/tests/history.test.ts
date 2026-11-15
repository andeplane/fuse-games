import test from "node:test";
import assert from "node:assert/strict";
import { parseMatchResult, type PlayerResult } from "fuse-platform";
import { createRoom, view, DEFAULT_SETTINGS } from "../src/online/game.js";
import { historyReceipts } from "../src/online/history.js";
import { bombersRegistration } from "../src/platform.js";
const a="a".repeat(24),b="b".repeat(24);
const account={validName:(v:unknown):v is string=>typeof v==="string",validAvatar:(v:unknown):v is string=>typeof v==="string",nameRule:"name",fallbackName:"Pilot"};
test("Bombers records frozen pilots and round wins independently of the recap roster",()=>{
  const frame=view(createRoom("m",DEFAULT_SETTINGS));
  const players:PlayerResult[]=[a,b,"bot:1"].map((playerId,slot)=>({playerId,name:slot===0?"Ada":slot===1?"Bo":"Bot",slot,roundsPlayed:1,roundWins:Number(slot===0),matchScoreUnits:Number(slot===0),matchPlacement:slot===0?1:2,earlyExits:0}));
  frame.results=[{round:1,tick:50,players,finishers:[a,b],winner:a,reason:"last-standing"}];frame.stage="over";frame.winner=a;frame.seats=[];
  const reports=historyReceipts(frame);assert.equal(reports.length,2);
  for(const {result}of reports)assert.ok(parseMatchResult(bombersRegistration,account,result));
  assert.deepEqual(reports.at(-1)!.result.players.map(p=>p.name),["Ada","Bo","Bot"]);
  assert.deepEqual(reports.at(-1)!.result.finishers,[a,b]);
});
