import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLASSIC_PROJECTILES,
  CLASSIC_WEAPONS,
} from "../src/engine/classic/catalog.js";
import { createWorld } from "../src/engine/classic/world.js";
import { DEFAULT_SETTINGS } from "../src/engine/classic/match-types.js";
import { aiTerrain, len, minus } from "../src/engine/classic/ai-geometry.js";
import {
  createNativeAiState,
  createNativeAiShared,
  emptyAiControls,
  NATIVE_AI_EPOCH_MS,
  type NativeAiFrame,
  type AiDifficulty,
} from "../src/engine/classic/ai-state.js";
import { setAiAim } from "../src/engine/classic/ai-targeting.js";
import {
  chooseAiWeapon,
  findAiClearingWeapon,
  shootAi,
  traceAiWeapon,
} from "../src/engine/classic/ai-combat.js";
import { createWeaponSlots } from "../src/engine/classic/weapons.js";
import { checkOnGround } from "../src/engine/classic/physics.js";
import { f } from "../src/engine/classic/physics-types.js";
import {
  asPhysicsTerrain,
  uniformTerrain,
  encodeTerrainRow,
  AIR,
  DIRT,
  ROCK,
} from "../src/engine/classic/terrain.js";
import type { BotGameType } from "../src/engine/classic/bot-arsenal.js";

const folder = mkdtempSync(join(tmpdir(), "fusero-ai-tactical-")),
  binary = join(folder, "native");
before(() => {
  const compiled = spawnSync(
    "c++",
    [
      "-std=c++17",
      "-O0",
      "-ffp-contract=off",
      fileURLToPath(
        new URL("fixtures/classic-ai-tactical-native.cpp", import.meta.url),
      ),
      "-o",
      binary,
    ],
    { encoding: "utf8" },
  );
  assert.equal(compiled.status, 0, compiled.stderr);
});
after(() => rmSync(folder, { recursive: true, force: true }));
const weaponId = (name: string): number => {
  const weapon = CLASSIC_WEAPONS.find((w) => w.name === name);
  assert.ok(weapon);
  return weapon.id;
};
const preset = [
  "Super Shotgun",
  "Napalm",
  "Cannon",
  "Doomsday",
  "Chaingun",
].map(weaponId);
type Operation = "aim" | "choose" | "clear" | "trace" | "shoot";
interface Case {
  operation: Operation;
  now: number;
  difficulty: AiDifficulty;
  gameType: BotGameType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  facing: 1 | -1;
  tx: number;
  ty: number;
  tvx: number;
  tvy: number;
  rope: 0 | 1 | 2 | 3 | 4;
  selected: number;
  lastFace: number;
  lastWeapon: number;
  lastRandom: number;
  lastShoot: number;
  badAim: number;
  health: number;
  selfInjure: boolean;
  ids: number[];
  reloading: boolean[];
  lastFire: number[];
  distance: number | null;
  direct: boolean;
  traceFraction: number;
}
function scenario(operation: Operation, index: number): Case {
  return {
    operation,
    now: 10000 + index * 10,
    difficulty: 1,
    gameType: "100lt",
    x: 40,
    y: 170,
    vx: 0,
    vy: 0,
    aim: 0,
    facing: 1,
    tx: 160,
    ty: 170,
    tvx: 0,
    tvy: 0,
    rope: 0,
    selected: 0,
    lastFace: 0,
    lastWeapon: 0,
    lastRandom: 0,
    lastShoot: 0,
    badAim: 0,
    health: 100,
    selfInjure: true,
    ids: [...preset],
    reloading: Array<boolean>(5).fill(false),
    lastFire: Array<number>(5).fill(0),
    distance: null,
    direct: true,
    traceFraction: 1,
  };
}
function fixture() {
  const world = createWorld(
    7,
    [
      { id: "bot", slot: 0, bot: true },
      { id: "enemy", slot: 1 },
    ],
    DEFAULT_SETTINGS,
  );
  world.terrain = uniformTerrain(512, 256, AIR);
  const rows: string[] = [];
  for (let y = 0; y < 256; y++) {
    const pixels = new Uint8Array(512).fill(AIR);
    if (y >= 220) pixels.fill(ROCK);
    if (y < 180) for (let x = 250; x < 267; x++) pixels[x] = DIRT;
    if (y < 130) for (let x = 350; x < 360; x++) pixels[x] = ROCK;
    rows.push(encodeTerrainRow(pixels));
  }
  world.terrain.rows = rows;
  world.rng = 725;
  world.aiShared = createNativeAiShared();
  return world;
}
function frame(world: ReturnType<typeof fixture>, c: Case): NativeAiFrame {
  const worm = world.worms[0]!,
    enemy = world.worms[1]!;
  Object.assign(worm, {
    x: f(c.x),
    y: f(c.y),
    vx: f(c.vx),
    vy: f(c.vy),
    aim: f(c.aim),
    facing: c.facing,
    weapon: c.selected,
    health: c.health,
  });
  Object.assign(enemy, { x: f(c.tx), y: f(c.ty), vx: f(c.tvx), vy: f(c.tvy) });
  worm.rope =
    c.rope === 0
      ? null
      : {
          x: 80,
          y: 30,
          vx: 0,
          vy: 0,
          state:
            c.rope === 1
              ? "shooting"
              : c.rope === 2
                ? "falling"
                : c.rope === 3
                  ? "terrain"
                  : "worm",
          attachedId: c.rope === 4 ? enemy.id : null,
        };
  worm.slots = createWeaponSlots(c.ids);
  worm.slots.forEach((slot, i) => {
    slot.reloading = c.reloading[i]!;
    slot.lastFire = f(c.lastFire[i]!);
  });
  const ai = createNativeAiState(c.gameType, c.difficulty);
  Object.assign(ai, {
    targetType: "worm",
    targetWormId: enemy.id,
    lastFaceMs: c.lastFace,
    lastWeaponChangeMs: c.lastWeapon,
    lastRandomChangeMs: c.lastRandom,
    lastShootMs: c.lastShoot,
    badAimMs: c.badAim,
  });
  worm.ai = ai;
  world.elapsedMs = c.now - NATIVE_AI_EPOCH_MS;
  world.settings.selfInjure = c.selfInjure;
  return {
    world,
    worm,
    ai,
    shared: world.aiShared,
    terrain: aiTerrain(world.terrain),
    physicsTerrain: asPhysicsTerrain(world.terrain),
    targets: world.worms,
    deltaMs: 10,
    controls: emptyAiControls(),
  };
}
function header(world: ReturnType<typeof fixture>): string[] {
  const port = aiTerrain(world.terrain),
    rows = Array.from({ length: port.height }, (_, y) =>
      Array.from({ length: port.width }, (_, x) =>
        port.flag(x, y) === 4 ? "#" : port.flag(x, y) === 2 ? "d" : ".",
      ).join(""),
    );
  return [
    world.terrain.width + " " + world.terrain.height + " " + world.rng,
    ...rows,
    String(CLASSIC_PROJECTILES.length),
    ...CLASSIC_PROJECTILES.map((p) =>
      [
        p.rawType,
        p.customGravity,
        p.gravity ?? 0,
        p.dampening,
        p.hit.type,
        "damage" in p.hit ? (p.hit.damage ?? 0) : 0,
        p.hit.projectiles ?? 0,
        p.playerHit.type,
        "damage" in p.playerHit ? (p.playerHit.damage ?? 0) : 0,
        p.playerHit.projectiles ?? 0,
        p.timer?.projectiles ?? 0,
        p.timerTime,
        p.touch.projectiles ?? 0,
        p.spawn?.projectileId ?? -1,
      ].join(" "),
    ),
    String(CLASSIC_WEAPONS.length),
    ...CLASSIC_WEAPONS.map((w) =>
      [
        JSON.stringify(w.name),
        w.rawType,
        w.recoil,
        w.type === "projectile" ? w.speed : 0,
        w.type === "projectile" ? w.speedVar : 0,
        w.type === "projectile" ? w.projectileId : -1,
        w.type === "beam" ? w.beam.length : 0,
      ].join(" "),
    ),
  ];
}
function inputLine(fr: NativeAiFrame, c: Case): string {
  const enemy = fr.world.worms[1]!,
    w = fr.worm;
  const values: [string, ...(number | string)[]] = [
    c.operation,
    c.now,
    10,
    c.difficulty,
    c.gameType === "rifles" ? 0 : c.gameType === "100lt" ? 1 : 3,
    c.health,
    Number(c.selfInjure),
    w.x,
    w.y,
    w.vx,
    w.vy,
    w.aim,
    w.facing,
    enemy.x,
    enemy.y,
    enemy.vx,
    enemy.vy,
    Number(checkOnGround(enemy, fr.physicsTerrain)),
    c.rope,
    c.selected,
    c.lastFace,
    c.lastWeapon,
    c.lastRandom,
    c.lastShoot,
    c.badAim,
    ...w.slots.flatMap((s) => [s.weaponId, Number(s.reloading), s.lastFire]),
  ];
  if (c.operation === "choose")
    values.push(
      c.distance === null ? len(minus(enemy, w)) : f(c.distance),
      Number(c.direct),
      f(c.traceFraction),
    );
  return values.join(" ");
}
function action(fr: NativeAiFrame, c: Case): number[] {
  const enemy = fr.world.worms[1]!;
  let result = 0,
    fraction = 0,
    type = 0;
  if (c.operation === "aim") result = Number(setAiAim(fr, enemy));
  if (c.operation === "choose")
    result = chooseAiWeapon(
      fr,
      c.distance === null ? len(minus(enemy, fr.worm)) : f(c.distance),
      c.direct,
      f(c.traceFraction),
    );
  if (c.operation === "clear") result = findAiClearingWeapon(fr);
  if (c.operation === "trace") {
    const trace = traceAiWeapon(fr, enemy);
    result = trace.distance;
    fraction = trace.fraction;
    type = trace.type;
  }
  if (c.operation === "shoot") result = Number(shootAi(fr));
  return [
    result,
    fr.worm.aim,
    fr.worm.facing,
    fr.worm.weapon,
    Number(fr.controls.move),
    Number(fr.controls.jump),
    Number(fr.controls.shoot),
    fr.ai.lastFaceMs,
    fr.ai.lastWeaponChangeMs,
    fr.ai.lastRandomChangeMs,
    fr.ai.randomSpread,
    fr.ai.badAimMs,
    fr.ai.lastShootMs,
    fr.ai.lastShootTarget.x,
    fr.ai.lastShootTarget.y,
    fraction,
    type,
    fr.world.rng,
  ];
}
function compare(cases: Case[]): void {
  const world = fixture(),
    lines = header(world),
    actual: number[][] = [];
  for (const c of cases) {
    const fr = frame(world, c);
    lines.push(inputLine(fr, c));
    actual.push(action(fr, c));
  }
  const native = spawnSync(binary, [], {
    input: lines.join("\n") + "\n",
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(native.status, 0, native.stderr + String(native.error ?? ""));
  const expected = native.stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  assert.equal(expected.length, cases.length);
  for (let i = 0; i < cases.length; i++) {
    assert.equal(actual[i]!.length, expected[i]!.length);
    for (let k = 0; k < actual[i]!.length; k++) {
      // The existing port fixes trig to software implementations; a one-ULP
      // native libm difference is documented. Decisions/RNG/timers stay exact.
      if (k === 1 && actual[i]![k] !== expected[i]![k]) {
        const scale = Math.max(1, Math.abs(expected[i]![k]!));
        assert.ok(
          Math.abs(actual[i]![k]! - expected[i]![k]!) <= scale * 1.3e-7,
          `angle case ${i}: ${actual[i]![k]} vs ${expected[i]![k]}`,
        );
      } else
        assert.equal(
          actual[i]![k],
          expected[i]![k],
          `${cases[i]!.operation} case ${i} field ${k}, ${JSON.stringify(cases[i])}`,
        );
    }
  }
}

test("absolute bot aim, shared skill noise and face cooldown match native C++", () => {
  const cases: Case[] = [];
  for (let i = 0; i < 180; i++) {
    const c = scenario("aim", i);
    c.difficulty = (i % 4) as AiDifficulty;
    c.x = 180;
    c.y = 150;
    c.tx = 40 + ((i * 29) % 400);
    c.ty = 20 + ((i * 17) % 190);
    c.aim = -85 + ((i * 13) % 140);
    c.facing = i % 2 ? 1 : -1;
    c.lastFace = i % 5 === 0 ? c.now - 300 : 0;
    cases.push(c);
  }
  compare(cases);
});
test("source weapon selection, clearing and thin-wall traces match across all weapons and reload states", () => {
  const cases: Case[] = [];
  for (let i = 0; i < 260; i++) {
    const c = scenario(
      i % 3 === 0 ? "clear" : i % 3 === 1 ? "choose" : "trace",
      i,
    );
    c.gameType = i % 7 === 0 ? "rifles" : i % 2 ? "100lt" : "other";
    c.difficulty = (i % 4) as AiDifficulty;
    c.tx = 20 + ((i * 47) % 460);
    c.ty = 20 + ((i * 13) % 200);
    c.rope = (i % 5) as Case["rope"];
    c.selected = i % 5;
    c.direct = i % 3 !== 0;
    c.traceFraction = i % 2 ? 0.8 : 0.2;
    c.health = i % 4 === 0 ? 20 : 100;
    c.selfInjure = i % 2 === 0;
    if (c.gameType !== "100lt")
      c.ids = Array.from(
        { length: 5 },
        (_, j) => (i + j * 11) % CLASSIC_WEAPONS.length,
      );
    c.reloading = Array.from({ length: 5 }, (_, j) => ((i >> j) & 1) === 1);
    if (i % 9 === 0) c.lastWeapon = c.now - [500, 300, 200, 120][c.difficulty]!;
    cases.push(c);
  }
  compare(cases);
});
test("native shooting actions and RNG agree for every weapon, dirt/rock cover and coincident worms", () => {
  const cases: Case[] = [];
  for (let i = 0; i < 250; i++) {
    const c = scenario("shoot", i);
    c.gameType = "other";
    c.difficulty = (i % 4) as AiDifficulty;
    c.ids = Array<number>(5).fill(i % CLASSIC_WEAPONS.length);
    c.tx = 25 + ((i * 31) % 470);
    c.ty = 20 + ((i * 19) % 195);
    c.aim = -75 + ((i * 7) % 130);
    c.vx = i % 7 === 0 ? -300 : 0;
    c.vy = i % 11 === 0 ? 80 : 0;
    c.tvx = i % 5 ? 0 : 35;
    c.tvy = i % 6 ? 0 : -20;
    if (i % 17 === 0) {
      c.tx = c.x;
      c.ty = c.y;
    }
    if (i % 13 === 0) c.badAim = 4000;
    if (i % 23 === 0) c.lastFire[0] = f(0.1);
    if (i % 29 === 0) c.reloading[0] = true;
    cases.push(c);
  }
  compare(cases);
});
