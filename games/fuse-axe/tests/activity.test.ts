import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import { createRoom, DEFAULT_SETTINGS, foldTick, encode, decode, hash, type Room, type Entry } from "../src/online/game.js";
import { wiped, cleared } from "./fixtures/stage.js";
import { axeRegistration } from "../src/platform.js";
import { runResult } from "../src/online/activity.js";

function fold(room: Room, entries: Entry[] = []) {
  const streams = new Map<string, StreamEntries<Entry>>();
  streams.set("a", { generation: 1, entries });
  foldTick(room, "a", streams);
}
function started() {
  const room = createRoom("lobby", DEFAULT_SETTINGS);
  fold(room, [[1, 1, JOIN, "a", "Ada", 0, "rhea", 1], [2, 1, JOIN, "b", "Bo", 1, "brakka", 1], [3, 1, BOT, "add", "bot:1", "Ironhide", 2]]);
  fold(room, [[4, 2, ACTION, "start", "match"]]);
  return room;
}
test("cooperative defeat stores a stage and run with no invented individual winner", () => {
  const room = started();
  room.world = wiped(room.world!);
  room.continued = true;
  fold(room);
  assert.equal(room.stage, "over");
  assert.equal(room.history.length, 2);
  const [round, match] = room.history.map(receipt => receipt.result);
  assert.equal(round!.round, 1);
  assert.equal(match!.round, undefined);
  assert.equal(match!.winnerId, undefined);
  assert.deepEqual(match!.finishers, ["a", "b"]);
  assert.ok(match!.players.every(player => player.matchPlacement === 1 && player.roundWins === 0 && player.outcome === "defeat"));
  assert.match(axeRegistration.activity(match!).title, /Party defeated/);
  const restored = decode(encode(room), room.tick)!;
  assert.ok(restored);
  assert.equal(hash(restored), hash(room));
  room.seats.get("a")!.name = "Changed";
  fold(room);
  assert.equal(room.history[1]!.result.players[0]!.name, "Ada");
  const corrupt = encode(room);
  corrupt[11] = [{ tick: room.tick + 1, result: match }];
  assert.equal(decode(corrupt, room.tick), undefined);
  assert.equal(axeRegistration.ratesRounds, false);
});
test("stage clears appear before a run summary and accumulate party participation honestly", () => {
  const room = started();
  room.world = cleared(room.world!);
  fold(room);
  assert.equal(room.history.length, 1);
  assert.equal(room.history[0]!.result.round, 1);
  assert.ok(room.history[0]!.result.players.every(player => player.outcome === "clear"));
  assert.equal(runResult(room.history, "match", 1, "victory", ["a", "b"])!.winnerId, undefined);
  const raw = room.history[0]!.result.players[0]!;
  assert.equal(axeRegistration.parseStats({ ...raw, damage: -1 }, 1), undefined);
});
