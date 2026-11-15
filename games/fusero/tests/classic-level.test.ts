import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { test } from "node:test";
import {
  decodeLxl,
  generateClassicLevel,
  materialFromLxFlag,
  CLASSIC_LEVEL_SHA256,
  CLASSIC_LEVEL_FLAGS_SHA256,
} from "../../../scripts/fusero-decode-level.js";
import { CLASSIC_LEVEL_DATA } from "../src/engine/classic/level-data.js";
import {
  CLASSIC_LEVEL_HEIGHT,
  CLASSIC_LEVEL_WIDTH,
  createClassicLevel,
} from "../src/engine/classic/level.js";
import {
  AIR,
  DIRT,
  ROCK,
  decodeTerrain,
  decodeTerrainRow,
  encodeTerrain,
  setMaterial,
  validTerrainRow,
} from "../src/engine/classic/terrain.js";

const nativeFile = () =>
  readFileSync(new URL("../upstream/default-level.lxl", import.meta.url));

test("the default level is the exact pinned native Dirt Level file and dimensions", () => {
  const source = nativeFile();
  assert.equal(source.length, 59_879);
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    CLASSIC_LEVEL_SHA256,
  );
  assert.equal(source.toString("ascii", 0, 12), "LieroX Level");
  assert.equal(source.readInt32LE(32), 0);
  assert.equal(CLASSIC_LEVEL_WIDTH, 504);
  assert.equal(CLASSIC_LEVEL_HEIGHT, 350);
  assert.equal(CLASSIC_LEVEL_DATA.name, "Dirt Level");
  assert.equal(CLASSIC_LEVEL_DATA.theme, "dirt");
  assert.equal(CLASSIC_LEVEL_DATA.inflatedBytes, 1_234_801);
  assert.equal(
    CLASSIC_LEVEL_DATA.unusedPayloadBytes,
    1,
    "native image loader tolerates its unused terminal byte",
  );
});

test("every installed physical pixel equals the native flag plane, not the foreground colours", () => {
  const source = nativeFile(),
    width = source.readInt32LE(100),
    height = source.readInt32LE(104),
    pixels = width * height;
  const raw = inflateSync(source.subarray(156, 156 + source.readUInt32LE(148)));
  const flags = raw.subarray(pixels * 6, pixels * 7);
  assert.equal(
    createHash("sha256").update(flags).digest("hex"),
    CLASSIC_LEVEL_FLAGS_SHA256,
  );
  const installed = createClassicLevel(),
    counts = { air: 0, dirt: 0, rock: 0 };
  for (let y = 0; y < height; y++) {
    const row = decodeTerrainRow(installed.rows[y]!, width);
    for (let x = 0; x < width; x++) {
      const nativeFlag = flags[y * width + x]!;
      const expected = nativeFlag & 4 ? ROCK : nativeFlag & 2 ? DIRT : AIR;
      assert.equal(row[x], expected, `native physical pixel ${x},${y}`);
      if (expected === ROCK) counts.rock++;
      else if (expected === DIRT) counts.dirt++;
      else counts.air++;
    }
  }
  assert.deepEqual(counts, { air: 11_855, dirt: 159_596, rock: 4_949 });
});

test("styling can change image colours without changing collision or digging geometry", () => {
  const source = nativeFile(),
    pixels = 504 * 350;
  const raw = inflateSync(source.subarray(156, 156 + source.readUInt32LE(148)));
  raw.fill(0, 0, pixels * 6);
  const compressed = deflateSync(raw),
    changed = Buffer.alloc(156 + compressed.length);
  source.copy(changed, 0, 0, 156);
  changed.writeUInt32LE(compressed.length, 148);
  compressed.copy(changed, 156);
  const decoded = decodeLxl(changed);
  assert.notEqual(decoded.sourceSha256, CLASSIC_LEVEL_SHA256);
  assert.equal(decoded.flagsSha256, CLASSIC_LEVEL_FLAGS_SHA256);
  assert.deepEqual(decoded.rows, CLASSIC_LEVEL_DATA.rows);
});

test("native flag precedence preserves rock over dirt and ignores render-only shadow bits", () => {
  assert.equal(materialFromLxFlag(0), AIR);
  assert.equal(materialFromLxFlag(1 | 8 | 16), AIR);
  assert.equal(materialFromLxFlag(2 | 8), DIRT);
  assert.equal(materialFromLxFlag(1 | 2 | 4), ROCK);
});

test("native default level is compact validated terrain and fresh worlds do not share mutable row arrays", () => {
  const a = createClassicLevel(),
    b = createClassicLevel();
  assert.equal(
    a.rows.every((row) => validTerrainRow(row, a.width)),
    true,
  );
  assert.deepEqual(decodeTerrain(encodeTerrain(a)), a);
  assert.ok(Buffer.byteLength(JSON.stringify(a)) < 50_000);
  const original = b.rows[100];
  setMaterial(a, 250, 100, AIR);
  setMaterial(a, 251, 100, ROCK);
  assert.equal(b.rows[100], original);
  assert.equal(CLASSIC_LEVEL_DATA.rows[100], original);
  assert.notDeepEqual(a.rows, b.rows);
});

test("malformed source metadata and compressed data are rejected before installing terrain", () => {
  const source = nativeFile();
  for (const change of [
    (bytes: Buffer) => bytes.fill(0, 0, 32),
    (bytes: Buffer) => bytes.writeInt32LE(1, 32),
    (bytes: Buffer) => bytes.writeInt32LE(0, 100),
    (bytes: Buffer) => bytes.writeInt32LE(4096, 100),
    (bytes: Buffer) => bytes.writeInt32LE(0, 108),
    (bytes: Buffer) => bytes.writeUInt32LE(bytes.length, 148),
    (bytes: Buffer) => bytes.writeUInt32LE(1, 152),
    (bytes: Buffer) => bytes.fill(0, 156, 180),
  ]) {
    const malformed = Buffer.from(source);
    change(malformed);
    assert.throws(() => decodeLxl(malformed));
  }
  assert.throws(() => decodeLxl(source.subarray(0, source.length - 1)));
});

test("the baked native level regenerates byte-for-byte from its pinned source", async () => {
  await generateClassicLevel(true);
});
