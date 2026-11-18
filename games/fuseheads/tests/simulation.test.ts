import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorld,
  INPUT_JUMP,
  INPUT_LEFT,
  INPUT_RIGHT,
  SIM_HZ,
  stepWorld,
  validWorld,
  type Enemy,
} from "../src/game/simulation.js";
import { getLevel, type FuseLevel } from "../src/levels/index.js";

function referenceBoard(): FuseLevel {
  const level = getLevel(1);
  return {
    ...level,
    tiles: Array.from({ length: 600 }, (_, i) =>
      Math.floor(i / 20) === 15 ? 2 : 0,
    ),
    pests: [{ ...level.pests[0]!, spacing: 1000 }],
  };
}

test("Deluxe 68k ProcessSprite then Player1Processor trace, 640×480 coordinate system, 30 updates/s", () => {
  const level = referenceBoard(),
    world = createWorld(0, [0], 41);
  const p = world.players[0]!;
  p.x = 120 + 24;
  p.y = 192 + 48;
  world.nextSpawnAt = 1000;
  assert.equal(SIM_HZ, 30);
  // Tuples from the independent CPU probe, in native top-left sixteenths.
  const samples = new Map([
    [0, [1920, 3072, 0, 0]],
    [1, [1920, 3072, 24, 0]],
    [2, [1944, 3056, 48, -236]],
    [3, [1992, 2820, 72, -221]],
    [4, [2064, 2599, 96, -206]],
    [5, [2160, 2393, 96, -191]],
    [18, [2784, 1080, 0, 4]],
    [34, [2784, 2944, 0, 244]],
    [35, [2784, 3072, 0, 0]],
  ]);
  for (let frame = 0; frame < 36; frame++) {
    const input =
      (frame >= 1 && frame <= 5 ? INPUT_RIGHT : 0) |
      (frame >= 2 && frame <= 4 ? INPUT_JUMP : 0);
    stepWorld(world, [input], level);
    if (samples.has(frame))
      assert.deepEqual(
        [(p.x - 24) * 16, (p.y - 48) * 16, p.vx * 16, p.vy * 16],
        samples.get(frame),
        `frame ${frame}`,
      );
  }
});

test("Surfaceville's first dog spawns only after its ten-tick entrance delay", () => {
  const world = createWorld(0, [0], 42);
  for (let i = 0; i < 10; i++) stepWorld(world, [0]);
  assert.equal(world.enemies.length, 0);
  stepWorld(world, [0]);
  assert.equal(world.enemies[0]?.type, 7);
  assert.equal(world.enemies[0]?.id, 0);
  assert.equal(world.nextPest, 1);
});

test("a checkpoint in midair retains the jump latch and reproduces every subsequent state", () => {
  const world = createWorld(0, [1, 0], 53);
  for (let i = 0; i < 10; i++)
    stepWorld(world, [INPUT_RIGHT, INPUT_LEFT | INPUT_JUMP]);
  assert.equal(validWorld(world), true);
  const restored = structuredClone(world);
  for (let i = 0; i < 1000; i++) {
    const masks = [
      i % 57 < 31 ? INPUT_RIGHT | INPUT_JUMP : 0,
      i % 41 < 22 ? INPUT_LEFT : INPUT_JUMP,
    ];
    stepWorld(world, masks);
    stepWorld(restored, masks);
    assert.deepEqual(restored, world);
    assert.equal(validWorld(world), true, `invalid after ${i}`);
  }
  assert.equal(
    validWorld({ ...world, players: [world.players[0], world.players[0]] }),
    false,
  );
  assert.equal(
    validWorld({ ...world, enemies: [{ ...world.enemies[0], type: 999 }] }),
    false,
  );
  assert.equal(validWorld({ ...world, levelIndex: 999 }), false);
});

test("TNT bonks toggle only grounded pests, use one charge and preserve charges across stages", () => {
  const initial = referenceBoard(),
    tiles = Array.from(initial.tiles);
  tiles[4 + 10 * 20] = 50;
  const level = { ...initial, tiles };
  const world = createWorld(0, [0], 5);
  const p = world.players[0]!;
  const underCrate = () => {
    p.x = 144;
    p.y = 16 * 11 + 48;
    p.vy = -4;
  };
  const enemy: Enemy = {
    id: 0,
    type: 7,
    x: 300,
    y: 240,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    anger: 0,
    stun: 0,
    hp: 1,
    kicked: false,
    phase: 0,
    variation: 0,
  };
  world.enemies.push(enemy, { ...enemy, x: 350, y: 180, grounded: false });
  underCrate();
  stepWorld(world, [0], level);
  assert.equal(world.tnt, 2);
  assert.ok(enemy.stun > 0);
  assert.equal(world.enemies[1]!.stun, 0);
  enemy.grounded = true;
  underCrate();
  stepWorld(world, [0], level);
  assert.equal(world.tnt, 1);
  assert.equal(enemy.stun, 0);
  assert.equal(enemy.anger, 1);
  p.score = 450;
  p.lives = 2;
  const next = createWorld(1, [0], world.rng, world);
  assert.deepEqual(
    [next.tnt, next.players[0]!.lives, next.players[0]!.score],
    [1, 2, 450],
  );
  assert.equal(createWorld(5, [0], world.rng, world).tnt, 2);
});
