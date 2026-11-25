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
    stepWorld(w, [KEY.shift | KEY.up, 0]);
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
  it("claims a nearby neutral turret on Action beyond touch distance, preserving contested contact and ownership", () => {
    const w = world(),
      post = TURRETS[0];
    for (const r of w.rigs) Object.assign(r, { x: post.x + 250, z: post.z });
    stepWorld(w, [0, 0]);
    assert.equal(w.turrets[0]!.owner, -1);
    stepWorld(w, [KEY.launch, KEY.launch]);
    assert.equal(w.turrets[0]!.owner, -1);
    stepWorld(w, [0, 0]);
    stepWorld(w, [KEY.launch, 0]);
    assert.equal(w.turrets[0]!.owner, 0);
    stepWorld(w, [0, KEY.launch]);
    assert.equal(w.turrets[0]!.owner, 0);
    assert.equal(w.rigs[0]!.credits, 2);
    assert.equal(w.drones.length, 0);
  });
  it("resolves fire before crossing and allows simultaneous deliveries", () => {
    const w = world();
    w.drones = [{ ...arrived(0), hp: 1 }];
    w.rigs[1]!.x = GATE;
    stepWorld(w, [0, KEY.fire]);
    assert.deepEqual(w.winners, []);
    assert.equal(w.rigs[1]!.intercepted, 1);
    w.rigs[1]!.travel = true;
    w.drones = [arrived(0), arrived(1)];
    stepWorld(w, [0, KEY.fire]);
    assert.deepEqual(w.winners, [0, 1]);
  });
  it("rotates without translating, reverses and jinks relative to the hull, and brakes in travel form", () => {
    const w = world(),
      r = w.rigs[0]!,
      x = r.x;
    for (let i = 0; i < 16; i++) stepWorld(w, [KEY.right, 0]);
    assert.deepEqual([r.x, r.z, r.heading], [x, 0, 16]);
    stepWorld(w, [KEY.up, 0]);
    assert.equal(r.z, 25);
    stepWorld(w, [KEY.down, 0]);
    assert.equal(r.z, 0);
    stepWorld(w, [KEY.jinkLeft, 0]);
    assert.deepEqual([r.x, r.z, r.heading], [x + 25, 0, 16]);
    stepWorld(w, [KEY.jinkRight | KEY.modifier, 0]);
    assert.equal(r.x, x + 13);
    stepWorld(w, [KEY.jump | KEY.modifier, 0]);
    assert.equal(r.crouched, true);
    assert.equal(r.jump, 0);
    stepWorld(w, [0, 0]);
    stepWorld(w, [KEY.jump, 0]);
    assert.ok(r.jump);
    for (let i = 0; i < 12; i++) stepWorld(w, [0, 0]);
    stepWorld(w, [KEY.shift | KEY.up | KEY.jump, 0]);
    assert.equal(r.travel, true);
    assert.equal(r.z, 0);
    stepWorld(w, [KEY.up, 0]);
    assert.equal(r.z, 40);
  });
  it("fires all three weapons in either form, cycles off-axis contacts and preserves checked shot state", () => {
    for (const travel of [true, false]) {
      const w = world(),
        r = w.rigs[0]!,
        other = w.rigs[1]!;
      r.travel = travel;
      stepWorld(w, [KEY.fire | KEY.missile | KEY.special, 0]);
      assert.deepEqual(
        r.shots.map((s) => s.x - r.x),
        [1150, 1500, 650],
      );
      other.x = r.x;
      other.z = 490;
      w.drones.push({
        id: w.nextDrone++,
        team: 1,
        lane: 0,
        hp: 5,
        x: r.x,
        z: 500,
        waypoint: 0,
      });
      stepWorld(w, [KEY.lock, 0]);
      assert.equal(r.lock, 0);
      stepWorld(w, [[0, KEY.lock], 0]);
      assert.equal(r.lock, 1);
      for (let i = 0; i < 6; i++) stepWorld(w, [0, 0]);
      stepWorld(w, [KEY.fire, 0]);
      assert.equal(w.drones[0]!.hp, 4);
      assert.deepEqual(decodeWorld(w), w);
      r.heading = 64;
      assert.equal(decodeWorld(w), undefined);
    }
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
