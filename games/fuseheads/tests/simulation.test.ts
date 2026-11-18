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
import oracle from "./reference/deluxe.json" with { type: "json" };

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
  for (let frame = 0; frame < oracle.motion.length; frame++) {
    const input =
      (frame >= 1 && frame <= 5 ? INPUT_RIGHT : 0) |
      (frame >= 2 && frame <= 4 ? INPUT_JUMP : 0);
    stepWorld(world, [input], level);
    assert.deepEqual(
      [(p.x - 24) * 16, (p.y - 48) * 16, p.vx * 16, p.vy * 16],
      oracle.motion[frame],
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

test("the measured grounded demon and cobra velocity sequences match the native SpecialEnemy branches", () => {
  for (const kind of [19, 27] as const) {
    const base = referenceBoard();
    const level = {
      ...base,
      pests: [{ ...base.pests[0]!, type: kind, speed: 16, temper: 7 }],
    };
    // This seed produces random-chart value 10 on the first cobra decision, as in the probe.
    const w = createWorld(0, [0], 7);
    w.nextSpawnAt = 0;
    stepWorld(w, [0], level);
    Object.assign(w.players[0]!, { x: 72, y: 200 });
    const e = w.enemies[0]!;
    Object.assign(e, { x: 144, y: 240, vx: 1, vy: 0, grounded: true });
    const samples: number[] = [];
    for (let step = 0; step < 12; step++) {
      stepWorld(w, [0], level);
      if (step < 2 || step >= 8) samples.push(e.vx * 16);
    }
    assert.deepEqual(
      samples,
      oracle.specialEnemy[kind].map((row) => row[0]),
      `pest ${kind}`,
    );
  }
});

test("Deluxe dog bonk, recovery, lower exit and one-pixel kick threshold", () => {
  const base = referenceBoard(),
    tiles = Array.from(base.tiles);
  tiles[4 + 20 * 15] = 3;
  const level = {
    ...base,
    tiles,
    pests: [{ ...base.pests[0]!, speed: 16, temper: 7, points: 150 }],
  };
  const world = createWorld(0, [0], 1),
    p = world.players[0]!;
  world.nextSpawnAt = 0;
  stepWorld(world, [0], level);
  const e = world.enemies[0]!;
  Object.assign(e, { x: 144, y: 240, vx: 0, vy: 0, grounded: true });
  Object.assign(p, { x: 144, y: 304, vy: -2 });
  stepWorld(world, [0], level);
  assert.deepEqual(
    [e.vx * 16, e.vy * 16, e.stun],
    [oracle.pests.bonk.vx16, oracle.pests.bonk.vy16, 501],
  );
  Object.assign(p, { x: 450, y: 240, vy: 0 });
  Object.assign(e, { stun: 2, y: 240, vy: 0 });
  stepWorld(world, [0], level);
  assert.equal(e.stun, 1);
  stepWorld(world, [0], level);
  assert.equal(e.vx * 16, oracle.pests.awake.vx16);
  Object.assign(e, { x: -9, y: 335, vx: 0, vy: 0 });
  stepWorld(world, [0], level);
  assert.deepEqual(
    [(e.x - 16) * 16, (e.y - 32) * 16, e.vx * 16],
    oracle.pests.escaped,
  );
  Object.assign(e, { x: 116, y: 72, vx: 0, vy: 0, stun: 200 });
  Object.assign(p, { x: 150, y: 78, vx: 0, vy: 0 });
  stepWorld(world, [0], level);
  assert.equal(Number(e.kicked), oracle.pests.kickEdge);
  Object.assign(p, { x: 146, y: 78, vx: 3, vy: 0 });
  stepWorld(world, [INPUT_RIGHT], level);
  assert.equal(Number(e.kicked), oracle.pests.kickOverlap);
  assert.deepEqual(
    [e.vx * 16, e.vy * 16, p.score],
    [
      oracle.pests.kicked.vx16,
      oracle.pests.kicked.vy16,
      oracle.pests.scoreDelta[0],
    ],
  );
  for (let i = 0; i < 200 && world.outcome === "playing"; i++)
    stepWorld(world, [0], level);
  assert.equal(world.outcome, "cleared");
});

test("a spent final life ends the run and ordinary respawns require emergence", () => {
  const level = referenceBoard(),
    world = createWorld(0, [0], 3),
    p = world.players[0]!;
  world.nextSpawnAt = 0;
  stepWorld(world, [0], level);
  const e = world.enemies[0]!;
  const contact = () => {
    Object.assign(e, { x: 145, y: 240, vx: 0, vy: 0 });
    Object.assign(p, { x: 145, y: 240, vx: 0, vy: 0 });
    stepWorld(world, [0], level);
  };
  contact();
  assert.equal(p.respawn, "rising");
  assert.equal(p.lives, 2);
  for (let i = 0; i < 10; i++) stepWorld(world, [0], level);
  assert.equal(p.respawn, "waiting");
  stepWorld(world, [INPUT_JUMP], level);
  for (let i = 0; i < 16; i++) stepWorld(world, [0], level);
  assert.equal(p.respawn, "active");
  p.lives = 1;
  contact();
  assert.equal(world.outcome, "lost");
});

test("bonus explosive arms locally and its later blast respects shield immunity", () => {
  const base = referenceBoard(),
    tiles = Array.from(base.tiles);
  tiles[4 + 20 * 15] = 26;
  const level = { ...base, tiles },
    world = createWorld(0, [0, 1], 1);
  const [p, q] = world.players as [
    (typeof world.players)[number],
    (typeof world.players)[number],
  ];
  Object.assign(p, { x: 144, y: 240 });
  Object.assign(q, { x: 150, y: 240, invincible: 100 });
  stepWorld(world, [0, 0], level);
  assert.equal(world.explosions[0]!.age, 1);
  assert.equal(p.lives, 3);
  for (let i = 0; i < 31; i++) stepWorld(world, [0, 0], level);
  assert.equal(p.lives, 2);
  assert.equal(q.lives, 3);
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
  enemy.y = 240;
  enemy.vy = 0;
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
