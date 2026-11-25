import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, JOIN, World } from "fuse-netcode";
import {
  DEFAULT_SETTINGS,
  INPUT,
  createRoom,
  fuseheadsGame,
  hashRoom,
  type FuseheadsEntry,
} from "../src/game/index.js";
import { FuseheadsMesh } from "./fixtures/mesh.js";
import { FuseheadsRuntime } from "../src/app/runtime.js";
import { parseSave, encodeRoom, decodeRoom } from "../src/game/index.js";

test("a validated local ruler save resumes both keyboard seats, preserving their progress", () => {
  const save = parseSave({
    version: 1,
    pack: "original",
    nextLevel: 7,
    rng: 123,
    tnt: 2,
    players: [
      { slot: 0, score: 4000, lives: 1 },
      { slot: 1, score: 2500, lives: 2 },
    ],
  });
  assert.ok(save);
  assert.equal(parseSave({ ...save, nextLevel: 4 }), undefined);
  assert.equal(
    parseSave({ ...save, players: [{ slot: 0, lives: 500, score: 0 }] }),
    undefined,
  );
  const room = createRoom("m", DEFAULT_SETTINGS);
  room.pendingSave = save;
  assert.equal(decodeRoom(encodeRoom(room), 0), undefined);
  assert.deepEqual(decodeRoom(encodeRoom(room), 0, true)?.pendingSave, save);
  let clock = 0,
    token = 0,
    pulse: () => void = () => {};
  const callbacks = { state() {}, event() {}, status() {}, ready() {} };
  const dependencies = {
    now: () => clock,
    hidden: () => false,
    token: () => String(++token),
    generation: () => 1,
    schedule: (fn: () => void) => {
      pulse = fn;
      return () => {};
    },
    onVisibilityChange: () => () => {},
  };
  assert.throws(
    () =>
      new FuseheadsRuntime("room", DEFAULT_SETTINGS, callbacks, {
        resume: save,
        dependencies,
        transport: () => {
          throw Error("transport must stay closed");
        },
      }),
    /valid local save/,
  );
  const runtime = new FuseheadsRuntime("solo", DEFAULT_SETTINGS, callbacks, {
    resume: save,
    localPlayers: ["One", "Two"],
    dependencies,
  });
  runtime.start();
  assert.equal(runtime.roomState()?.round, 7);
  assert.deepEqual(
    runtime.roomState()?.world?.players.map((p) => [p.score, p.lives]),
    [
      [4000, 1],
      [2500, 2],
    ],
  );
  assert.ok(runtime.play(2, 0));
  assert.ok(runtime.play(1, 1));
  for (let i = 0; i < 12; i++) {
    clock += 20;
    pulse();
  }
  assert.deepEqual(
    runtime.roomState()?.participants.map((p) => p.mask),
    [2, 1],
  );
  runtime.stop();
});

function replica() {
  const world = new World(
      fuseheadsGame,
      createRoom("lobby", DEFAULT_SETTINGS),
      "a",
      "a",
    ),
    host = world.stream("a", 1);
  host.append(1, [JOIN, "a", "Ada", 0, "robot", 1]);
  host.append(1, [JOIN, "b", "Bo", 1, "robot", 1]);
  host.append(2, [ACTION, "start", "expedition"]);
  host.through = 120;
  world.stream("b", 1);
  return world;
}
test("late arrival of a movement input rewinds to the same world as on-time delivery", () => {
  const live = replica(),
    delayed = replica();
  const entries: FuseheadsEntry[] = [
    [1, 5, INPUT, "expedition", 1, 2],
    [2, 10, INPUT, "expedition", 1, 6],
    [3, 13, INPUT, "expedition", 1, 0],
  ];
  live.receive("b", entries, 3, 80, 80);
  live.advance(80);
  delayed.advance(25);
  delayed.receive("b", entries, 3, 80, 80);
  delayed.advance(80);
  assert.ok(delayed.rollbacks > 0);
  assert.equal(hashRoom(delayed.state), hashRoom(live.state));
});
test("two room runtimes converge over dropped, duplicated and reordered fast packets", () => {
  const mesh = new FuseheadsMesh("host", DEFAULT_SETTINGS),
    host = mesh.join("host");
  mesh.run(250);
  const guest = mesh.join("guest");
  mesh.run(900);
  host.command({ type: "join", name: "Ada", slot: 0 });
  guest.command({ type: "join", name: "Bo", slot: 1 });
  mesh.run(1800);
  assert.equal(host.roomState()?.seats.size, 2);
  host.command({ type: "action", action: "start" });
  mesh.run(600);
  let n = 0;
  mesh.fast = () => {
    n++;
    return n % 5 === 0
      ? { drop: true }
      : { delayMs: n % 2 ? 90 : 20, duplicateMs: 120 };
  };
  assert.ok(host.play(2));
  assert.ok(guest.play(1));
  mesh.run(400);
  assert.ok(guest.play(5));
  mesh.run(200);
  assert.ok(guest.play(0));
  assert.ok(host.play(0));
  mesh.run(2500);
  const end = Math.min(host.tick, guest.tick) - 8;
  let compared = 0;
  for (let tick = end - 16; tick <= end; tick++) {
    const a = host.hashAt(tick),
      b = guest.hashAt(tick);
    if (a && b) {
      assert.equal(a, b);
      compared++;
    }
  }
  assert.ok(compared > 0);
  assert.deepEqual(
    host.roomState()?.participants.map((p) => p.mask),
    [0, 0],
  );
  host.stop();
  guest.stop();
});

test("a returning peer restores the running level from a surviving player", () => {
  const mesh = new FuseheadsMesh("host", DEFAULT_SETTINGS),
    host = mesh.join("host");
  mesh.run(250);
  const guest = mesh.join("guest");
  mesh.run(900);
  host.command({ type: "join", name: "Ada", slot: 0 });
  guest.command({ type: "join", name: "Bo", slot: 1 });
  mesh.run(1800);
  host.command({ type: "action", action: "start" });
  mesh.run(600);
  assert.ok(guest.play(2));
  mesh.run(300);
  guest.stop();
  mesh.run(1400);
  const returning = mesh.join("guest");
  mesh.run(2000);
  assert.equal(returning.roomState()?.stage, "running");
  assert.equal(returning.roomState()?.matchId, host.roomState()?.matchId);
  assert.ok(returning.play(4));
  mesh.run(160);
  assert.ok(returning.play(0));
  mesh.run(500);
  const at = Math.floor((Math.min(host.tick, returning.tick) - 8) / 8) * 8;
  assert.ok(host.hashAt(at));
  assert.equal(returning.hashAt(at), host.hashAt(at));
  returning.stop();
  host.stop();
});
