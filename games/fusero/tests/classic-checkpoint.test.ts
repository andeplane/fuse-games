import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_SNAPSHOT_BYTES, packMessage } from "fuse-netcode";
import {
  decodeWorld,
  encodeWorld,
  toView,
} from "../src/engine/classic/codec.js";
import { DEFAULT_SETTINGS } from "../src/engine/classic/match-types.js";
import {
  createPositionRecorder,
  recordedPosition,
  recordPosition,
  resetPositionRecorder,
} from "../src/engine/classic/history.js";
import type { World, Worm } from "../src/engine/classic/model.js";
import { createNativeAiShared } from "../src/engine/classic/ai-state.js";
import {
  DIRT,
  AIR,
  CLASSIC_MATERIALS,
  encodeTerrainRow,
  carveHole,
  materialAt,
  uniformTerrain,
} from "../src/engine/classic/terrain.js";
import { CLASSIC_WEAPONS } from "../src/engine/classic/catalog.js";
import {
  MAX_CLASSIC_PROJECTILES,
  type ClassicProjectileState,
} from "../src/engine/classic/combat-types.js";
import { fireWeapon } from "../src/engine/classic/weapons.js";
import {
  spawnClassicProjectile,
  stepProjectiles,
} from "../src/engine/classic/projectiles.js";
import { recordInjury } from "../src/engine/classic/match.js";
import { FIXED_RANDOM } from "../src/engine/classic/random.js";
import { createWorld, stepWorld } from "../src/engine/classic/world.js";
import {
  CARVE,
  FIRE,
  JUMP,
  LEFT,
  NEXT,
  RIGHT,
  ROPE,
  UP,
} from "../src/engine/classic/physics-types.js";

function actor(id: string, slot: number): Worm {
  return {
    id,
    slot,
    x: 30 + slot * 50,
    y: 50,
    vx: 0,
    vy: 0,
    aim: 0,
    facing: 1,
    moveFacing: 1,
    aimSpeed: 0,
    onGround: false,
    input: 0,
    lastInputTimeMs: 0,
    canRespawnNow: false,
    ai: null,
    health: 100,
    alive: true,
    rope: null,
    weapon: 0,
    slots: Array.from({ length: 5 }, () => ({
      weaponId: 2,
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
    positionRecordings: createPositionRecorder(),
  };
}
function fixture(): World {
  const terrain = uniformTerrain(128, 96, DIRT);
  carveHole(terrain, 4, 30, 50);
  return {
    seed: 519,
    rng: 0xffff_ffff,
    step: 22_000,
    elapsedMs: 220_000,
    lastClientPhysicsMs: 219_989,
    pendingShots: [],
    phase: "play",
    winner: null,
    settings: { ...DEFAULT_SETTINGS },
    terrain,
    worms: [actor("alice", 0), actor("bob", 1)],
    bonuses: [],
    nextBonusAtMs: 250_000,
    nextId: 1,
    projectiles: [],
    effects: [],
    aiShared: createNativeAiShared(),
  };
}

test("Classic checkpoints preserve pixel edits, source edge states, slots, rope and native decision state", () => {
  const world = fixture(),
    alice = world.worms[0]!,
    bob = world.worms[1]!;
  alice.health = 0; // CGameObject::injure leaves exactly zero alive.
  alice.vx = 3_000; // Native recoil is not the prototype's clamped velocity.
  alice.aim = Math.fround(-32.2);
  alice.aimSpeed = Math.fround(129.991);
  alice.weapon = 4;
  alice.slots[0] = {
    weaponId: 2,
    charge: Math.fround(0.3),
    reloading: true,
    lastFire: Math.fround(-0.005),
  };
  alice.rope = {
    state: "worm",
    attachedId: bob.id,
    x: bob.x,
    y: bob.y,
    vx: 0,
    vy: 0,
  };
  recordPosition(alice.positionRecordings, { x: 29, y: 50 });
  recordPosition(alice.positionRecordings, { x: 28, y: 50 });
  resetPositionRecorder(alice.positionRecordings, alice);
  bob.health = 0;
  bob.alive = false;
  bob.respawnAtMs = 222_500;
  world.projectiles.push({
    id: 1,
    slot: 0,
    descriptorId: 0,
    owner: alice.id,
    weaponId: 0,
    x: 40,
    y: 40,
    vx: 700,
    vy: Math.fround(-30.5),
    oldX: 39,
    oldY: 40,
    life: Math.fround(180.01),
    extra: Math.fround(0.4),
    randomIndex: 254,
    timeVarRandom: FIXED_RANDOM[9]!,
    spawnTimeMs: 39_990,
    lastSimulationMs: 220_000,
    ignoreOwnerBeforeMs: 40_090,
    wallShootTime: Math.fround(0.011),
    lastTrailMs: 220_020, // Native custom trails store their next deadline, which may be in the future.
    rotation: 359,
    frame: Math.fround(1.5),
    frameDelta: false,
    firstBounce: true,
    minCheck: 1,
    maxCheck: 4,
    avgCheck: 2,
    checkSpeedLen: 490_000,
    collisionSide: 0,
    used: true,
  });
  world.effects.push({
    id: 2,
    kind: "beam",
    x: 30,
    y: 50,
    endX: 127,
    endY: 55,
    owner: alice.id,
    radius: 1,
    lifeMs: 120,
  });
  // Bonus slots have their own native namespace and can overlap a projectile's ID.
  world.bonuses.push({
    id: 1,
    type: "health",
    weaponId: -1,
    x: 60,
    y: 50,
    vx: 0,
    vy: Math.fround(0.88),
    life: Math.fround(1.001),
    flashTime: 0,
    spawnedAtMs: 219_000,
  });
  world.nextId = 3;
  assert.deepEqual(decodeWorld(encodeWorld(world)), world);
  const before = structuredClone(world);
  const view = toView(world);
  view.worms[0]!.rope!.x = 1;
  view.worms[0]!.slots[0]!.charge = 1;
  view.worms[0]!.positionRecordings.positions[0]!.x = 1;
  view.projectiles[0]!.randomIndex = 1;
  view.effects[0]!.endX = 1;
  view.bonuses[0]!.x = 1;
  carveHole(view.terrain, 4, 70, 50);
  assert.deepEqual(world, before);
  assert.equal(materialAt(world.terrain, 70, 50), DIRT);
});

test("invalid source checkpoints reject atomically rather than changing healthy authoritative state", () => {
  const healthy = fixture(),
    before = structuredClone(healthy);
  const cases: Array<(candidate: World) => void> = [
    (world) => {
      world.elapsedMs++;
    },
    (world) => {
      world.worms[0]!.vx = Number.NaN;
    },
    (world) => {
      world.worms[0]!.aimSpeed = 0.1;
    }, // Not an exact native float32.
    (world) => {
      world.worms[0]!.slots[0]!.charge = 2;
    },
    (world) => {
      world.worms[0]!.slots[0]!.weaponId = 38;
    },
    (world) => {
      world.worms[0]!.slots.pop();
    },
    (world) => {
      world.worms[1]!.id = world.worms[0]!.id;
    },
    (world) => {
      world.worms[1]!.slot = world.worms[0]!.slot;
    },
    (world) => {
      world.worms.reverse();
    },
    (world) => {
      world.winner = "missing";
      world.phase = "done";
    },
    (world) => {
      world.worms[0]!.rope = {
        state: "worm",
        attachedId: "missing",
        x: 1,
        y: 1,
        vx: 0,
        vy: 0,
      };
    },
    (world) => {
      world.worms[0]!.positionRecordings.cursor = 100;
    },
    (world) => {
      world.worms[0]!.positionRecordings.positions.pop();
    },
    (world) => {
      world.terrain.rows[0] = "invalid";
    },
    (world) => {
      world.bonuses = Array.from({ length: 33 }, (_, id) => ({
        id,
        x: 1,
        y: 1,
        vx: 0,
        vy: 0,
        life: 0,
        flashTime: 0,
        type: "health",
        weaponId: -1,
        spawnedAtMs: 0,
      }));
    },
  ];
  for (const mutate of cases) {
    const candidate = structuredClone(healthy);
    mutate(candidate);
    assert.equal(decodeWorld(candidate), undefined);
    assert.deepEqual(healthy, before);
  }
  const unknownField = { ...structuredClone(healthy), privateRuntime: true };
  assert.equal(decodeWorld(unknownField), undefined);
  assert.equal(
    decodeWorld({
      ...structuredClone(healthy),
      worms: [{ ...healthy.worms[0], positionHistory: [] }],
    }),
    undefined,
  );
  assert.equal(
    decodeWorld({
      ...structuredClone(healthy),
      worms: [{ ...healthy.worms[0], extra: 1 }],
    }),
    undefined,
  );
});

test("checkpoint retains native recorder cursor and stale slots across respawn resets", () => {
  const world = fixture(),
    recordings = world.worms[0]!.positionRecordings;
  for (let i = 0; i < 105; i++) recordPosition(recordings, { x: i, y: 50 });
  resetPositionRecorder(recordings, { x: 20, y: 30 });
  const restored = decodeWorld(encodeWorld(world));
  assert.ok(restored);
  const decoded = restored.worms[0]!.positionRecordings;
  assert.deepEqual(decoded, recordings);
  assert.equal(decoded.count, 1);
  assert.notDeepEqual(recordedPosition(decoded, 0), { x: 20, y: 30 });
  assert.deepEqual(
    recordedPosition(decoded, 0),
    recordedPosition(recordings, 0),
  );
});

test("bonus slot IDs are validated separately while active projectile/effect IDs are unique and precede nextId", () => {
  const world = fixture();
  world.effects = [
    { id: 1, kind: "explosion", x: 30, y: 50, radius: 4, lifeMs: 120 },
  ];
  world.nextId = 2;
  world.bonuses = [
    {
      id: 1,
      type: "weapon",
      weaponId: 2,
      x: 20,
      y: 20,
      vx: 0,
      vy: 0,
      life: 0,
      flashTime: 0,
      spawnedAtMs: 0,
    },
  ];
  assert.ok(decodeWorld(encodeWorld(world)));
  world.effects.push({ ...world.effects[0]! });
  assert.equal(decodeWorld(encodeWorld(world)), undefined);
  world.effects.pop();
  world.nextId = 1;
  assert.equal(decodeWorld(encodeWorld(world)), undefined);
});

test("all 38 source weapons retain decodable decision state throughout native physics and projectile chains", () => {
  for (const weapon of CLASSIC_WEAPONS) {
    const world = createWorld(
      712,
      [
        { id: "alice", slot: 0, loadout: Array(5).fill(weapon.id) },
        { id: "bob", slot: 1 },
      ],
      {
        ...DEFAULT_SETTINGS,
        restrictionPreset: "all",
        killLimit: -1,
        timeLimitMs: -1,
      },
    );
    let fired = false;
    for (let step = 1; step <= 600; step++) {
      stepWorld(world, new Map([["alice", step <= 10 ? FIRE : 0]]));
      fired ||= world.effects.some(
        (effect) => effect.kind === "muzzle" || effect.kind === "beam",
      );
      if (step % 37 === 0 || step === 600)
        assert.ok(
          decodeWorld(encodeWorld(world)),
          `${weapon.name}: rejected valid state after step ${step}`,
        );
    }
    assert.ok(
      fired,
      `${weapon.name}: source outer-frame queue delivered the shot`,
    );
  }
});

test("actual Classic composition restores pixel terrain, native timers/RNG/history and deterministically continues through respawn and bonuses", () => {
  const original = createWorld(
    712,
    [
      { id: "alice", slot: 0 },
      { id: "bob", slot: 1 },
    ],
    {
      ...DEFAULT_SETTINGS,
      killLimit: -1,
      timeLimitMs: -1,
      respawnTimeMs: 20,
      bonuses: true,
    },
  );
  const controls = (step: number) =>
    new Map([
      [
        "alice",
        RIGHT |
          (step % 200 < 160 ? FIRE : 0) |
          (step % 91 === 0 ? NEXT : 0) |
          (step % 57 === 0 ? CARVE : 0) |
          (step % 107 === 0 ? ROPE : 0) |
          (step % 47 === 0 ? JUMP : 0),
      ],
      ["bob", LEFT | (step % 173 < 150 ? FIRE : 0) | (step % 71 < 12 ? UP : 0)],
    ]);
  for (let step = 1; step <= 500; step++) {
    stepWorld(original, controls(step));
    if (step === 40) {
      recordInjury(original, "bob", 101, "alice", original.settings);
      assert.equal(original.worms[1]!.alive, false);
    }
    if (step === 43)
      assert.equal(
        original.worms[1]!.alive,
        false,
        "native respawn uses strict greater-than",
      );
    if (step === 44) assert.equal(original.worms[1]!.alive, true);
    if (step % 31 === 0)
      assert.ok(
        decodeWorld(encodeWorld(original)),
        `composed state rejected at ${step}`,
      );
  }
  const restored = decodeWorld(encodeWorld(original));
  assert.ok(restored);
  assert.deepEqual(restored, original);
  for (let step = 501; step <= 3_200; step++) {
    stepWorld(original, controls(step));
    stepWorld(restored, controls(step));
    if (step % 101 === 0)
      assert.ok(
        decodeWorld(encodeWorld(original)),
        `continuation state rejected at ${step}`,
      );
  }
  assert.deepEqual(restored, original);
  assert.ok(
    original.nextBonusAtMs > 30_000,
    "source bonus clock advanced after its first interval",
  );
});

test("completed native deathmatch checkpoints preserve the actual winner and stop advancing", () => {
  const world = createWorld(
    9,
    [
      { id: "alice", slot: 0 },
      { id: "bob", slot: 1 },
    ],
    {
      ...DEFAULT_SETTINGS,
      timeLimitMs: 55,
    },
  );
  for (let i = 0; i < 7; i++) stepWorld(world, new Map());
  assert.equal(world.phase, "done");
  assert.equal(world.winner, "alice");
  const restored = decodeWorld(encodeWorld(world));
  assert.ok(restored);
  stepWorld(restored, new Map([["bob", FIRE | RIGHT]]));
  assert.deepEqual(restored, world);
});

test("five-player recovery fits the existing transport limit with all 3000 native projectiles and maximally fragmented pixel terrain", () => {
  const world = createWorld(
    5,
    Array.from({ length: 5 }, (_, slot) => ({ id: `snapshot-${slot}`, slot })),
    DEFAULT_SETTINGS,
  );
  const pool = new Map<number, ClassicProjectileState>();
  // Stress recovery independently from the default level's dimensions: source levels can have arbitrary pixel geometry.
  const width = 1536,
    height = 864;
  const fragmented = encodeTerrainRow(
    Uint8Array.from({ length: width }, (_, i) => (i % 2 ? AIR : DIRT)),
  );
  world.terrain = {
    width,
    height,
    rows: Array.from({ length: height }, () => fragmented),
  };
  for (let i = 0; i < MAX_CLASSIC_PROJECTILES; i++) {
    const spawned = spawnClassicProjectile(
      world,
      0,
      "snapshot-0",
      0,
      Math.fround(20.123 + (i % 1_400)),
      Math.fround(20.456 + (i % 800)),
      Math.fround(700.3),
      Math.fround(-90.4),
      i % 255,
      0,
      100,
      Math.fround((i % 360) + 0.01),
      pool,
    );
    assert.ok(spawned);
  }
  const row = encodeTerrainRow(
    Uint8Array.from({ length: world.terrain.width }, (_, i) =>
      i % 2 ? AIR : DIRT,
    ),
  );
  world.terrain.rows.fill(row);
  for (let i = 0; i < 512; i++)
    world.effects.push({
      id: world.nextId++,
      kind: "smoke",
      x: 30,
      y: 40,
      radius: 3,
      lifeMs: 75,
    });
  const encoded = encodeWorld(world);
  const bytes = packMessage(encoded);
  // Reserve more than half a megabyte for room metadata and the existing bounded stream replay envelope.
  assert.ok(
    bytes.byteLength < MAX_SNAPSHOT_BYTES - 500_000,
    `world used ${bytes.byteLength} bytes`,
  );
  const restored = decodeWorld(encoded);
  assert.ok(restored);
  assert.equal(restored.projectiles.length, MAX_CLASSIC_PROJECTILES);
  assert.deepEqual(restored, world);
});

test("compact projectile recovery rejects malformed tuples and invalid mod/random references", () => {
  const world = fixture();
  assert.equal(
    fireWeapon(world, world.worms[0]!, {
      width: 128,
      height: 96,
      material: () => CLASSIC_MATERIALS[AIR]!,
      carveHole: () => 0,
      placeDirt: () => 0,
      injure: () => {},
    }),
    true,
  );
  const wire = encodeWorld(world);
  assert.ok(wire !== null && typeof wire === "object" && "projectiles" in wire);
  assert.ok(Array.isArray(wire.projectiles));
  const valid = wire.projectiles[0];
  assert.ok(Array.isArray(valid));
  const cases: Array<(tuple: unknown[]) => void> = [
    (tuple) => {
      tuple.pop();
    },
    (tuple) => {
      tuple.push("unexpected");
    },
    (tuple) => {
      tuple[1] = MAX_CLASSIC_PROJECTILES;
    },
    (tuple) => {
      tuple[2] = 69;
    },
    (tuple) => {
      tuple[3] = "missing-owner";
    },
    (tuple) => {
      tuple[4] = 24;
    }, // Laser does not create a projectile tree.
    (tuple) => {
      tuple[5] = Number.POSITIVE_INFINITY;
    },
    (tuple) => {
      tuple[13] = 255;
    },
    (tuple) => {
      tuple[14] = Math.fround(0.5);
    }, // Not one of the pinned fixed-random values.
    (tuple) => {
      tuple[16] = 0;
    }, // A peer may not force unbounded native projectile catch-up after restore.
    (tuple) => {
      tuple[29] = false;
    },
  ];
  for (const corrupt of cases) {
    const candidate: unknown[] = [...valid];
    corrupt(candidate);
    assert.equal(decodeWorld({ ...wire, projectiles: [candidate] }), undefined);
  }
  assert.ok(
    decodeWorld(wire),
    "rejection did not mutate the healthy encoded state",
  );
});

test("native UseSound effects survive recovery and reject peer-supplied paths or unknown samples", () => {
  const world = fixture(),
    shooter = world.worms[0]!;
  const weapon = CLASSIC_WEAPONS.find(
    (candidate) =>
      candidate.type === "projectile" &&
      candidate.useSound === 1 &&
      candidate.sound,
  );
  assert.ok(weapon?.type === "projectile" && weapon.sound);
  shooter.slots[0]!.weaponId = weapon.id;
  assert.equal(
    fireWeapon(world, shooter, {
      width: 128,
      height: 96,
      material: () => CLASSIC_MATERIALS[AIR]!,
      carveHole: () => 0,
      placeDirt: () => 0,
      injure: () => {},
    }),
    true,
  );
  const restored = decodeWorld(encodeWorld(world));
  assert.ok(restored);
  assert.equal(
    restored.effects.find((effect) => effect.kind === "muzzle")?.sound,
    weapon.sound,
  );
  for (const sound of [
    "https://example.test/shot.wav",
    "../Bazooka.wav",
    "/sounds/Bazooka.wav",
    "unrecognized.wav",
  ]) {
    const candidate = structuredClone(world);
    candidate.effects[0]!.sound = sound;
    assert.equal(decodeWorld(encodeWorld(candidate)), undefined);
  }
  const wrongBranch = structuredClone(world);
  wrongBranch.effects[0]!.kind = "beam";
  assert.equal(decodeWorld(encodeWorld(wrongBranch)), undefined);
});

test("inclusive native random rotation may checkpoint exactly 360 degrees before the first projectile step", () => {
  const world = fixture();
  const weapon = CLASSIC_WEAPONS.find(
    (candidate) => candidate.name === "Grenade",
  );
  assert.ok(weapon?.type === "projectile");
  assert.ok(
    spawnClassicProjectile(
      world,
      weapon.projectileId,
      "alice",
      weapon.id,
      40,
      40,
      119,
      0,
      0,
      world.elapsedMs,
      world.elapsedMs + 100,
      360,
    ),
  );
  assert.ok(decodeWorld(encodeWorld(world)));
  world.step++;
  world.elapsedMs += 10;
  world.lastClientPhysicsMs = Math.floor((world.elapsedMs - 10) / 11) * 11;
  stepProjectiles(world, world.worms, {
    width: 128,
    height: 96,
    material: (x, y) => CLASSIC_MATERIALS[materialAt(world.terrain, x, y)]!,
    carveHole: (size, x, y) => carveHole(world.terrain, size, x, y),
    placeDirt: () => 0,
    injure: () => {},
  });
  assert.ok(decodeWorld(encodeWorld(world)));
});

test("outer-frame recovery preserves deferred shots and the exact 10ms/11ms scheduler phase", () => {
  const world = createWorld(
    712,
    [
      { id: "alice", slot: 0 },
      { id: "bob", slot: 1 },
    ],
    DEFAULT_SETTINGS,
  );
  for (let i = 0; i < 3; i++) stepWorld(world, new Map([["alice", FIRE]]));
  assert.equal(world.elapsedMs, 30);
  assert.equal(world.lastClientPhysicsMs, 11);
  assert.equal(world.pendingShots.length, 1);
  assert.equal(world.pendingShots[0]!.spawnTimeMs, 20);
  const restored = decodeWorld(encodeWorld(world));
  assert.ok(restored);
  assert.deepEqual(restored, world);
  const view = toView(world);
  view.pendingShots[0]!.x = 1;
  assert.notEqual(view.pendingShots[0]!.x, world.pendingShots[0]!.x);
  const inclusiveRandom = structuredClone(world);
  inclusiveRandom.pendingShots[0]!.randomIndex = 255;
  assert.ok(decodeWorld(encodeWorld(inclusiveRandom)));
  const cases: Array<(candidate: World) => void> = [
    (candidate) => {
      candidate.lastClientPhysicsMs += 11;
    },
    (candidate) => {
      candidate.worms[0]!.lastInputTimeMs = candidate.elapsedMs;
    },
    (candidate) => {
      candidate.pendingShots[0]!.spawnTimeMs++;
    },
    (candidate) => {
      candidate.pendingShots[0]!.randomIndex = 256;
    },
    (candidate) => {
      candidate.pendingShots[0]!.owner = "missing";
    },
    (candidate) => {
      candidate.pendingShots.push({ ...candidate.pendingShots[0]! });
    },
  ];
  for (const mutate of cases) {
    const candidate = structuredClone(world);
    mutate(candidate);
    assert.equal(decodeWorld(encodeWorld(candidate)), undefined);
  }
  for (let i = 0; i < 30; i++) {
    const input = new Map([["alice", RIGHT | FIRE]]);
    stepWorld(world, input);
    stepWorld(restored, input);
  }
  assert.deepEqual(restored, world);
});

test("recovery preserves native respawn eligibility and the last consumed input time", () => {
  const world = createWorld(
    812,
    [
      { id: "alice", slot: 0 },
      { id: "bob", slot: 1 },
    ],
    {
      ...DEFAULT_SETTINGS,
      respawnTimeMs: 20,
      maxRespawnTimeMs: -1,
    },
  );
  recordInjury(world, "bob", 101, "alice", world.settings);
  for (let i = 0; i < 5; i++) stepWorld(world, new Map());
  assert.equal(world.worms[1]!.alive, false);
  assert.equal(world.worms[1]!.canRespawnNow, true);
  const restored = decodeWorld(encodeWorld(world));
  assert.ok(restored);
  assert.equal(
    restored.worms[1]!.lastInputTimeMs,
    world.worms[1]!.lastInputTimeMs,
  );
  assert.equal(restored.worms[1]!.canRespawnNow, true);
  for (let i = 0; i < 20; i++) {
    const input = new Map([["bob", i === 0 ? JUMP : 0]]);
    stepWorld(world, input);
    stepWorld(restored, input);
  }
  assert.equal(restored.worms[1]!.alive, true);
  assert.deepEqual(restored, world);
});
