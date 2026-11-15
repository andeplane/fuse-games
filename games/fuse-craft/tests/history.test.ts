import assert from "node:assert/strict";
import test from "node:test";
import { ACTION, JOIN } from "fuse-netcode";
import { neuralGame, type NeuralEntry } from "../src/online/game.js";
import { craftResults } from "../src/online/result.js";
import { craftRegistration } from "../src/platform.js";
import { observeCraftHistory } from "../src/app/history.js";
import type { NeuralSession } from "../src/app/contracts.js";

test("finished Craft outcomes keep their deciding names and finishers after membership changes", () => {
  const room = neuralGame.createRoom("lobby", { mapId: "close-quarters", slot: 0, mode: "versus", engine: {} });
  const ticker = neuralGame.createTicker();
  const fold = (entries: NeuralEntry[] = []) => ticker(room, "host", new Map([["host", { generation: 1, entries }]]));
  fold([[1, 1, JOIN, "host", "Ada", 0, "brain", 1], [2, 1, JOIN, "friend", "Bo", 1, "brain", 1]]);
  fold([[3, 2, ACTION, "start", "match"]]);
  assert.deepEqual(craftResults(room.world, room.decided), []);
  room.world.structures.find(structure => structure.kind === "brain" && structure.ownerId === "friend")!.hp = 0;
  fold();
  assert.equal(room.stage, "over");
  const receipts = craftResults(room.world, room.decided);
  assert.equal(receipts.length, 2);
  assert.equal(receipts[1]!.result.winnerId, "host");
  assert.equal(receipts[1]!.result.players.find(player => player.playerId === "host")!.name, "Ada");
  assert.deepEqual(receipts[1]!.result.finishers, ["friend", "host"]);
  room.seats.clear();
  fold();
  assert.deepEqual(craftResults(room.world, room.decided), receipts);
  // A source receipt retains its own deciding roster even when that seat leaves the recap.
  const fields = neuralGame.checkpoint.encode(room);
  const restored = neuralGame.checkpoint.decode(fields, room.tick);
  assert.ok(restored);
  assert.deepEqual(craftResults(restored.world, restored.decided), receipts);
  assert.equal(craftRegistration.ratesRounds, false);
  assert.equal(craftRegistration.isBot("ai-opponent"), true);
  assert.equal(craftRegistration.isBot("bot-12"), true);
  assert.equal(craftRegistration.isBot("host"), false);
});

test("an immediate Craft rematch retains the result until a later confirmed snapshot can observe it", () => {
  const room = neuralGame.createRoom("lobby", { mapId: "close-quarters", slot: 0, mode: "versus", engine: {} });
  const ticker = neuralGame.createTicker();
  const fold = (entries: NeuralEntry[] = []) => ticker(room, "host", new Map([["host", { generation: 1, entries }]]));
  fold([[1, 1, JOIN, "host", "Ada", 0, "brain", 1], [2, 1, JOIN, "friend", "Bo", 1, "brain", 1]]);
  fold([[3, 2, ACTION, "start", "match"]]);
  room.world.structures.find(structure => structure.kind === "brain" && structure.ownerId === "friend")!.hp = 0;
  fold();
  assert.equal(room.tick, 3, "result falls between stride-4 snapshots");
  const retained = structuredClone(room.history);
  fold([[4, 4, ACTION, "rematch", "next"]]);
  assert.equal(room.tick, 4);
  assert.equal(room.stage, "running");
  assert.equal(room.decided, null);
  assert.deepEqual(neuralGame.view(room).history, retained);
  const restored = neuralGame.checkpoint.decode(neuralGame.checkpoint.encode(room), room.tick);
  assert.ok(restored);
  assert.deepEqual(restored.history, retained);
  assert.equal(neuralGame.hash(restored), neuralGame.hash(room));
});

test("leaving Craft drains fresh runtime results before disposing its captured session", async () => {
  const world = neuralGame.createRoom("lobby", { mapId: "close-quarters", slot: 0, mode: "versus", engine: {} }).world;
  const result = { matchId: "finished", length: 1, finishers: ["solo"], players: [{ playerId: "solo", name: "Ada", slot: 0, roundsPlayed: 1, roundWins: 1, matchScoreUnits: 4, matchPlacement: 1, earlyExits: 0 }] };
  let confirmed = 0, stopped = 0, unsubscribed = 0, now = 0;
  const jobs = new Set<() => void>(), requests: string[] = [];
  const source: NeuralSession = {
    localPlayerId: "solo", canControl: true, view: () => world,
    dispatch() {}, dispatchBatch: () => false, reset() {},
    subscribe: () => () => { unsubscribed++; },
    dispose: () => { stopped++; },
    confirmedResult: () => ({ world, decided: null, history: [], logTick: confirmed }),
    historySnapshot: () => ({ receipts: [{ tick: 3, result }], confirmedTick: confirmed }),
  };
  const session = observeCraftHistory(source, {
    gameId: "fuse-craft", apiUrl: path => path, signedIn: () => true, playerId: () => "solo", now: () => now,
    schedule(callback) { jobs.add(callback); return () => { jobs.delete(callback); }; },
    fetch: async (url) => { requests.push(String(url)); return Response.json({ status: "confirmed" }); },
  });
  session.dispose();
  assert.equal(unsubscribed, 1);
  assert.equal(stopped, 0, "old runtime keeps confirming after its UI detaches");
  assert.deepEqual(requests, []);
  confirmed = 4;
  now = 50;
  for (const callback of [...jobs]) { jobs.delete(callback); callback(); }
  for (let n = 0; n < 4; n++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, ["/api/games/fuse-craft/me/results"]);
  assert.equal(stopped, 1);
  assert.equal(jobs.size, 0);
});
