import assert from "node:assert/strict";
import test from "node:test";
import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import {
  DEFAULT_SETTINGS,
  PLAY,
  createRoom,
  decodeRoom,
  encodeRoom,
  foldTick,
  hashRoom,
  isFuseParticlesEntry,
  matchResult,
  type FuseParticlesEntry,
  type FuseParticlesRoom,
} from "../src/game/index.js";
import { BATTLE_TIMEOUT_TICKS } from "../src/game/simulation.js";

function play(
  room: FuseParticlesRoom,
  generation: number,
  entries: FuseParticlesEntry[],
) {
  const streams = new Map<string, StreamEntries<FuseParticlesEntry>>([
    ["host", { generation, entries }],
  ]);
  foldTick(room, "host", streams);
}
function start() {
  const room = createRoom("lobby", DEFAULT_SETTINGS);
  room.seats.set("host", {
    id: "host",
    name: "Host",
    slot: 0,
    bot: false,
    connected: true,
    generation: 1,
    avatarId: "robot",
  });
  play(room, 1, [
    [1, 1, BOT, "add", "bot:1", "Bot 1", 1],
    [2, 1, BOT, "add", "bot:2", "Bot 2", 2],
    [3, 1, ACTION, "start", "match"],
  ]);
  assert.equal(room.stage, "running");
  return room;
}
test("a three-seat match ignores stale purchases and restores into the same simulation", () => {
  const room = start();
  assert.equal(room.battle!.cores.length, 3);
  const upgrade = { type: "upgrade", upgrade: "health" } as const;
  const gold = room.battle!.cores[0]!.gold;
  play(room, 0, [[4, 2, PLAY, "match", upgrade]]);
  play(room, 1, [[5, 3, PLAY, "previous-match", upgrade]]);
  assert.equal(room.battle!.cores[0]!.gold, gold);
  play(room, 1, [[6, 4, PLAY, "match", upgrade]]);
  assert.ok(room.battle!.cores[0]!.gold < gold);
  const checkpoint = structuredClone(encodeRoom(room));
  const restored = decodeRoom(checkpoint, room.tick);
  assert.ok(restored);
  for (let i = 0; i < 100; i++) {
    foldTick(room, "host", new Map());
    foldTick(restored, "host", new Map());
  }
  assert.equal(hashRoom(restored), hashRoom(room));
});
test("a finished battle exports its result and rematch clears its history", () => {
  const room = start();
  room.battle!.tick = BATTLE_TIMEOUT_TICKS - 1;
  room.battle!.cores[0]!.hp = 999;
  foldTick(room, "host", new Map());
  assert.equal(room.stage, "over");
  assert.deepEqual(matchResult(room)?.finishers, ["host"]);
  play(room, 1, [[4, room.tick + 1, ACTION, "rematch", "again"]]);
  assert.equal(room.matchId, "again");
  assert.equal(room.stage, "running");
  assert.equal(room.battle?.winner, null);
  assert.deepEqual(room.finishers, []);
});
test("invalid player and bot identifiers are refused before folding", () => {
  assert.equal(
    isFuseParticlesEntry([1, 1, JOIN, "constructor", "Player", 0, "robot", 1]),
    false,
  );
  assert.equal(
    isFuseParticlesEntry([1, 1, BOT, "add", "player", "Bot", 0]),
    false,
  );
  assert.equal(
    isFuseParticlesEntry([1, 1, JOIN, "bot:1", "Player", 0, "robot", 1]),
    false,
  );
});
