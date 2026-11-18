import assert from "node:assert/strict";
import test from "node:test";
import { getLevel } from "../src/levels/index.js";
import { createWorld } from "../src/game/simulation.js";
import {
  bonkRuler,
  createRuler,
  stepRuler,
  validRulerState,
} from "../src/game/rulers.js";

function fight(round: number) {
  const level = getLevel(round);
  const world = createWorld(round - 1, [0], 19);
  const ruler = createRuler(level)!;
  world.enemies = [ruler];
  return { world, level, ruler };
}

test("a grounded body footprint takes one hit per bonk and rejects repeat hits", () => {
  const { ruler } = fight(6);
  ruler.x = 160;
  ruler.y = 192;
  ruler.grounded = true;
  const initial = ruler.hp;
  bonkRuler(ruler, 0, 12, false);
  assert.equal(ruler.hp, initial);
  bonkRuler(ruler, 5, 12, false);
  assert.equal(ruler.hp, initial - 1);
  assert.equal(ruler.vy, -8);
  bonkRuler(ruler, 5, 12, true);
  assert.equal(ruler.hp, initial - 1);
});

test("Shrew's rat attack is enabled by the encounter record and releases two opposite runners", () => {
  for (const [round, ratCount] of [
    [6, 0],
    [18, 2],
  ] as const) {
    const { world, level, ruler } = fight(round);
    ruler.ruler!.action = level.boss!.fields[9]!;
    ruler.x = 320;
    ruler.y = 208;
    ruler.grounded = true;
    stepRuler(world, level, ruler, () => {});
    const shots = ruler.ruler!.shots;
    assert.equal(shots.length, ratCount);
    if (shots.length) {
      assert.equal(shots[0]!.kind, "rat");
      assert.ok(shots[0]!.vx < 0);
      assert.ok(shots[1]!.vx > 0);
    }
  }
});

test("T.Wrecks crosses the playfield, then charges back from the opposite edge", () => {
  const { world, level, ruler } = fight(30);
  stepRuler(world, level, ruler, () => {});
  assert.equal(ruler.facing, 1);
  assert.ok(ruler.x < 0);
  for (let i = 0; i < 200 && ruler.facing === 1; i++)
    stepRuler(world, level, ruler, () => {});
  assert.equal(ruler.facing, -1);
  assert.ok(ruler.x > 640);
});

test("Deluxe FireControl probe with a stationary target below and right", () => {
  const { world, level, ruler } = fight(60);
  const p = world.players[0]!;
  p.x = 321;
  p.y = 244;
  ruler.ruler!.shots = [
    { kind: "fire", slot: 0, x: 120, y: 120, vx: 0, vy: 0, age: 0 },
  ];
  // Mac Deluxe CODE 2 +0x47c6, 68k routine with the contact callback stubbed out.
  // One active fireball, guidance counter 0, acceleration 24/16, speed limit 90/16.
  const samples = [];
  for (let tick = 1; tick <= 18; tick++) {
    world.tick = tick;
    stepRuler(world, level, ruler, () => {});
    if ([1, 8, 9, 17, 18].includes(tick)) {
      const shot = ruler.ruler!.shots[0]!;
      samples.push([shot.age, shot.vx * 16, shot.vy * 16]);
    }
  }
  assert.deepEqual(samples, [
    [1, 0, 0],
    [8, 0, 0],
    [9, 24, 24],
    [17, 24, 24],
    [18, 48, 48],
  ]);
});

test("a mid-teleport restore repeats the same unoccupied destination and subsequent ticks", () => {
  const { world, level, ruler } = fight(60);
  ruler.ruler!.flash = 10;
  const copy = structuredClone(world);
  const initial = [ruler.x, ruler.y];
  for (let tick = 1; tick <= 30; tick++) {
    world.tick = copy.tick = tick;
    stepRuler(world, level, ruler, () => {});
    stepRuler(copy, level, copy.enemies[0]!, () => {});
    assert.equal(validRulerState(ruler.ruler), true);
  }
  assert.notDeepEqual([ruler.x, ruler.y], initial);
  assert.deepEqual(copy, world);
  assert.equal(validRulerState({ ...ruler.ruler, shots: [{}, {}] }), false);
});
