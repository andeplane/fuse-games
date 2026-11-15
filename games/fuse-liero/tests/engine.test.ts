import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorld,
  stepWorld,
  botInput,
  encodeWorld,
  decodeWorld,
  toView,
  solid,
  blocked,
  destroyTerrain,
  seedOf,
  DEFAULT_SETTINGS,
  parseSettings,
  COUNTDOWN_STEPS,
  ROUND_STEPS,
  STEPS_PER_TICK,
  COLS,
  ROWS,
  LEFT,
  RIGHT,
  UP,
  JUMP,
  FIRE,
  ROPE,
  NEXT,
  FRAG_TARGET,
  type World,
} from "../src/engine/index.js";

const seats = [
  { id: "alice", slot: 0 },
  { id: "bob", slot: 1 },
];
const room = () => createWorld(123, seats, DEFAULT_SETTINGS);
function advance(
  world: World,
  n: number,
  input = new Map<string, number>(),
): void {
  for (let i = 0; i < n; i++) stepWorld(world, input);
}
/** A flat test arena supplies known collision geometry through public authoritative state. */
function flat(): World {
  const world = room();
  world.terrain = Array.from({ length: ROWS }, (_, y) =>
    y < 2 || y >= ROWS - 2
      ? "2".repeat(COLS)
      : "22" + (y >= 80 ? "1" : "0").repeat(COLS - 4) + "22",
  );
  world.step = COUNTDOWN_STEPS + 1;
  world.phase = "play";
  world.worms.forEach((w, i) =>
    Object.assign(w, { x: 100 + i * 80, y: 315, grace: 0 }),
  );
  return world;
}
test("settings are exact and bounded", () => {
  assert.deepEqual(parseSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  for (const raw of [
    { ...DEFAULT_SETTINGS, wins: 0 },
    { ...DEFAULT_SETTINGS, wins: 100 },
    { ...DEFAULT_SETTINGS, extra: 1 },
    null,
  ])
    assert.equal(parseSettings(raw), undefined);
});
test("seeded cave generation and spawn placement are stable and safe", () => {
  const world = room();
  assert.deepEqual(world, room());
  assert.notDeepEqual(
    world.terrain,
    createWorld(124, seats, DEFAULT_SETTINGS).terrain,
  );
  for (const worm of world.worms)
    assert.equal(blocked(world, worm.x, worm.y), false);
  assert.equal(seedOf("repeat"), seedOf("repeat"));
});
test("countdown admits no play, starts once the complete countdown expires", () => {
  const world = room(),
    x = world.worms[0]!.x;
  advance(world, COUNTDOWN_STEPS, new Map([["alice", RIGHT | FIRE]]));
  assert.equal(world.phase, "countdown");
  assert.equal(world.worms[0]!.x, x);
  assert.equal(world.projectiles.length, 0);
  stepWorld(world, new Map([["alice", RIGHT]]));
  assert.equal(world.phase, "play");
  assert.ok(world.worms[0]!.x > x);
});
test("held movement stops on release and cannot walk through the arena boundary", () => {
  const world = flat(),
    worm = world.worms[0]!;
  advance(world, 35, new Map([[worm.id, RIGHT]]));
  assert.ok(worm.x > 150);
  const released = worm.x;
  advance(world, 35);
  assert.ok(worm.x - released < 15);
  advance(world, 500, new Map([[worm.id, LEFT]]));
  assert.ok(worm.x >= 12);
  assert.equal(blocked(world, worm.x, worm.y), false);
});
test("jump is an edge, not repeated auto-jumping while held", () => {
  const world = flat(),
    worm = world.worms[0]!;
  const floor = worm.y;
  stepWorld(world, new Map([[worm.id, JUMP]]));
  assert.ok(worm.y < floor);
  advance(world, 120, new Map([[worm.id, JUMP]]));
  assert.ok(Math.abs(worm.y - floor) < 1);
  stepWorld(world, new Map());
  stepWorld(world, new Map([[worm.id, JUMP]]));
  assert.ok(worm.y < floor - 1);
});
test("ninja rope latches overhead, reels on jump and releases immediately", () => {
  const world = flat(),
    worm = world.worms[0]!;
  worm.y = 100;
  worm.aim = 24;
  stepWorld(world, new Map([[worm.id, ROPE]]));
  assert.ok(worm.rope);
  assert.equal(solid(world, worm.rope.x, worm.rope.y), true);
  const length = worm.rope.length;
  advance(world, 10, new Map([[worm.id, ROPE | JUMP]]));
  assert.ok(worm.rope!.length < length);
  stepWorld(world, new Map());
  assert.equal(worm.rope, null);
});
test("destroying a rope's dirt anchor detaches it safely", () => {
  const world = flat(),
    worm = world.worms[0]!;
  worm.aim = 8;
  stepWorld(world, new Map([[worm.id, ROPE]]));
  assert.ok(worm.rope);
  destroyTerrain(world, worm.rope.x, worm.rope.y, 20);
  stepWorld(world, new Map([[worm.id, ROPE]]));
  assert.equal(worm.rope, null);
});
test("rocket craters destroy dirt while retaining the indestructible shell", () => {
  const world = flat(),
    worm = world.worms[0]!;
  worm.aim = 8;
  const before = world.terrain.join("").split("1").length;
  advance(world, 4, new Map([[worm.id, FIRE]]));
  assert.ok(world.terrain.join("").split("1").length < before);
  destroyTerrain(world, 0, 0, 40);
  assert.equal(world.terrain[0], "2".repeat(COLS));
});
test("all three weapons have different projectile behavior and bounded cooldown", () => {
  for (const weapon of [0, 1, 2] as const) {
    const world = flat(),
      worm = world.worms[0]!;
    worm.weapon = weapon;
    worm.aim = 24;
    worm.y = 200;
    stepWorld(world, new Map([[worm.id, FIRE]]));
    assert.equal(world.projectiles.length, weapon === 2 ? 5 : 1);
    assert.equal(world.projectiles[0]!.weapon, weapon);
    assert.ok(worm.cooldown > 0);
    const vx = world.projectiles[0]!.vx,
      vy = world.projectiles[0]!.vy;
    stepWorld(world, new Map([[worm.id, FIRE]]));
    assert.equal(world.projectiles.length, weapon === 2 ? 5 : 1);
    if (weapon === 1) assert.ok(world.projectiles[0]!.vy > vy);
    else assert.equal(world.projectiles[0]!.vx, vx);
  }
});
test("weapon switch uses rising edges and fire cannot bypass reload", () => {
  const world = flat(),
    worm = world.worms[0]!;
  worm.aim = 24;
  worm.y = 200;
  advance(world, 10, new Map([[worm.id, NEXT | FIRE]]));
  assert.equal(worm.weapon, 1);
  assert.equal(world.projectiles.length, 1);
  stepWorld(world, new Map());
  stepWorld(world, new Map([[worm.id, NEXT]]));
  assert.equal(worm.weapon, 2);
});
test("kills award the attacker a frag and respawn with temporary protection", () => {
  const world = flat(),
    a = world.worms[0]!,
    b = world.worms[1]!;
  b.health = 1;
  b.x = 145;
  a.aim = 0;
  advance(world, 10, new Map([[a.id, FIRE]]));
  assert.equal(b.health, 0);
  assert.equal(a.frags, 1);
  assert.equal(b.deaths, 1);
  advance(world, 90);
  assert.equal(b.health, 100);
  assert.ok(b.grace > 0);
  assert.equal(blocked(world, b.x, b.y), false);
});
test("frag target ends the round and the winner survives further stepping", () => {
  const world = flat(),
    a = world.worms[0]!,
    b = world.worms[1]!;
  a.frags = FRAG_TARGET - 1;
  b.health = 1;
  b.x = 145;
  a.aim = 0;
  advance(world, 10, new Map([[a.id, FIRE]]));
  assert.equal(world.phase, "done");
  assert.equal(world.winner, a.id);
  const finished = encodeWorld(world);
  advance(world, 50);
  assert.deepEqual(encodeWorld(world), finished);
});
test("stalemates end at the finite deadline with stable placing tie-breaks", () => {
  const world = flat();
  world.step = COUNTDOWN_STEPS + ROUND_STEPS - 1;
  stepWorld(world, new Map());
  assert.equal(world.phase, "done");
  assert.equal(world.winner, "alice");
});
test("checkpoints and immutable views roundtrip without aliasing mutable records", () => {
  const world = flat();
  advance(world, 20, new Map([["alice", FIRE | RIGHT]]));
  const decoded = decodeWorld(encodeWorld(world));
  assert.deepEqual(decoded, world);
  decoded!.worms[0]!.health = 1;
  decoded!.terrain[2] = "0".repeat(COLS);
  assert.notEqual(world.worms[0]!.health, 1);
  assert.notEqual(world.terrain[2], decoded!.terrain[2]);
  const view = toView(world);
  view.worms[0]!.rope = { x: 0, y: 0, length: 20 };
  assert.equal(world.worms[0]!.rope, null);
});
test("hostile or contradictory checkpoints fail atomically", () => {
  const world = flat();
  const changes: Array<(w: World) => void> = [
    (w) => {
      w.worms[0]!.x = NaN;
    },
    (w) => {
      w.terrain[0] = "0".repeat(COLS);
    },
    (w) => {
      w.worms[1]!.id = w.worms[0]!.id;
    },
    (w) => {
      w.phase = "done";
      w.winner = "absent";
    },
    (w) => {
      w.worms[0]!.health = 0;
    },
    (w) => {
      w.worms[0]!.rope = { x: 0, y: 0, length: 1 };
    },
  ];
  for (const change of changes) {
    const raw = toView(world);
    change(raw);
    assert.equal(decodeWorld(raw), undefined);
  }
  assert.equal(world.worms[0]!.health, 100);
});
test("checkpoint replay reproduces cave destruction, input edges, projectiles and bots", () => {
  const original = room();
  advance(original, COUNTDOWN_STEPS + 1);
  for (let i = 0; i < 220; i++)
    stepWorld(
      original,
      new Map(original.worms.map((w) => [w.id, botInput(original, w)])),
    );
  const restored = decodeWorld(encodeWorld(original));
  assert.ok(restored);
  for (let i = 0; i < 300; i++) {
    const controls = new Map(
      original.worms.map((w) => [w.id, botInput(original, w)]),
    );
    stepWorld(original, controls);
    stepWorld(restored, controls);
    assert.deepEqual(restored, original);
  }
});
test("several bot matches remain bounded and checkpoints remain valid", () => {
  for (const seed of [1, 17, 999]) {
    const world = createWorld(seed, seats, DEFAULT_SETTINGS);
    for (let i = 0; i < 1800; i++) {
      stepWorld(
        world,
        new Map(world.worms.map((w) => [w.id, botInput(world, w)])),
      );
      if (i % 200 === 0)
        assert.ok(
          decodeWorld(encodeWorld(world)),
          `seed ${seed} step ${world.step}`,
        );
    }
    assert.ok(world.effects.length <= 64);
    assert.ok(world.projectiles.length <= 128);
  }
});
test("every bot slot repeatedly jumps and switches weapons at the room's sampled input rate", () => {
  const world = createWorld(
    3,
    Array.from({ length: 5 }, (_, slot) => ({ id: `bot${slot}`, slot })),
    DEFAULT_SETTINGS,
  );
  advance(world, COUNTDOWN_STEPS + STEPS_PER_TICK);
  const observed = world.worms.map(() => ({
    previous: 0,
    jumps: 0,
    switches: 0,
    weapons: new Set<number>([0]),
  }));
  for (let tick = 0; tick < 180; tick++) {
    const inputs = new Map<string, number>();
    for (const [index, worm] of world.worms.entries()) {
      const bits = botInput(world, worm),
        record = observed[index]!;
      if (bits & JUMP && !(record.previous & JUMP)) record.jumps++;
      if (bits & NEXT && !(record.previous & NEXT)) record.switches++;
      record.previous = bits;
      // Exercise movement and weapon changes without combat ending this scheduling workload early.
      inputs.set(worm.id, bits & ~FIRE);
    }
    advance(world, STEPS_PER_TICK, inputs);
    for (const [index, worm] of world.worms.entries())
      observed[index]!.weapons.add(worm.weapon);
  }
  for (const [slot, record] of observed.entries()) {
    assert.ok(record.jumps >= 2, `slot ${slot} repeatedly emits jump edges`);
    assert.ok(
      record.switches >= 2,
      `slot ${slot} repeatedly emits switch edges`,
    );
    assert.deepEqual(
      [...record.weapons].sort(),
      [0, 1, 2],
      `slot ${slot} actually cycles through every weapon`,
    );
  }
});
