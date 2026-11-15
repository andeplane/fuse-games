import assert from "node:assert/strict";
import { test } from "node:test";
import { botInput } from "../src/engine/classic/bots.js";
import { CLASSIC_WEAPONS } from "../src/engine/classic/catalog.js";
import { DEFAULT_SETTINGS } from "../src/engine/classic/match-types.js";
import {
  uniformTerrain,
  setMaterial,
  asPhysicsTerrain,
  AIR,
  ROCK,
} from "../src/engine/classic/terrain.js";
import {
  INPUT_MASK,
  CARVE,
  JUMP,
  ROPE,
  FIRE,
  UP,
  LEFT,
  SLOT1,
  stepWorm,
} from "../src/engine/classic/physics.js";
import type { World, Worm } from "../src/engine/classic/model.js";
import { createPositionRecorder } from "../src/engine/classic/history.js";

function weaponId(name: string): number {
  const weapon = CLASSIC_WEAPONS.find((weapon) => weapon.name === name);
  assert.ok(weapon);
  return weapon.id;
}
function worm(slot: number): Worm {
  return {
    id: `bot${slot}`,
    slot,
    x: 100 + slot * 90,
    y: 220,
    vx: 0,
    vy: 0,
    aim: 0,
    facing: 1,
    moveFacing: 1,
    aimSpeed: 0,
    onGround: true,
    input: 0,
    health: 100,
    alive: true,
    rope: null,
    weapon: 0,
    slots: Array.from({ length: 5 }, () => ({
      weaponId: weaponId("Laser"),
      charge: 1,
      reloading: false,
      lastFire: 0,
    })),
    kills: 0,
    deaths: 0,
    suicides: 0,
    damageScore: 0,
    lives: -2,
    respawnAtMs: null,
    spawnedOnce: true,
    respawnRequested: false,
    weaponsReady: true,
    lastInputTimeMs: 0,
    canRespawnNow: false,
    positionRecordings: createPositionRecorder(),
  };
}
function world(): World {
  return {
    seed: 1,
    rng: 1,
    step: 0,
    elapsedMs: 0,
    lastClientPhysicsMs: 0,
    pendingShots: [],
    phase: "play",
    winner: null,
    settings: { ...DEFAULT_SETTINGS },
    terrain: uniformTerrain(640, 480, AIR),
    worms: [worm(0), worm(1)],
    projectiles: [],
    effects: [],
    nextId: 1,
    bonuses: [],
    nextBonusAtMs: 30000,
  };
}
test("each bot returns bounded human controls without mutating authoritative state", () => {
  const state = world();
  state.worms = Array.from({ length: 5 }, (_, slot) => worm(slot));
  const previous = structuredClone(state);
  for (const current of state.worms) {
    const bits = botInput(state, current);
    assert.ok(Number.isInteger(bits));
    assert.equal(bits & ~INPUT_MASK, 0);
  }
  assert.deepEqual(state, previous);
});
test("all slots repeatedly carve and jump despite 50ms sampling and offset clocks", () => {
  for (let slot = 0; slot < 5; slot++) {
    const state = world(),
      current = worm(slot),
      target = worm((slot + 1) % 5);
    current.x = 100;
    target.x = 200;
    target.y = 160;
    state.worms = [current, target];
    setMaterial(state.terrain, 107, 220, ROCK);
    let previous = 0,
      jumps = 0,
      carves = 0;
    for (let tick = 0; tick < 160; tick++) {
      state.elapsedMs = 11 + tick * 50;
      const bits = botInput(state, current);
      if (bits & JUMP && !(previous & JUMP)) jumps++;
      if (bits & CARVE && !(previous & CARVE)) carves++;
      previous = bits;
    }
    assert.ok(jumps >= 3, `slot${slot} has repeated jump presses`);
    assert.ok(carves >= 30, `slot${slot} has repeated ordinary carve presses`);
  }
});
test("checkpoint copies and reordered peers produce identical decisions", () => {
  const state = world();
  state.worms.push(worm(2));
  state.elapsedMs = 17611;
  const copy = structuredClone(state);
  copy.worms.reverse();
  for (const current of state.worms) {
    const restored = copy.worms.find((w) => w.id === current.id);
    assert.ok(restored);
    assert.equal(botInput(state, current), botInput(copy, restored));
  }
});
test("dead, finished, unready and isolated bots release every control", () => {
  const state = world(),
    current = state.worms[0]!;
  current.alive = false;
  assert.equal(botInput(state, current), 0);
  current.alive = true;
  state.phase = "done";
  assert.equal(botInput(state, current), 0);
  state.phase = "play";
  current.weaponsReady = false;
  assert.equal(botInput(state, current), 0);
  current.weaponsReady = true;
  state.worms = [current];
  assert.equal(botInput(state, current), 0);
});
test("living zero-HP players are still valid targets", () => {
  const state = world(),
    current = state.worms[0]!,
    target = state.worms[1]!;
  target.health = 0;
  assert.ok(botInput(state, current) & FIRE);
  target.alive = false;
  assert.equal(botInput(state, current), 0);
});
test("aim and facing change only when the ordinary physics kernel applies controls", () => {
  const state = world(),
    current = state.worms[0]!,
    target = state.worms[1]!;
  target.x = 40;
  target.y = 100;
  const initial = structuredClone(current);
  const bits = botInput(state, current);
  assert.ok(bits & UP);
  assert.ok(bits & LEFT);
  assert.deepEqual(current, initial);
  stepWorm(current, state.worms, asPhysicsTerrain(state.terrain), bits);
  assert.equal(current.facing, -1);
  assert.ok(current.aim < 0 && current.aim > -1);
  assert.ok(Math.abs(current.x - initial.x) < 1);
});
test("line-of-sight uses actual terrain and avoids firing into an adjacent wall", () => {
  const state = world(),
    current = state.worms[0]!;
  assert.ok(botInput(state, current) & FIRE);
  setMaterial(state.terrain, 107, 220, ROCK);
  assert.equal(botInput(state, current) & FIRE, 0);
  setMaterial(state.terrain, 107, 220, AIR);
  assert.ok(botInput(state, current) & FIRE);
});
test("charged weapon selection uses a real direct-slot input and never edits charge", () => {
  const state = world(),
    current = state.worms[0]!;
  current.slots.forEach((slot) => {
    slot.charge = 0;
    slot.reloading = true;
  });
  current.slots[4]!.charge = 1;
  current.slots[4]!.reloading = false;
  const before = structuredClone(current.slots),
    bits = botInput(state, current);
  assert.ok(bits & (SLOT1 << 4));
  assert.equal(current.weapon, 0);
  assert.deepEqual(current.slots, before);
});
test("when every weapon is reloading the chosen slot stays selected to finish charging", () => {
  const state = world(),
    current = state.worms[0]!;
  current.slots.forEach((slot) => {
    slot.charge = 0.1;
    slot.reloading = true;
  });
  current.slots[3]!.charge = 0.9;
  const bits = botInput(state, current);
  assert.ok(bits & (SLOT1 << 3));
  assert.equal(bits & FIRE, 0);
  current.weapon = 3;
  assert.equal(botInput(state, current) & (SLOT1 << 3), 0);
});
test("rope launch is a press after aiming, release persists, and jump requests detachment", () => {
  const state = world(),
    current = state.worms[0]!,
    target = state.worms[1]!;
  target.y = 100;
  current.aim = -80;
  current.onGround = false;
  state.elapsedMs = 211;
  assert.ok(botInput(state, current) & ROPE);
  current.rope = {
    x: 250,
    y: 40,
    vx: 0,
    vy: 0,
    state: "falling",
    attachedId: null,
  };
  state.elapsedMs = 350;
  assert.equal(botInput(state, current) & ROPE, 0);
  state.elapsedMs = 1511;
  assert.ok(botInput(state, current) & JUMP);
});
