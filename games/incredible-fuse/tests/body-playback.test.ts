import assert from "node:assert/strict";
import test from "node:test";
import { BodyPlayback } from "../src/app/body-playback.js";
import {
  applyMachine,
  createMachine,
  machineTimeMs,
  stepMachine,
} from "../src/game/machine.js";

test("a catch finishes its buffered motion and a corrected tick replaces stale positions", () => {
  const m = createMachine(0);
  applyMachine(m, { type: "run" });
  const playback = new BodyPlayback();
  playback.update(m, 0);
  stepMachine(m);
  m.mode = "solved";
  m.active.push(2);
  m.bodies.push({ ...m.bodies[0]!, id: 3 });
  playback.update(m, 50);
  assert.ok(playback.pending(50));
  assert.deepEqual(playback.sample(m, 100).active, []);
  assert.equal(playback.sample(m, 100).bodies.length, 1);
  assert.deepEqual(playback.sample(m, 200).active, [2]);
  assert.equal(playback.sample(m, 200).bodies.length, 2);
  assert.ok(playback.sample(m, 50).bodies[0]!.y < m.bodies[0]!.y);
  assert.equal(playback.pending(200), false);
  assert.equal(playback.sample(m, 200).bodies[0]!.y, m.bodies[0]!.y);
  m.mode = "running";
  m.bodies[0]!.x = 123;
  playback.update(m, 201);
  assert.equal(playback.sample(m, 201).bodies[0]!.x, 123);
});

test("moving bodies draw between room steps, and rewind discards old positions", () => {
  const m = createMachine(0);
  applyMachine(m, { type: "run" });
  const playback = new BodyPlayback();
  const start = m.bodies[0]!.y;
  playback.update(m, 0);
  stepMachine(m);
  const end = m.bodies[0]!.y;
  playback.update(m, 50);
  const time = 50 + machineTimeMs(1.5);
  const midway = playback.sample(m, time).bodies[0]!.y;
  assert.ok(midway > start && midway < end);
  assert.equal(m.bodies[0]!.y, end);
  playback.update(m, 60);
  assert.equal(playback.sample(m, time).bodies[0]!.y, midway);
  assert.equal(playback.sample(m, 1000).bodies[0]!.y, end);
  applyMachine(m, { type: "rewind" });
  playback.update(m, 120);
  assert.deepEqual(playback.sample(m, 120).bodies, []);
  applyMachine(m, { type: "run" });
  playback.update(m, 150);
  assert.equal(playback.sample(m, 150).bodies[0]!.y, start);
});
