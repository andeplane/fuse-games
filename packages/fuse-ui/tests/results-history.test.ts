import test from "node:test";
import assert from "node:assert/strict";
import { createResultsHistory, type HistoryReceipt } from "../src/results-history.js";
const me="a".repeat(24);
const receipt=(matchId="match",round?:number):HistoryReceipt=>({tick:10,result:{matchId,...(round===undefined?{}:{round}),length:1,finishers:[me],winnerId:me,players:[{playerId:me,name:"Ada",slot:0,roundsPlayed:1,roundWins:1,matchScoreUnits:1,matchPlacement:1,earlyExits:0}]}});
const settled=()=>new Promise<void>(resolve=>setImmediate(resolve));

test("shared history waits for confirmed participation and sign-in without consuming solo outcomes",async()=>{
  const calls:{url:string;init:RequestInit|undefined}[]=[];let signedIn=false;
  const history=createResultsHistory({fetch:async(input,init)=>{calls.push({url:String(input),init});return new Response("{}")},apiUrl:path=>`https://game.invalid${path}`,gameId:"example",signedIn:()=>signedIn,playerId:()=>me,now:()=>0});
  const result=receipt();history.observe([result],10);assert.equal(calls.length,0);
  signedIn=true;history.observe([result],9);assert.equal(calls.length,0);
  history.observe([{...result,result:{...result.result,finishers:[]}}],10);assert.equal(calls.length,0);
  history.observe([result],10);await settled();
  assert.equal(calls.length,1);assert.equal(calls[0]!.url,"https://game.invalid/api/games/example/me/results");
  assert.equal(new Headers(calls[0]!.init?.headers).has("Authorization"),false);
  result.result.players[0]!.name="Changed after queue";
  assert.equal(JSON.parse(String(calls[0]!.init?.body)).result.players[0].name,"Ada");
  history.observe([result],10);await settled();assert.equal(calls.length,1);
});

test("room rounds retry transient failures using a bounded schedule and preserve pending receipts across rematches",async()=>{
  let now=0;const calls:string[]=[];
  const history=createResultsHistory({fetch:async(input,init)=>{calls.push(String(input));assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer room-token");return new Response("{}",{status:calls.length===1?503:200})},apiUrl:path=>path,gameId:"example",room:{code:"AB12",token:"room-token"},signedIn:()=>false,playerId:()=>me,now:()=>now});
  history.observe([receipt("first",1)],10);await settled();assert.equal(calls.length,1);
  history.observe([receipt("second")],10);await settled();assert.equal(calls.length,2);
  now=999;history.observe([],10);await settled();assert.equal(calls.length,2);
  now=1000;history.observe([],10);await settled();assert.equal(calls.length,3);
  assert.equal(calls[0],"/api/games/example/rooms/AB12/round-results");assert.equal(calls[2],calls[0]);
  history.dispose();history.observe([receipt("third")],10);await settled();assert.equal(calls.length,3);
});

test("permanent rejection and exhausted transient errors stop retries",async()=>{
  let now=0,calls=0;
  const history=createResultsHistory({fetch:async()=>{calls++;return new Response("{}",{status:503})},apiUrl:path=>path,gameId:"example",signedIn:()=>true,playerId:()=>me,now:()=>now});
  for(const at of [0,1000,3000,10000]){now=at;history.observe([receipt()],10);await settled();}
  assert.equal(calls,3);
  const permanent=createResultsHistory({fetch:async()=>{calls++;return new Response("{}",{status:400})},apiUrl:path=>path,gameId:"example",signedIn:()=>true,playerId:()=>me,now:()=>now});
  permanent.observe([receipt()],10);await settled();permanent.observe([receipt()],10);await settled();assert.equal(calls,4);
});

test("rate limits honor bounded Retry-After and a guest's later sign-in links the same room outcome",async()=>{
  let now=0,signedIn=false,calls=0;
  const history=createResultsHistory({fetch:async()=>{calls++;return new Response("{}",{status:calls===1?429:calls===2?408:200,headers:{"Retry-After":"2"}})},apiUrl:path=>path,gameId:"example",room:{code:"AB12",token:"token"},signedIn:()=>signedIn,playerId:()=>me,now:()=>now});
  history.observe([receipt()],10);await settled();assert.equal(calls,1);
  now=1000;history.observe([],10);await settled();assert.equal(calls,1);
  now=2000;history.observe([],10);await settled();assert.equal(calls,2);
  now=4000;history.observe([],10);await settled();assert.equal(calls,3);
  history.observe([receipt()],10);await settled();assert.equal(calls,3);
  signedIn=true;history.observe([receipt()],10);await settled();assert.equal(calls,4);
  history.observe([receipt()],10);await settled();assert.equal(calls,4);
});
