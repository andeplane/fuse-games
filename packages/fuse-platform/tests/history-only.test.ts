import test from "node:test";
import assert from "node:assert/strict";
import { historyOnlyRegistration, parseHistoryPlayer } from "../src/history-only.js";
import { settleHistory, type Profile } from "../src/settlement.js";
import type { MatchRecord } from "../src/result.js";
import type { PlayerResult } from "../src/game.js";
const player:PlayerResult={playerId:"a".repeat(24),name:"Ada",slot:0,roundsPlayed:1,roundWins:1,matchScoreUnits:1,matchPlacement:1,earlyExits:0};
test("history-only parsing is explicit and strict",()=>{
  assert.deepEqual(parseHistoryPlayer(player,1),player);
  for(const raw of [{...player,secret:"injected"},{...player,matchScoreUnits:NaN},{...player,roundWins:2},{...player,matchPlacement:0},{...player,slot:-1}])assert.equal(parseHistoryPlayer(raw,1),undefined);
});
test("history-only outcomes never claim or change Elo even with eligible attesters",()=>{
  const game=historyOnlyRegistration({id:"example",isBot:id=>id.startsWith("bot:")});
  const opponent={...player,playerId:"b".repeat(24),name:"Bo",slot:1,roundWins:0,matchScoreUnits:0,matchPlacement:2};
  const match:MatchRecord={version:1,id:"a".repeat(40),gameId:"example",roomCode:"AB12",status:"confirmed",ratingScope:"b".repeat(40),result:{matchId:"m",round:1,length:1,winnerId:player.playerId,finishers:[player.playerId,opponent.playerId],players:[player,opponent]},attesters:[player.playerId,opponent.playerId],uidByPlayer:{[player.playerId]:"ada",[opponent.playerId]:"bo"},avatars:{},participantUids:[],createdAt:1,endedAt:2};
  const profiles=new Map<string,Profile>([["ada",{updatedAt:0}],["bo",{updatedAt:0}]]);
  const result=settleHistory(game,{match,result:undefined},profiles,2,false);
  assert.equal(result.claimed,false);assert.equal(match.ratings,undefined);assert.equal(result.profiles.size,0);
  const ranked=structuredClone(match);
  const control=settleHistory({...game,ratesRounds:true},{match:ranked,result:undefined},profiles,2,false);
  assert.equal(control.claimed,true);assert.equal(control.profiles.get("ada")?.rating?.rounds,1);
});
