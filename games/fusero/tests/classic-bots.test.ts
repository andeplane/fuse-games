import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorld,
  stepWorld,
  type World,
} from "../src/engine/classic/world.js";
import { DEFAULT_SETTINGS } from "../src/engine/classic/match-types.js";
import { recordInjury, validLoadout } from "../src/engine/classic/match.js";
import { weaponById } from "../src/engine/classic/catalog.js";
import {
  createPositionRecorder,
  resetPositionRecorder,
} from "../src/engine/classic/history.js";
import { aiTerrain, point } from "../src/engine/classic/ai-geometry.js";
import {
  aiNow,
  createNativeAiState,
  emptyAiControls,
  NATIVE_AI_EPOCH_MS,
  type NativeAiFrame,
  type AiDifficulty,
} from "../src/engine/classic/ai-state.js";
import {
  inputAi,
  respawnAi,
  syncAiBonusPosition,
} from "../src/engine/classic/ai-controller.js";
import {
  aiTargetPosition,
  setAiAim,
} from "../src/engine/classic/ai-targeting.js";
import {
  decodeWorld,
  encodeWorld,
  toView,
} from "../src/engine/classic/codec.js";
import { encodeNativeAi } from "../src/engine/classic/ai-codec.js";
import {
  encodeTerrainRow,
  uniformTerrain,
  AIR,
  ROCK,
  asPhysicsTerrain,
} from "../src/engine/classic/terrain.js";

function frame(world: World): NativeAiFrame {
  const worm = world.worms[0]!;
  assert.ok(worm.ai);
  return {
    world,
    worm,
    ai: worm.ai,
    shared: world.aiShared,
    terrain: aiTerrain(world.terrain),
    physicsTerrain: asPhysicsTerrain(world.terrain),
    targets: world.worms.filter((entry) => entry.alive),
    deltaMs: 10,
    controls: emptyAiControls(),
  };
}
function fixture(difficulty: AiDifficulty = 1): World {
  const world = createWorld(
    725,
    [
      { id: "bot", slot: 0, bot: true, difficulty },
      { id: "human", slot: 1 },
    ],
    DEFAULT_SETTINGS,
  );
  world.terrain = uniformTerrain(192, 112, AIR);
  const floor = encodeTerrainRow(new Uint8Array(192).fill(ROCK));
  for (let y = 96; y < 112; y++) world.terrain.rows[y] = floor;
  world.worms.forEach((worm, index) => {
    worm.x = index === 0 ? 40 : 150;
    worm.y = 91;
    worm.vx = 0;
    worm.vy = 0;
    worm.aim = 0;
    worm.aimSpeed = 0;
    worm.facing = 1;
    worm.moveFacing = 1;
    worm.onGround = true;
    worm.input = 0;
    worm.rope = null;
    worm.positionRecordings = createPositionRecorder();
    resetPositionRecorder(worm.positionRecordings, worm);
  });
  world.worms[0]!.ai = createNativeAiState("100lt", difficulty);
  respawnAi(frame(world));
  return world;
}
function advance(world: World, frames: number): void {
  for (let i = 0; i < frames; i++) stepWorld(world, new Map());
}
function record(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

test("world creation selects native Classic arsenals and checkpoints the controller identity", () => {
  for (const restrictionPreset of ["all", "standard-100lt"] as const) {
    const world = createWorld(48, [{ id: "a", slot: 0, bot: true }], {
      ...DEFAULT_SETTINGS,
      restrictionPreset,
    });
    const bot = world.worms[0]!;
    assert.deepEqual(
      bot.slots.map((slot) => weaponById(slot.weaponId)!.name),
      ["Super Shotgun", "Napalm", "Cannon", "Doomsday", "Chaingun"],
    );
    assert.equal(bot.ai?.gameType, "100lt");
    assert.equal(bot.ai?.difficulty, 1);
    assert.deepEqual(decodeWorld(encodeWorld(world)), world);
  }
  const rifles = createWorld(
    12,
    [{ id: "a", slot: 0, bot: true, difficulty: 3 }],
    { ...DEFAULT_SETTINGS, restrictionPreset: "all", loadingTime: 20 },
  );
  assert.deepEqual(
    rifles.worms[0]!.slots.map((slot) => weaponById(slot.weaponId)!.name),
    Array<string>(5).fill("Rifle"),
  );
  assert.equal(rifles.worms[0]!.ai?.difficulty, 3);
  assert.equal(rifles.worms[0]!.ai?.gameType, "rifles");
  const random = createWorld(12, [{ id: "a", slot: 0, bot: true }], {
    ...DEFAULT_SETTINGS,
    loadingTime: 50,
  });
  assert.ok(
    validLoadout(
      random.worms[0]!.slots.map((slot) => slot.weaponId),
      random.settings,
    ),
  );
  assert.equal(random.worms[0]!.ai?.gameType, "other");
  assert.equal(
    createWorld(4, [{ id: "a", slot: 0 }], DEFAULT_SETTINGS).worms[0]!.ai,
    null,
  );
});

test("native bot controls wait 400ms after spawn while passive physics continues", () => {
  const world = fixture(),
    bot = world.worms[0]!;
  bot.y = 40;
  bot.onGround = false;
  advance(world, 40);
  assert.equal(world.elapsedMs, 400);
  assert.ok(bot.y > 40);
  assert.equal(bot.ai!.lastCarveMs, 0);
  assert.equal(bot.aim, 0);
  assert.equal(world.aiShared.angleNoiseAtMs, 0);
  assert.equal(world.projectiles.length, 0);
  advance(world, 4);
  assert.ok(bot.ai!.lastCarveMs >= NATIVE_AI_EPOCH_MS + 400);
  assert.ok(
    world.aiShared.angleNoiseAtMs >= NATIVE_AI_EPOCH_MS + 400,
    "initial absolute-time sentinels expire before the menu-prepared match",
  );
});

test("native input can aim, choose weapons and throw rope without privileged physics changes", () => {
  const world = fixture();
  advance(world, 42);
  const current = frame(world),
    worm = current.worm;
  const physical = {
    x: worm.x,
    y: worm.y,
    vx: worm.vx,
    vy: worm.vy,
    health: worm.health,
    kills: worm.kills,
    deaths: worm.deaths,
  };
  inputAi(current);
  assert.deepEqual(
    {
      x: worm.x,
      y: worm.y,
      vx: worm.vx,
      vy: worm.vy,
      health: worm.health,
      kills: worm.kills,
      deaths: worm.deaths,
    },
    physical,
  );
  assert.equal(worm.moveFacing, worm.facing);
});

test("bot aim uses outer-frame rotation and does not inherit keyboard acceleration", () => {
  const world = fixture(3),
    current = frame(world);
  current.worm.aim = -50;
  current.worm.aimSpeed = 200;
  setAiAim(current, point(150, 91));
  assert.equal(current.worm.aim, -49);
  assert.equal(current.worm.aimSpeed, 200);
  current.controls.shoot = true;
  current.controls.move = true;
  inputAi(current);
  assert.equal(
    current.controls.shoot,
    false,
    "spawn-delay input still resets previous state",
  );
  assert.equal(current.controls.move, false);
});

test("a copied active search and shared AI RNG resume the same complete world", () => {
  const world = fixture();
  advance(world, 11);
  assert.equal(world.worms[0]!.ai!.search.status, "searching");
  assert.equal(world.worms[0]!.ai!.search.initialized, true);
  assert.ok(world.worms[0]!.ai!.search.frontier.length);
  const restored = decodeWorld(encodeWorld(world));
  assert.ok(restored);
  for (let i = 0; i < 700; i++) {
    stepWorld(world, new Map());
    stepWorld(restored, new Map());
    if (i % 50 === 0) assert.deepEqual(restored, world);
  }
  assert.deepEqual(restored, world);
  assert.ok(world.aiShared.angleNoiseAtMs > 0);
  assert.ok(world.worms[0]!.ai!.path.length);
});

test("native bot death requests respawn after eligibility without a human jump edge", () => {
  const world = fixture(),
    bot = world.worms[0]!;
  recordInjury(world, bot.id, 101, "human", world.settings);
  assert.equal(bot.alive, false);
  advance(world, 200);
  assert.equal(bot.alive, false);
  advance(world, 80);
  assert.equal(bot.alive, true);
  assert.equal(bot.health, 100);
  assert.equal(bot.input, 0);
  assert.ok(bot.ai!.spawnedAtMs > NATIVE_AI_EPOCH_MS);
});

test("AI graph and shared random samples stay private to checkpoints, independent of views", () => {
  const world = fixture();
  advance(world, 11);
  const before = structuredClone(world),
    view = toView(world);
  assert.equal("aiShared" in view, false);
  assert.equal("ai" in view.worms[0]!, false);
  view.worms[0]!.x = 10;
  view.terrain.rows[0] = "changed";
  assert.deepEqual(world, before);
  const encoded = record(encodeWorld(world));
  const worms = encoded.worms;
  assert.ok(Array.isArray(worms));
  const ai = record(record(worms[0]).ai),
    search = record(ai.search),
    areas = search.areas;
  assert.ok(Array.isArray(areas));
  const area = areas[0];
  assert.ok(Array.isArray(area));
  area[0] = 999;
  assert.deepEqual(world, before);
});

test("malformed AI clocks, frontiers, parent cycles and identities reject atomically", () => {
  const world = fixture();
  advance(world, 11);
  const before = structuredClone(world);
  const cases: Array<(ai: Record<string, unknown>) => void> = [
    (ai) => {
      ai.difficulty = 4;
    },
    (ai) => {
      ai.lastFaceMs = NaN;
    },
    (ai) => {
      ai.spawnedAtMs = aiNow({ world }) + 1;
    },
    (ai) => {
      ai.targetWormId = "missing";
    },
    (ai) => {
      ai.randomSpread = -0;
    },
    (ai) => {
      ai.currentNode = 8000;
    },
    (ai) => {
      record(ai.search).frontier = [0, 0];
    },
    (ai) => {
      const areas = record(ai.search).areas;
      assert.ok(Array.isArray(areas));
      assert.ok(Array.isArray(areas[0]));
      areas[0][4] = 0;
    },
    (ai) => {
      record(ai.search).nextExpansionMs = aiNow({ world }) + 101;
    },
    (ai) => {
      record(ai.search).nextExpansionMs = 0;
    },
    (ai) => {
      ai.extra = true;
    },
  ];
  for (const mutate of cases) {
    const candidate = record(encodeWorld(world)),
      worms = candidate.worms;
    assert.ok(Array.isArray(worms));
    mutate(record(record(worms[0]).ai));
    assert.equal(decodeWorld(candidate), undefined);
    assert.deepEqual(world, before);
  }
  assert.deepEqual(
    decodeWorld(encodeWorld(world)),
    world,
    "valid active search still restores",
  );
});

test("a selected bonus retains its final native slot position after movement and pickup", () => {
  const world = fixture(),
    current = frame(world);
  world.bonuses.push({
    id: 3,
    x: 75,
    y: 30,
    vx: 0,
    vy: 0,
    life: 0,
    flashTime: 0,
    type: "health",
    weaponId: -1,
    spawnedAtMs: 0,
  });
  current.ai.targetType = "bonus";
  current.ai.bonusId = 3;
  current.ai.bonusPosition = point(75, 30);
  world.bonuses[0]!.y = 31;
  syncAiBonusPosition(current);
  world.bonuses.splice(0, 1);
  assert.deepEqual(aiTargetPosition(current), point(75, 31));
  assert.equal(current.ai.mode, "think");
});

test("difficulty and all evolving AI state participate in the native checkpoint payload", () => {
  for (const difficulty of [0, 1, 2, 3] as const) {
    const world = fixture(difficulty);
    advance(world, 60);
    const restored = decodeWorld(encodeWorld(world));
    assert.ok(restored);
    assert.deepEqual(restored, world);
    assert.notDeepEqual(encodeNativeAi(world.worms[0]!.ai), null);
    assert.equal(restored.worms[0]!.ai?.difficulty, difficulty);
  }
});
