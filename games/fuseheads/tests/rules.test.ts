import assert from "node:assert/strict";
import test from "node:test";
import { ACTION, JOIN, BOT, PRESENCE, SPECTATOR } from "fuse-netcode";
import {
  createRoom,
  DEFAULT_SETTINGS,
  INPUT,
  clockAt,
  isFuseheadsEntry,
  fuseheadsView,
} from "../src/game/index.js";
import { fold, started } from "./fixtures/fuseheads.js";

test("one person starts a co-op expedition, and a watcher cannot supply input", () => {
  const room = createRoom("room", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [SPECTATOR, "join", "tv", "TV", 1],
      [ACTION, "start", "solo"],
    ],
  });
  assert.equal(room.stage, "running");
  assert.deepEqual(
    room.participants.map((p) => p.id),
    ["a"],
  );
  fold(room, { tv: [[INPUT, "solo", 1, 2]] });
  assert.equal(room.participants[0]!.mask, 0);
  assert.deepEqual(
    fuseheadsView(room).watchers.map((p) => p.id),
    ["tv"],
  );
});
test("held movement belongs to its seat, generation, level and match; disconnect cancels it", () => {
  const room = started();
  fold(room, { b: [[INPUT, "expedition", 1, 2]] });
  assert.deepEqual(
    room.participants.map((p) => p.mask),
    [0, 2],
  );
  fold(room, {
    b: [
      [INPUT, "old-match", 1, 1],
      [INPUT, "expedition", 2, 1],
    ],
  });
  assert.equal(room.participants[1]!.mask, 2);
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.equal(room.participants[1]!.mask, 0);
  fold(room, {
    a: [[PRESENCE, "b", true, 2]],
    b: [[INPUT, "expedition", 1, 1]],
  });
  assert.equal(room.participants[1]!.mask, 0);
  fold(room, { b: [[INPUT, "expedition", 1, 1]] }, 2);
  assert.equal(room.participants[1]!.mask, 1);
});
test("press and release in a single 50ms log tick reach distinct physical frames", () => {
  const room = started();
  while (clockAt(room.tick + 1) - clockAt(room.tick) !== 1) fold(room);
  fold(room, {
    a: [
      [INPUT, "expedition", 1, 4],
      [INPUT, "expedition", 1, 0],
    ],
  });
  assert.equal(room.participants[0]!.mask, 4);
  assert.deepEqual(room.participants[0]!.pending, [0]);
  fold(room);
  assert.equal(room.participants[0]!.mask, 0);
});
test("wire boundary rejects out-of-range controls, forged bot seats and invalid keys", () => {
  for (const raw of [
    [1, 1, INPUT, "m", 1, 8],
    [1, 1, INPUT, "m", 0, 1],
    [1, 1, BOT, "add", "bot:1", "Bot", 1],
    [1, 1, JOIN, "__proto__", "Bad", 1, "robot", 1],
  ])
    assert.equal(isFuseheadsEntry(raw), false);
});
