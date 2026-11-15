import test from "node:test";
import assert from "node:assert/strict";
import { createArena, COUNTDOWN, BALL_SPEED } from "../src/engine/state.js";
import { activityResult } from "../src/online/activity.js";
import { ballGame, createRoom, DEFAULT_SETTINGS, foldTick, encodeRoom, decodeRoom } from "../src/online/game.js";
import { ballBrosRegistration } from "../src/platform.js";

test("completed arena freezes deciding finishers, names and stats through checkpoint and later seat changes", () => {
  const room = createRoom("match", DEFAULT_SETTINGS);
  const players = ["a", "b"].map((id, slot) => ({ id, slot, name: id === "a" ? "Ada" : "Bo", bot: false, connected: true, generation: 1, avatarId: "fox" }));
  for (const player of players) room.seats.set(player.id, player);
  room.stage = "running";
  room.arena = createArena(players);
  assert.equal(activityResult(ballGame.view(room)), undefined);
  for (let i = 0; i < COUNTDOWN; i++) foldTick(room, "a", new Map());
  room.arena.bases[1]!.alive = false;
  for (const block of room.arena.bases[1]!.blocks) block.alive = false;
  for (const ball of room.arena.balls) { ball.owner = null; ball.held = null; ball.vx = BALL_SPEED; ball.vy = 0; }
  room.arena.bases[0]!.saves = 9;
  foldTick(room, "a", new Map());
  const first = activityResult(ballGame.view(room))!;
  assert.deepEqual(first.finishers, ["a", "b"]);
  assert.equal(first.winnerId, "a");
  assert.equal(first.players[0]!.saves, 9);
  room.seats.get("a")!.name = "Changed";
  room.seats.get("b")!.connected = false;
  foldTick(room, "a", new Map());
  assert.deepEqual(activityResult(ballGame.view(room)), first);
  const restored = decodeRoom(encodeRoom(room), room.tick)!;
  assert.deepEqual(activityResult(ballGame.view(restored)), first);
  const corrupt = encodeRoom(room);
  corrupt[5] = ["a", "a"];
  assert.equal(decodeRoom(corrupt, room.tick), undefined);
  assert.equal(ballBrosRegistration.ratesRounds, false);
  assert.deepEqual(ballBrosRegistration.parseStats(first.players[0], 1), first.players[0]);
  assert.equal(ballBrosRegistration.parseStats({ ...first.players[0], unknown: 1 }, 1), undefined);
});
