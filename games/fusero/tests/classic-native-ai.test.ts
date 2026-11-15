import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeBotArsenal } from "../src/engine/classic/bot-arsenal.js";
import { DEFAULT_SETTINGS } from "../src/engine/classic/match-types.js";
import { weaponById } from "../src/engine/classic/catalog.js";
import { randomInt, randomUnit } from "../src/engine/classic/random.js";
import { validLoadout } from "../src/engine/classic/match.js";
import {
  aiTerrain,
  maxFreeArea,
  traceWorm,
  traceLine,
  len,
  minus,
  rectCenter,
  type AiTerrain,
} from "../src/engine/classic/ai-geometry.js";
import {
  createAiSearch,
  requestAiSearch,
  advanceAiSearch,
} from "../src/engine/classic/ai-path.js";
import {
  encodeTerrainRow,
  decodeTerrainRow,
  carveHole,
  materialAt,
  AIR,
  DIRT,
  ROCK,
} from "../src/engine/classic/terrain.js";
import { createWorld } from "../src/engine/classic/world.js";
import { CLASSIC_LEVELS } from "../src/engine/classic/level.js";

const work = mkdtempSync(join(tmpdir(), "fusero-native-ai-")),
  binary = join(work, "reference");
before(() => {
  const compiled = spawnSync(
    "c++",
    [
      "-std=c++17",
      "-O0",
      "-ffp-contract=off",
      fileURLToPath(new URL("fixtures/classic-ai-native.cpp", import.meta.url)),
      "-o",
      binary,
    ],
    { encoding: "utf8" },
  );
  assert.equal(compiled.status, 0, compiled.stderr);
});
after(() => rmSync(work, { recursive: true, force: true }));
class Terrain implements AiTerrain {
  constructor(readonly rows: string[]) {}
  get width() {
    return this.rows[0]!.length;
  }
  get height() {
    return this.rows.length;
  }
  flag(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 4;
    return this.rows[Math.trunc(y)]![Math.trunc(x)] === "#"
      ? 4
      : this.rows[Math.trunc(y)]![Math.trunc(x)] === "d"
        ? 2
        : 1;
  }
}
function native(terrain: Terrain, queries: string[]): number[][] {
  const result = spawnSync(binary, [], {
    input:
      [terrain.width + " " + terrain.height, ...terrain.rows, ...queries].join(
        "\n",
      ) + "\n",
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr + String(result.error ?? ""));
  return result.stdout
    .trim()
    .split("\n")
    .map((line) => line.split(" ").map(Number));
}
function field(
  width: number,
  height: number,
  pixel: (x: number, y: number) => string,
): Terrain {
  return new Terrain(
    Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => pixel(x, y)).join(""),
    ),
  );
}

test("native Classic bot presets include 100lt and five Rifles without consuming random draws", () => {
  let draws = 0;
  const random = {
    nextFloat: () => {
      draws++;
      return 0.5;
    },
    nextInt: () => {
      draws++;
      return 1;
    },
  };
  for (const restrictionPreset of ["all", "standard-100lt"] as const) {
    const result = nativeBotArsenal(
      { ...DEFAULT_SETTINGS, restrictionPreset },
      random,
    );
    assert.equal(result.gameType, "100lt");
    assert.deepEqual(
      result.loadout.map((id) => weaponById(id)!.name),
      ["Super Shotgun", "Napalm", "Cannon", "Doomsday", "Chaingun"],
    );
  }
  for (const loadingTime of [16, 20, 25, 25.9]) {
    const result = nativeBotArsenal(
      { ...DEFAULT_SETTINGS, restrictionPreset: "all", loadingTime },
      random,
    );
    assert.equal(result.gameType, "rifles");
    assert.deepEqual(
      result.loadout.map((id) => weaponById(id)!.name),
      Array<string>(5).fill("Rifle"),
    );
  }
  assert.equal(draws, 0);
  for (const loadingTime of [15, 26, 50, 101]) {
    const state = { rng: loadingTime };
    const settings = { ...DEFAULT_SETTINGS, loadingTime };
    const result = nativeBotArsenal(settings, {
      nextFloat: () => randomUnit(state),
      nextInt: (max) => randomInt(state, max),
    });
    assert.equal(result.gameType, "other");
    assert.ok(validLoadout(result.loadout, settings));
    assert.equal(new Set(result.loadout).size, 5);
  }
  // Rifle is forbidden in Standard 100lt, so this branch falls back to native random selection.
  assert.equal(
    nativeBotArsenal({ ...DEFAULT_SETTINGS, loadingTime: 20 }, random).gameType,
    "other",
  );
});

test("native geometry matches the independently extracted C++ over fractional and clipped traces", () => {
  const terrain = field(93, 71, (x, y) =>
    x === 0 || y === 0 || x === 92 || y === 70 || (x > 39 && x < 45 && y < 50)
      ? "#"
      : x > 65 && y > 30
        ? "d"
        : ".",
  );
  const pairs = [
    [10, 10, 80, 60],
    [10.2, 10.9, 80.7, 40.8],
    [80, 60, 10, 10],
    [20, 65, 87, 65],
    [50, 20, 50, 68],
    [10, 10, -5, 25],
    [-1, 2, 40, 50],
    [10, 10, 10, 10],
    [40, 59, 50, 49],
  ];
  const queries = pairs.map((p) => "trace " + p.join(" "));
  queries.push(...pairs.map((p) => "coarse " + p.join(" ")));
  for (let y = 5; y < terrain.height; y += 13)
    for (let x = 5; x < terrain.width; x += 17)
      queries.push(`area ${x} ${y} 0 0`);
  const reference = native(terrain, queries);
  let index = 0;
  for (const [sx, sy, tx, ty] of pairs) {
    const result = traceWorm(terrain, { x: tx!, y: ty! }, { x: sx!, y: sy! });
    assert.deepEqual(
      [Number(result.clear), result.collision.x, result.collision.y],
      reference[index++],
      queries[index - 1],
    );
  }
  for (const [sx, sy, tx, ty] of pairs) {
    const result = traceLine(terrain, { x: tx!, y: ty! }, { x: sx!, y: sy! });
    assert.deepEqual(
      [result.distance, result.type, result.fraction],
      reference[index++],
      queries[index - 1],
    );
  }
  for (let y = 5; y < terrain.height; y += 13)
    for (let x = 5; x < terrain.width; x += 17) {
      const r = maxFreeArea(terrain, { x, y });
      assert.deepEqual(
        [r.x1, r.y1, r.x2, r.y2],
        reference[index++],
        queries[index - 1],
      );
    }
});

test("rectangle A* and its simplified/split paths match native C++ around rock and through dirt", () => {
  const terrain = field(180, 140, (x, y) => {
    if (x < 2 || y < 2 || x > 177 || y > 137) return "#";
    if ((x >= 50 && x <= 58 && y < 105) || (x >= 112 && x <= 120 && y > 35))
      return "#";
    if (x > 75 && x < 85) return "d";
    return ".";
  });
  const pairs = [
    [20, 20, 160, 120],
    [160, 120, 20, 20],
    [25, 120, 155, 20],
    [15, 15, 35, 90],
    [20, 25, 160, 25],
  ];
  const expected = native(
    terrain,
    pairs.map((p) => "path " + p.join(" ")),
  );
  pairs.forEach(([sx, sy, tx, ty], index) => {
    const search = createAiSearch();
    requestAiSearch(search, { x: sx!, y: sy! }, { x: tx!, y: ty! }, 0);
    advanceAiSearch(search, terrain, 99);
    assert.equal(search.status, "searching", "explicit worker idle interval");
    for (let ms = 100; search.status === "searching" && ms < 10000; ms += 10)
      advanceAiSearch(search, terrain, ms);
    assert.notEqual(search.status, "searching");
    assert.deepEqual(
      [search.result.length, ...search.result.flatMap((p) => [p.x, p.y])],
      expected[index],
      `path ${index}`,
    );
  });
});

test("incremental search resumes from copied frontier, with deterministic restart timing", () => {
  const terrain = field(180, 140, (x, y) =>
    x < 2 || y < 2 || x > 177 || y > 137 || (x > 60 && x < 75 && y < 110)
      ? "#"
      : ".",
  );
  const search = createAiSearch();
  requestAiSearch(search, { x: 20, y: 20 }, { x: 160, y: 20 }, 0);
  advanceAiSearch(search, terrain, 100);
  assert.equal(search.status, "searching");
  const restored: typeof search = structuredClone(search);
  for (let time = 110; time <= 300; time += 10) {
    advanceAiSearch(search, terrain, time);
    advanceAiSearch(restored, terrain, time);
    assert.deepEqual(restored, search);
  }
  requestAiSearch(restored, { x: 30, y: 40 }, { x: 150, y: 125 }, 300);
  assert.equal(restored.nextExpansionMs, 400, "idle worker starts after 100ms");
  requestAiSearch(restored, { x: 30, y: 40 }, { x: 150, y: 30 }, 310);
  assert.equal(
    restored.nextExpansionMs,
    311,
    "active worker handles restart at next expansion",
  );
});

test("relaxing an omitted equal-score area erases the equivalent native frontier entry", () => {
  const terrain = field(160, 160, (x) => (x === 35 ? "#" : "."));
  const search = createAiSearch();
  search.start = { x: 15, y: 15 };
  search.target = { x: 100, y: 100 };
  search.areas = [
    { rect: { x1: 10, y1: 10, x2: 20, y2: 20 }, parent: null, distance: 0 },
    { rect: { x1: 0, y1: 0, x2: 28, y2: 28 }, parent: null, distance: 1000 },
    { rect: { x1: 70, y1: 70, x2: 90, y2: 90 }, parent: null, distance: 0 },
  ];
  search.areas[2]!.distance =
    1000 +
    len(minus(rectCenter(search.areas[1]!.rect), search.target)) -
    len(minus(rectCenter(search.areas[2]!.rect), search.target));
  search.frontier = [0, 2];
  search.status = "searching";
  search.initialized = true;
  search.nextExpansionMs = 100;
  advanceAiSearch(search, terrain, 100);
  const [expected] = native(terrain, ["tie 0 0 0 0"]);
  assert.deepEqual([search.frontier.length, ...search.frontier], expected);
  assert.deepEqual(
    expected,
    [1, 1],
    "native erase uses comparator equivalence, not pointer identity",
  );
});

test("AI material cache observes carving within the same input pulse", () => {
  const terrain = {
      width: 64,
      height: 64,
      rows: Array<string>(64).fill(
        encodeTerrainRow(new Uint8Array(64).fill(DIRT)),
      ),
    },
    port = aiTerrain(terrain);
  assert.equal(port.flag(32, 32), 2);
  carveHole(terrain, 4, 32, 32);
  assert.equal(materialAt(terrain, 32, 32), AIR);
  assert.equal(port.flag(32, 32), 1);
  assert.equal(port.flag(-1, 20), 4);
  assert.equal(port.flag(64, 20), 4);
  terrain.rows[20] = encodeTerrainRow(new Uint8Array(64).fill(ROCK));
  assert.equal(port.flag(20, 20), 4);
});

test("the worker samples terrain after its idle delay and before the first expansion", () => {
  const terrain = field(90, 80, (x) => (x === 30 ? "#" : "."));
  const search = createAiSearch();
  requestAiSearch(search, { x: 15, y: 20 }, { x: 70, y: 20 }, 0);
  assert.equal(
    search.areas.length,
    0,
    "requesting work does not sample terrain",
  );
  advanceAiSearch(search, terrain, 99);
  assert.equal(search.areas.length, 0);
  terrain.rows.splice(
    0,
    terrain.rows.length,
    ...terrain.rows.map((row) => row.replaceAll("#", ".")),
  );
  advanceAiSearch(search, terrain, 100);
  assert.deepEqual(search.areas[0]!.rect, { x1: 0, y1: 0, x2: 89, y2: 79 });
  assert.equal(
    search.status,
    "searching",
    "the source sleeps 1ms before expanding its first area",
  );
  advanceAiSearch(search, terrain, 101);
  assert.equal(search.status, "found");
});

test("native path results agree on the actual bundled level material planes", () => {
  for (const level of CLASSIC_LEVELS) {
    const world = createWorld(
      617,
      [
        { id: "a", slot: 0 },
        { id: "b", slot: 1 },
        { id: "c", slot: 2 },
      ],
      { ...DEFAULT_SETTINGS, level: level.id },
    );
    const terrain = new Terrain(
      world.terrain.rows.map((row) =>
        Array.from(decodeTerrainRow(row, world.terrain.width), (pixel) =>
          pixel === ROCK ? "#" : pixel === DIRT ? "d" : ".",
        ).join(""),
      ),
    );
    const pairs = [world.worms.slice(0, 2), world.worms.slice(1, 3)];
    const queries = pairs.map(
      ([a, b]) =>
        `path ${Math.trunc(a!.x)} ${Math.trunc(a!.y)} ${Math.trunc(b!.x)} ${Math.trunc(b!.y)}`,
    );
    const expected = native(terrain, queries),
      port = aiTerrain(world.terrain);
    for (let index = 0; index < pairs.length; index++) {
      const [a, b] = pairs[index]!,
        search = createAiSearch();
      requestAiSearch(search, a!, b!, 0);
      advanceAiSearch(search, port, 10000);
      assert.notEqual(
        search.status,
        "searching",
        `${level.id} search completes within supported work budget`,
      );
      assert.deepEqual(
        [search.result.length, ...search.result.flatMap((p) => [p.x, p.y])],
        expected[index],
        `${level.id} ${queries[index]}`,
      );
    }
  }
});
