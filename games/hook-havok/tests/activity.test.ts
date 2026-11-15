import test from "node:test";
import assert from "node:assert/strict";
import { JOIN, ACTION, World, type StreamEntries } from "fuse-netcode";
import { createRoom, foldTick, encode, decode, hash, hookGame, type Entry, type Room } from "../src/online/game.js";
import { CLASSIC_TUNING } from "../src/engine/world.js";
import { ROUND_TICKS } from "../src/engine/contest.js";
import { hookRegistration } from "../src/platform.js";

function fold(room: Room, entries: Entry[] = []) {
  const streams = new Map<string, StreamEntries<Entry>>();
  streams.set("a", { generation: 1, entries });
  foldTick(room, "a", streams);
}
function started(rules: "score" | "free") {
  const room = createRoom("lobby", { ...CLASSIC_TUNING, rules });
  fold(room, [[1, 1, JOIN, "a", "Ada", 0, "keeper", 1], [2, 1, JOIN, "b", "Bo", 1, "keeper", 1]]);
  fold(room, [[3, 2, ACTION, "start", "match"]]);
  return room;
}
test("only competitive contests create frozen score history, including negative points", () => {
  const free = started("free");
  for (let i = 0; i < 65; i++) fold(free);
  assert.deepEqual(free.history, []);
  const room = started("score");
  while (room.simulation.contest.phase !== "active") fold(room);
  while (room.simulation.contest.elapsed < ROUND_TICKS - 3) fold(room);
  room.simulation.contest.entries[0]!.score = -2;
  room.simulation.contest.entries[1]!.score = 3;
  fold(room);
  assert.equal(room.history.length, 1);
  const result = structuredClone(room.history[0]!.result);
  assert.equal(result.matchId, "match:1");
  assert.equal(result.players[0]!.points, -2);
  assert.equal(hookRegistration.activityPlayer(result.players[0]!).score, -2);
  room.seats.get("a")!.name = "Changed";
  fold(room);
  assert.deepEqual(room.history[0]!.result, result);
  const restored = decode(encode(room), room.tick)!;
  assert.ok(restored);
  assert.equal(hash(restored), hash(room));
  const corrupt = encode(room);
  corrupt[6] = [{ tick: room.tick, result: { ...result, players: [result.players[0], result.players[0]] } }];
  assert.equal(decode(corrupt, room.tick), undefined);
  assert.equal(hookRegistration.ratesRounds, false);
  assert.equal(hookRegistration.parseStats({ ...result.players[0], points: Infinity }, 1), undefined);
  assert.notEqual(restored.tick % 4, 0, "completion/recap lies between materialized snapshots");
  const world = new World(hookGame, restored, "a", "a"), next = restored.tick + 1;
  const stream = world.stream("a", 1);
  stream.append(next, [ACTION, "lobby", "next-lobby"]);
  stream.append(next + 1, [ACTION, "start", "next-match"]);
  stream.through = next + 100;
  world.stream("b", 1).through = next + 100;
  world.advance(next + 48);
  const confirmed = world.confirmedFrame()!;
  assert.equal(confirmed.matchId, "next-match");
  assert.deepEqual(confirmed.history[0]!.result, result);
  assert.ok(confirmed.history[0]!.tick <= confirmed.logTick);
});
