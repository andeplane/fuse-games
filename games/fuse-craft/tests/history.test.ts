import assert from "node:assert/strict";
import test from "node:test";
import { ACTION, JOIN } from "fuse-netcode";
import { neuralGame, type NeuralEntry } from "../src/online/game.js";
import { craftResults } from "../src/online/result.js";
import { craftRegistration } from "../src/platform.js";

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
