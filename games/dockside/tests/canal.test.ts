import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  KEY,
  COST,
  GATE,
  FIELD,
  LANES,
  TURRETS,
  createWorld,
  stepWorld,
  botInput,
  depotZ,
  walkable,
  type Drone,
} from "../src/game/canal.js";
import { decodeWorld } from "../src/game/validate.js";
const world = () => createWorld(["pilot-a", "pilot-b"], 42);
const arrived = (team: 0 | 1): Drone => ({
  id: team + 1,
  team,
  lane: 0,
  waypoint: 3,
  x: (team ? -1 : 1) * (GATE - 4),
  z: 0,
  hp: 5,
});
describe("Canal Lock", () => {
  it("uses separate bridge and central catwalk clearances", () => {
    assert.equal(walkable(0, 0, false), true);
    assert.equal(walkable(0, 0, true), false);
    assert.equal(walkable(0, LANES[0], true), true);
    assert.equal(walkable(0, 600, false), false);
    const w = world(),
      r = w.rigs[0]!;
    r.x = 0;
    r.z = 0;
    stepWorld(w, [KEY.shift, 0]);
    assert.equal(r.travel, false);
    r.x = -FIELD.water - 100;
    stepWorld(w, [0, 0]);
    stepWorld(w, [KEY.shift | KEY.right, 0]);
    assert.equal(r.travel, true);
    assert.equal(r.x, -FIELD.water - 60);
  });
  it("buys only at a matching pad, preserves funds on refusal, caps live drones and ignores held launch repeats", () => {
    const w = world(),
      r = w.rigs[0]!;
    r.credits = 30;
    stepWorld(w, [KEY.launch, 0]);
    assert.equal(w.drones.length, 0);
    assert.equal(r.credits, 30);
    r.z = depotZ(1);
    for (let i = 0; i < 4; i++) stepWorld(w, [KEY.launch, 0]);
    assert.equal(w.drones.length, 0);
    for (let i = 0; i < 3; i++) {
      stepWorld(w, [0, 0]);
      stepWorld(w, [KEY.launch, 0]);
    }
    assert.deepEqual(
      w.drones.map((d) => d.lane),
      [1, 1],
    );
    assert.equal(r.credits, 30 - 2 * COST);
  });
  it("captures on touch, earns territory income and never resolves simultaneous neutral contact by seat iteration", () => {
    const w = world(),
      post = TURRETS[0];
    Object.assign(w.rigs[0]!, post);
    Object.assign(w.rigs[1]!, post);
    stepWorld(w, [0, 0]);
    assert.equal(w.turrets[0]!.owner, -1);
    w.rigs[1]!.x += 300;
    stepWorld(w, [0, 0]);
    assert.equal(w.turrets[0]!.owner, 0);
    while (w.tick < 60) stepWorld(w, [0, 0]);
    assert.deepEqual(
      w.rigs.map((r) => r.credits),
      [4, 3],
    );
  });
  it("resolves fire before crossing, respects travel fire lock and allows simultaneous deliveries", () => {
    const w = world();
    w.drones = [{ ...arrived(0), hp: 1 }];
    w.rigs[1]!.x = GATE;
    stepWorld(w, [0, KEY.fire]);
    assert.deepEqual(w.winners, []);
    assert.equal(w.rigs[1]!.intercepted, 1);
    w.rigs[1]!.travel = true;
    w.rigs[1]!.cooldown = 0;
    w.drones = [arrived(0), arrived(1)];
    stepWorld(w, [0, KEY.fire]);
    assert.deepEqual(w.winners, [0, 1]);
  });
  it("routes real paid drones through each bridge and only delivery wins", () => {
    for (const lane of [0, 1]) {
      const w = world(),
        r = w.rigs[0]!;
      r.z = depotZ(lane);
      r.credits = COST;
      stepWorld(w, [KEY.launch, 0]);
      let bridge = false;
      for (let t = 0; t < 1100 && !w.winners.length; t++) {
        stepWorld(w, [0, 0]);
        const d = w.drones[0];
        if (d && Math.abs(d.x) < FIELD.water) {
          assert.equal(d.z, LANES[lane]);
          bridge = true;
        }
      }
      assert.equal(bridge, true);
      assert.deepEqual(w.winners, [0]);
    }
  });
  it("practice pilot funds and delivers with ordinary inputs; checkpoints preserve continuation", () => {
    const w = world();
    for (let t = 0; t < 190; t++) stepWorld(w, [0, botInput(w, 1)]);
    const restored = decodeWorld(JSON.parse(JSON.stringify(w)));
    assert.deepEqual(restored, w);
    for (let t = 0; t < 2500 && !w.winners.length; t++) {
      stepWorld(w, [0, botInput(w, 1)]);
      stepWorld(restored!, [0, botInput(restored!, 1)]);
    }
    assert.deepEqual(restored, w);
    assert.deepEqual(w.winners, [1]);
    assert.ok(w.rigs[1]!.launched > 0);
    assert.equal(
      decodeWorld({ ...w, drones: Array(15).fill(arrived(0)) }),
      undefined,
    );
    assert.equal(decodeWorld({ ...w, rigs: [] }), undefined);
  });
});
