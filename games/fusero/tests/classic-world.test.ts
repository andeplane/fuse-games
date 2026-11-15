import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createWorld,
  stepWorld,
  OUTER_MS,
} from "../src/engine/classic/world.js";
import { DEFAULT_SETTINGS, recordInjury } from "../src/engine/classic/match.js";
import { FIRE, JUMP, RIGHT } from "../src/engine/classic/physics-types.js";
import { CLASSIC_WEAPONS } from "../src/engine/classic/catalog.js";
import { uniformTerrain, AIR } from "../src/engine/classic/terrain.js";
import type { World } from "../src/engine/classic/model.js";

const seats = [
  { id: "a", slot: 0 },
  { id: "b", slot: 1 },
];
const manual = () =>
  createWorld(716, seats, { ...DEFAULT_SETTINGS, maxRespawnTimeMs: -1 });
function advance(world: World, milliseconds: number, input = 0) {
  assert.equal(
    milliseconds % OUTER_MS,
    0,
    "advance uses exact native outer frames",
  );
  for (let elapsed = 0; elapsed < milliseconds; elapsed += OUTER_MS)
    stepWorld(world, new Map([["a", input]]));
}
function kill(world: World) {
  assert.equal(recordInjury(world, "a", 101, "b", world.settings).killed, true);
  assert.equal(world.worms[0]!.alive, false);
}

test("manual native respawn ignores fire and early/held jump; a new post-delay jump respawns", () => {
  const world = manual(),
    worm = world.worms[0]!;
  kill(world);
  advance(world, 40, FIRE);
  advance(world, 3_000, JUMP);
  assert.equal(
    worm.alive,
    false,
    "an early held jump cannot carry a request across the delay",
  );
  assert.equal(worm.respawnRequested, false);
  advance(world, 20);
  advance(world, 20, FIRE);
  assert.equal(
    worm.alive,
    false,
    "a fresh fire after the delay also does not request respawn",
  );
  advance(world, 20);
  advance(world, 20, JUMP);
  assert.equal(worm.alive, true);
  assert.equal(worm.health, 100);
  assert.equal(
    worm.input & JUMP,
    JUMP,
    "the respawn press has already been consumed",
  );
});

test("default native automatic respawn has the strict 2.5-second gate and no invented invulnerability", () => {
  const world = createWorld(3, seats, DEFAULT_SETTINGS),
    worm = world.worms[0]!;
  kill(world);
  advance(world, 2_500);
  assert.equal(worm.alive, false);
  stepWorld(world, new Map());
  assert.equal(world.elapsedMs, 2_510);
  assert.equal(worm.alive, false, "the native gate is strict at exactly2500ms");
  stepWorld(world, new Map());
  assert.equal(world.elapsedMs, 2_520);
  assert.equal(worm.alive, true);
  assert.ok(
    worm.slots.every(
      (slot) => slot.charge === 1 && !slot.reloading && slot.lastFire === 0,
    ),
  );
  assert.equal(recordInjury(world, "a", 1, "b", world.settings).damage, 1);
  assert.equal(worm.health, 99);
});

test("queued beams arrive next outer frame after both server shots consume charge", () => {
  const laser = CLASSIC_WEAPONS.find((weapon) => weapon.name === "Laser")!.id;
  const handgun = CLASSIC_WEAPONS.find(
    (weapon) => weapon.name === "Handgun",
  )!.id;
  const world = createWorld(
    9,
    [
      { ...seats[0]!, loadout: Array(5).fill(laser) as number[] },
      { ...seats[1]!, loadout: Array(5).fill(handgun) as number[] },
    ],
    { ...DEFAULT_SETTINGS, restrictionPreset: "all" },
  );
  world.terrain = uniformTerrain(504, 350, AIR);
  Object.assign(world.worms[0]!, {
    x: 100,
    y: 100,
    aim: 0,
    facing: 1,
    vx: 0,
    vy: 0,
  });
  Object.assign(world.worms[1]!, {
    x: 130,
    y: 100,
    aim: 0,
    facing: 1,
    vx: 10,
    vy: 0,
    health: 0,
  });
  const inputs = new Map([
    ["a", FIRE],
    ["b", FIRE | RIGHT],
  ]);
  stepWorld(world, inputs);
  stepWorld(world, inputs);
  assert.equal(
    world.lastClientPhysicsMs,
    0,
    "the first two outer frames precede11ms physics",
  );
  stepWorld(world, inputs);
  const victim = world.worms[1]!;
  assert.ok(
    victim.x > 130,
    "the later worm's physical step precedes the beam injury",
  );
  assert.equal(
    victim.alive,
    true,
    "shots remain queued until the following outer frame",
  );
  assert.equal(world.pendingShots.length, 2);
  assert.ok(
    victim.slots[0]!.charge < 1,
    "the server queued and charged its shot before the beam arrived",
  );
  stepWorld(world, inputs);
  assert.equal(victim.alive, false);
  assert.equal(
    world.projectiles.some((projectile) => projectile.owner === "b"),
    false,
    "native processing discards a queued shot whose owner was killed",
  );
});

test("integrated local/listen Laser matches all200 native outer-frame slot and queue states", () => {
  const reference = JSON.parse(
    readFileSync(
      new URL("./fixtures/classic-combat-native.json", import.meta.url),
      "utf8",
    ),
  ) as {
    localLaserFrames: {
      frame: number;
      physicsMs: number;
      shot: boolean;
      pending: number;
      lastFire: number;
      charge: number;
    }[];
  };
  const laser = CLASSIC_WEAPONS.find((weapon) => weapon.name === "Laser")!.id;
  const world = createWorld(
    9,
    [{ id: "a", slot: 0, loadout: [laser, laser, laser, laser, laser] }],
    { ...DEFAULT_SETTINGS, restrictionPreset: "all" },
  );
  world.terrain = uniformTerrain(504, 350, AIR);
  Object.assign(world.worms[0]!, {
    x: 100,
    y: 100,
    aim: 0,
    facing: 1,
    vx: 0,
    vy: 0,
  });
  assert.equal(reference.localLaserFrames.length, 200);
  for (const expected of reference.localLaserFrames) {
    assert.equal(world.elapsedMs, expected.frame * OUTER_MS);
    stepWorld(world, new Map([["a", FIRE]]));
    const slot = world.worms[0]!.slots[0]!;
    assert.deepEqual(
      {
        frame: expected.frame,
        physicsMs: world.lastClientPhysicsMs,
        shot: world.pendingShots.length > 0,
        pending: world.pendingShots.length,
        lastFire: slot.lastFire,
        charge: slot.charge,
      },
      expected,
    );
  }
});
