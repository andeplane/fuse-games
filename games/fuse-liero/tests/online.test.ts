import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  PRESENCE,
  World,
  type StreamEntries,
} from "fuse-netcode";
import {
  DEFAULT_SETTINGS,
  FIRE,
  LEFT,
  RIGHT,
  STEPS_PER_TICK,
} from "../src/engine/index.js";
import {
  PLAY,
  createRoom,
  decode,
  encode,
  foldTick,
  hash,
  isEntry,
  lieroGame,
  type Entry,
  type Room,
} from "../src/online/game.js";
import { LieroRuntime } from "../src/online/runtime.js";

type Bodies = Record<string, readonly unknown[][]>;
function fold(room: Room, bodies: Bodies = {}, generation = 1): void {
  const tick = room.tick + 1;
  const streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation,
      entries: list.map((body, index) => [index + 1, tick, ...body] as Entry),
    });
  foldTick(room, "a", streams);
}
function started(): Room {
  const room = createRoom("lobby", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
      [BOT, "add", "bot:1", "Neon Nix", 2],
    ],
  });
  fold(room, { a: [[ACTION, "start", "match-1"]] });
  return room;
}

test("a timed deathmatch finishes, checkpoints and starts a clean rematch", () => {
  const room = createRoom("lobby", { ...DEFAULT_SETTINGS, wins: 1 });
  fold(room, {
    a: [[JOIN, "a", "Ada", 0, "robot", 1]],
  });
  fold(room, { a: [[ACTION, "start", "match-1"]] });
  for (let i = 0; i < 3700 && room.stage !== "over"; i++) fold(room);
  assert.equal(room.stage, "over");
  assert.equal(room.winner, "a");
  assert.equal(room.results.length, 1);
  assert.equal(room.results[0]!.placings[0]!.id, "a");
  assert.ok(decode(encode(room), room.tick));
  fold(room, { a: [[ACTION, "rematch", "match-2"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.round, 1);
  assert.equal(room.winner, "");
  assert.deepEqual(room.results, []);
  assert.deepEqual(room.held, {});
  assert.ok(decode(encode(room), room.tick));
});

test("Liero entries validate controls and scope without accepting unsafe ids", () => {
  assert.ok(isEntry([1, 20, PLAY, "match-1", 1, LEFT | FIRE]));
  for (const value of [-1, 1.5, 256, NaN, Infinity, "1"])
    assert.equal(isEntry([1, 20, PLAY, "match-1", 1, value]), false);
  assert.equal(
    isEntry([1, 1, JOIN, "constructor", "Ada", 0, "robot", 1]),
    false,
  );
  assert.equal(isEntry([1, 1, PLAY, "", 1, 0]), false);
  assert.equal(isEntry([0, 1, PLAY, "m", 1, 0]), false);
});

test("between-round checkpoints retain the score and clear controls for a fresh cave", () => {
  const room = createRoom("lobby", { ...DEFAULT_SETTINGS, wins: 2 });
  fold(room, { a: [[JOIN, "a", "Ada", 0, "robot", 1]] });
  fold(room, { a: [[ACTION, "start", "match-1"]] });
  for (let i = 0; i < 3700 && room.stage !== "between"; i++) fold(room);
  assert.equal(room.stage, "between");
  assert.equal(room.wins.a, 1);
  const restored = decode(encode(room), room.tick);
  assert.ok(restored);
  for (let i = 0; i < 60 && room.stage === "between"; i++) {
    fold(room);
    fold(restored);
  }
  assert.equal(room.stage, "running");
  assert.equal(room.round, 2);
  assert.equal(room.world!.phase, "countdown");
  assert.equal(hash(room), hash(restored));
});

test("held controls ignore stale match, round, generation and spectator input; disconnect releases them", () => {
  const room = started();
  fold(room, { b: [[PLAY, room.matchId, room.round, RIGHT | FIRE]] });
  assert.equal(room.held.b, RIGHT | FIRE);
  fold(room, { b: [[PLAY, "old-match", room.round, LEFT]] });
  fold(room, { b: [[PLAY, room.matchId, room.round + 1, LEFT]] });
  fold(room, { b: [[PLAY, room.matchId, room.round, LEFT]] }, 2);
  fold(room, { viewer: [[PLAY, room.matchId, room.round, LEFT]] });
  assert.equal(room.held.b, RIGHT | FIRE);
  assert.equal(room.held.viewer, undefined);
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.equal(room.held.b, undefined);
  fold(room, { a: [[PRESENCE, "b", true, 1]] });
  assert.equal(room.held.b, undefined, "rejoining never restores stale fire");
});

test("same-tick press and release creates a tap while the following tick is released", () => {
  const room = started();
  for (let i = 0; i < 45; i++) fold(room);
  fold(room, {
    b: [
      [PLAY, room.matchId, room.round, FIRE],
      [PLAY, room.matchId, room.round, 0],
    ],
  });
  assert.equal(room.held.b, undefined);
  assert.ok(
    room.world!.worms.find((worm) => worm.id === "b")!.cooldown > 0,
    "the tap fired",
  );
  fold(room);
  assert.equal(room.held.b, undefined);
});

test("checkpoint preserves destroyed terrain, held inputs and deterministic continuation; malformed state is atomic", () => {
  const room = started();
  fold(room, { b: [[PLAY, room.matchId, room.round, FIRE | RIGHT]] });
  for (let i = 0; i < 250; i++) fold(room);
  const recovered = decode(structuredClone(encode(room)), room.tick);
  assert.ok(recovered);
  assert.equal(hash(recovered), hash(room));
  for (let i = 0; i < 100; i++) {
    fold(room);
    fold(recovered);
  }
  assert.equal(hash(recovered), hash(room));
  const before = hash(room);
  const bad = (change: (fields: unknown[]) => void): void => {
    const fields = structuredClone(encode(room));
    change(fields);
    assert.equal(decode(fields, room.tick), undefined);
    assert.equal(hash(room), before);
  };
  bad((fields) => {
    fields[12] = room.tick * STEPS_PER_TICK + 1;
  });
  bad((fields) => {
    fields[10] = [["nobody", FIRE]];
  });
  bad((fields) => {
    fields[11] = { phase: "play" };
  });
  bad((fields) => {
    fields[8] = "a";
  });
  bad((fields) => {
    fields[6] = [["a", 1]];
  });
  bad((fields) => {
    fields[7] = [{ round: 1, winner: "nobody", placings: [] }];
  });
});

function replica(self = "a") {
  const world = new World(
    lieroGame,
    createRoom("lobby", DEFAULT_SETTINGS),
    "a",
    self,
  );
  const host = world.stream("a", 1);
  world.stream("b", 1);
  host.append(1, [JOIN, "a", "Ada", 0, "robot", 1]);
  host.append(1, [JOIN, "b", "Bo", 1, "cat", 1]);
  host.append(1, [BOT, "add", "bot:1", "Neon Nix", 2]);
  host.append(2, [ACTION, "start", "match-1"]);
  host.through = 400;
  return world;
}

test("late, duplicated and reordered controls converge after missing entries are repaired", () => {
  const entries: Entry[] = Array.from({ length: 24 }, (_, i) => [
    i + 1,
    50 + i * 7,
    PLAY,
    "match-1",
    1,
    i % 3 === 0 ? FIRE | RIGHT : i % 3 === 1 ? LEFT : 0,
  ]);
  const whole = replica(),
    late = replica("b");
  for (let i = 0; i < entries.length; i += 6) {
    const batch = entries.slice(i, i + 6);
    whole.receive("b", batch, i + batch.length, batch.at(-1)![1], 0);
  }
  whole.receive("b", [], entries.length, 400, 0);
  whole.advance(400);
  // The first packet in each pair is lost; later sequence numbers arrive twice and out of order.
  for (let i = 1; i < entries.length; i += 2) {
    const entry = entries[i]!;
    late.advance(entry[1] + 12);
    late.receive("b", [entry], i + 1, entry[1], late.tick);
    late.receive("b", [entry], i + 1, entry[1], late.tick);
    late.receive("b", [entries[i - 1]!], i + 1, entry[1], late.tick);
  }
  late.receive("b", [], entries.length, 400, late.tick);
  late.advance(400);
  assert.ok(late.rollbacks > 0);
  assert.equal(hash(late.state), hash(whole.state));
  assert.deepEqual(late.view()[0], whole.view()[0]);
});

class ControlsRuntime extends LieroRuntime {
  release(): void {
    this.releaseControls();
  }
  resync(): void {
    this.resetControls();
  }
}
test("runtime normalizes invalid input and releases held controls through its public adapter", () => {
  const runtime = new ControlsRuntime(
    "SOLO",
    DEFAULT_SETTINGS,
    {
      state: () => {},
      event: () => {},
      status: () => {},
      ready: () => {},
    },
    {
      dependencies: {
        now: () => 0,
        hidden: () => false,
        token: () => "match",
        generation: () => 1,
        schedule: () => () => {},
        onVisibilityChange: () => () => {},
      },
    },
  );
  runtime.start();
  assert.equal(runtime.roomState()!.seats.get("solo")?.avatarId, "robot");
  runtime.input(FIRE | RIGHT);
  assert.equal(runtime.heldNow, FIRE | RIGHT);
  runtime.resync();
  runtime.flush();
  runtime.release();
  assert.equal(runtime.heldNow, 0);
  runtime.input(-1);
  assert.equal(runtime.heldNow, 0);
  runtime.stop();
});
