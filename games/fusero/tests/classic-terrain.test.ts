import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { test } from "node:test";
import {
  AIR,
  DIRT,
  ROCK,
  asPhysicsTerrain,
  canHook,
  carveHole,
  carveSpawn,
  createTerrain,
  decodeTerrain,
  decodeTerrainRow,
  encodeTerrain,
  encodeTerrainRow,
  findSpot,
  isGoodSpawnPoint,
  materialAt,
  placeDirt,
  placeGreenDirt,
  setMaterial,
  solid,
  uniformTerrain,
  validTerrainRow,
  visitTerrainRow,
} from "../src/engine/classic/terrain.js";
import {
  GREEN_DIRT_MASK,
  HOLE_MASKS,
} from "../src/engine/classic/terrain-masks.js";

/** Read the original RGB PNG fixtures independently of generated mask constants. */
function png(name: string) {
  const bytes = readFileSync(new URL(`../upstream/${name}`, import.meta.url));
  assert.equal(bytes.toString("hex", 0, 8), "89504e470d0a1a0a");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8);
  assert.equal(bytes[25], 2);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset),
      type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT")
      chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const filtered = inflateSync(Buffer.concat(chunks)),
    stride = width * 3;
  const rgb = new Uint8Array(stride * height);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x,
        left = x >= 3 ? rgb[at - 3]! : 0,
        above = y > 0 ? rgb[at - stride]! : 0,
        upperLeft = y > 0 && x >= 3 ? rgb[at - stride - 3]! : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : paeth(left, above, upperLeft);
      rgb[at] = filtered[y * (stride + 1) + 1 + x]! + predictor;
    }
  }
  const pixel = (x: number, y: number) => [
    ...rgb.subarray((y * width + x) * 3, (y * width + x) * 3 + 3),
  ];
  return {
    width,
    height,
    pixel,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const pink = (rgb: number[]) =>
  rgb[0] === 255 && rgb[1] === 0 && rgb[2] === 255;
const black = (rgb: number[]) => rgb.every((channel) => channel === 0);
const green = (rgb: number[]) => rgb[0] === 0 && rgb[1] === 255 && rgb[2] === 0;

test("hole and green-dirt physical masks match every pixel of the pinned native PNGs", () => {
  HOLE_MASKS.forEach((mask, index) => {
    const original = png(`dirt-hole${index + 1}.png`);
    assert.equal(mask.sha256, original.sha256);
    assert.equal(mask.width, original.width);
    assert.equal(mask.height, original.height);
    for (let y = 0; y < original.height; y++)
      for (let x = 0; x < original.width; x++) {
        const rgb = original.pixel(x, y);
        assert.equal(
          mask.rows[y]![x],
          black(rgb) ? "." : pink(rgb) ? "#" : "b",
        );
      }
  });
  const original = png("dirt-greenball.png");
  assert.equal(GREEN_DIRT_MASK.sha256, original.sha256);
  for (let y = 0; y < original.height; y++)
    for (let x = 0; x < original.width; x++) {
      const rgb = original.pixel(x, y);
      assert.equal(
        GREEN_DIRT_MASK.rows[y]![x],
        pink(rgb) ? "." : green(rgb) ? "#" : "b",
      );
    }
});

test("per-pixel carving preserves native masks rather than circular radius/falloff holes", () => {
  for (let size = 0; size < 5; size++) {
    const original = png(`dirt-hole${size + 1}.png`),
      terrain = uniformTerrain(40, 40, DIRT);
    const x0 = 20 - Math.floor(original.width / 2),
      y0 = 20 - Math.floor(original.height / 2);
    let removed = 0;
    for (let y = 0; y < original.height; y++)
      for (let x = 0; x < original.width; x++)
        if (pink(original.pixel(x, y))) removed++;
    assert.equal(carveHole(terrain, size, 20.9, 20.9), removed);
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 40; x++) {
        const within =
          x >= x0 &&
          y >= y0 &&
          x < x0 + original.width &&
          y < y0 + original.height;
        assert.equal(
          materialAt(terrain, x, y),
          within && pink(original.pixel(x - x0, y - y0)) ? AIR : DIRT,
        );
      }
  }
});

test("rock survives carving and dirt placement, and one-pixel material changes stay one pixel", () => {
  const terrain = uniformTerrain(30, 30, AIR);
  setMaterial(terrain, 15, 15, ROCK);
  setMaterial(terrain, 16, 15, DIRT);
  assert.equal(materialAt(terrain, 17, 15), AIR);
  assert.equal(solid(terrain, 16, 15), true);
  assert.equal(solid(terrain, 17, 15), false);
  assert.equal(canHook(terrain, 15, 15), true);
  assert.equal(canHook(terrain, 17, 15), false);
  carveHole(terrain, 4, 15, 15);
  assert.equal(materialAt(terrain, 15, 15), ROCK);
  assert.equal(materialAt(terrain, 16, 15), AIR);
  placeDirt(terrain, 4, 15, 15);
  assert.equal(materialAt(terrain, 15, 15), ROCK);
  placeGreenDirt(terrain, 15, 15);
  assert.equal(materialAt(terrain, 15, 15), ROCK);
});

test("PlaceDirt includes the rim and preserves its native double-count quirk", () => {
  const original = png("dirt-hole1.png"),
    terrain = uniformTerrain(20, 20, AIR);
  let placed = 0,
    reported = 0;
  for (let y = 0; y < original.height; y++)
    for (let x = 0; x < original.width; x++) {
      const rgb = original.pixel(x, y);
      if (!black(rgb)) {
        placed++;
        reported += pink(rgb) ? 1 : 2;
      }
    }
  assert.equal(placeDirt(terrain, 0, 10, 10), reported);
  assert.equal(
    Array.from(
      { length: 20 },
      (_, y) =>
        [...decodeTerrainRow(terrain.rows[y]!, 20)].filter(
          (cell) => cell === DIRT,
        ).length,
    ).reduce((a, b) => a + b),
    placed,
  );
  assert.equal(placeDirt(terrain, 0, 10, 10), 0);
});

test("Greenball dirt uses its distinct 8×9 footprint and only fills empty cells", () => {
  const original = png("dirt-greenball.png"),
    terrain = uniformTerrain(24, 24, AIR);
  const expected = Array.from({ length: original.height }, (_, y) =>
    Array.from({ length: original.width }, (_, x) =>
      Number(!pink(original.pixel(x, y))),
    ),
  )
    .flat()
    .reduce((a, b) => a + b);
  assert.equal(placeGreenDirt(terrain, 12, 12), expected);
  assert.equal(placeGreenDirt(terrain, 12, 12), 0);
  for (let y = 0; y < original.height; y++)
    for (let x = 0; x < original.width; x++)
      assert.equal(
        materialAt(terrain, 8 + x, 8 + y),
        pink(original.pixel(x, y)) ? AIR : DIRT,
      );
});

test("native carve clipping starts at mask 0,0 while placement offsets its source correctly", () => {
  const terrain = uniformTerrain(12, 12, DIRT);
  carveHole(terrain, 0, 0, 0);
  const source = png("dirt-hole1.png");
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++)
      assert.equal(
        materialAt(terrain, x, y),
        pink(source.pixel(x, y)) ? AIR : DIRT,
      );
  const placed = uniformTerrain(12, 12, AIR);
  placeDirt(placed, 0, 0, 0);
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++)
      assert.equal(
        materialAt(placed, x, y),
        black(source.pixel(x + 2, y + 2)) ? AIR : DIRT,
      );
});

test("the largest hole is clamped and spawning uses its physical mask", () => {
  const a = uniformTerrain(40, 40, DIRT),
    b = uniformTerrain(40, 40, DIRT);
  assert.equal(carveHole(a, 99, 20, 20), carveSpawn(b, 20, 20));
  assert.deepEqual(a, b);
});

test("wrapped carving mutates the wrapped copy but reports only native primary-copy dirt count", () => {
  const terrain = uniformTerrain(12, 12, DIRT);
  assert.equal(carveHole(terrain, 0, 0, 6, true), 9);
  assert.equal(materialAt(terrain, 11, 5), AIR);
  assert.equal(materialAt(terrain, 10, 6), AIR);
  assert.equal(materialAt(terrain, 11, 7), AIR);
  const removed = terrain.rows.reduce(
    (total, row) =>
      total +
      [...decodeTerrainRow(row, 12)].filter((cell) => cell === AIR).length,
    0,
  );
  assert.equal(removed, 13);
});

test("RLE rows roundtrip arbitrary pixel changes canonically and expose exact spans", () => {
  const pixels = Uint8Array.from([ROCK, ROCK, AIR, DIRT, DIRT, AIR, AIR, AIR]);
  const encoded = encodeTerrainRow(pixels);
  assert.equal(validTerrainRow(encoded, 8), true);
  assert.deepEqual(decodeTerrainRow(encoded, 8), pixels);
  const spans: number[][] = [];
  visitTerrainRow(encoded, (x, length, material) =>
    spans.push([x, length, material]),
  );
  assert.deepEqual(spans, [
    [0, 2, ROCK],
    [2, 1, AIR],
    [3, 2, DIRT],
    [5, 3, AIR],
  ]);
  const terrain = uniformTerrain(8, 4, AIR),
    untouched = terrain.rows[0];
  for (let x = 0; x < 8; x++)
    setMaterial(terrain, x, 2, pixels[x]! as 0 | 1 | 2);
  assert.equal(terrain.rows[2], encoded);
  assert.equal(terrain.rows[0], untouched);
  assert.deepEqual(decodeTerrain(encodeTerrain(terrain)), terrain);
  const encodedCopy = encodeTerrain(terrain);
  encodedCopy.rows[0] = encodeTerrainRow(new Uint8Array(8).fill(ROCK));
  assert.equal(terrain.rows[0], untouched);
});

test("malformed or excessive terrain snapshots are rejected without mutating healthy terrain", () => {
  const healthy = uniformTerrain(8, 4, DIRT),
    before = structuredClone(healthy);
  for (const raw of [
    null,
    {},
    { ...healthy, extra: true },
    { ...healthy, width: 0 },
    { ...healthy, width: 4096 },
    { ...healthy, width: 2000, height: 2000 },
    { ...healthy, rows: [] },
    { ...healthy, rows: ["\0", ...healthy.rows.slice(1)] },
    { ...healthy, rows: [String.fromCharCode(32), ...healthy.rows.slice(1)] },
    {
      ...healthy,
      rows: [
        String.fromCharCode(34) + String.fromCharCode(34),
        ...healthy.rows.slice(1),
      ],
    },
  ])
    assert.equal(decodeTerrain(raw), undefined);
  assert.deepEqual(healthy, before);
});

test("physics terrain adapter shares native pass/hook flags and mask-index carving", () => {
  const terrain = uniformTerrain(32, 32, DIRT),
    port = asPhysicsTerrain(terrain);
  assert.deepEqual(port.material(15, 15), {
    wormPass: false,
    particlePass: false,
    canHook: true,
    destroyable: true,
    damage: 0,
  });
  port.carve(15, 15, 0);
  assert.equal(port.material(15, 15).wormPass, true);
  assert.equal(port.material(15, 15).particlePass, true);
  assert.equal(port.material(-1, 15).wormPass, false);
});

test("FindSpot accepts dirt, excludes only the source's half-open 6×6 rock box, and bounds attempts", () => {
  const terrain = uniformTerrain(30, 30, DIRT);
  setMaterial(terrain, 13, 10, ROCK);
  assert.equal(
    isGoodSpawnPoint(terrain, 10, 10),
    true,
    "+3 lies outside the source's half-open scan",
  );
  setMaterial(terrain, 12, 10, ROCK);
  assert.equal(isGoodSpawnPoint(terrain, 10, 10), false);
  const floats = [10 / 30, 10 / 30, 20 / 30, 20 / 30];
  let at = 0;
  assert.deepEqual(
    findSpot(terrain, () => floats[at++]!),
    { x: 20, y: 20 },
  );
  assert.equal(at, 4);
  let attempts = 0;
  assert.deepEqual(
    findSpot(uniformTerrain(20, 20, ROCK), () => {
      attempts++;
      return 0.5;
    }),
    { x: 10, y: 10 },
  );
  assert.equal(attempts, 2000);
});

test("seeded full-size pixel caves stay compact and expose air passages at every depth", () => {
  const terrain = createTerrain(713);
  assert.deepEqual(terrain, createTerrain(713));
  assert.notDeepEqual(terrain.rows, createTerrain(714).rows);
  assert.equal(terrain.width, 1536);
  assert.equal(terrain.height, 864);
  assert.ok(
    Buffer.byteLength(JSON.stringify(encodeTerrain(terrain))) < 150_000,
  );
  for (const depth of [0.16, 0.38, 0.61, 0.84])
    assert.equal(
      materialAt(
        terrain,
        Math.round(terrain.width * 0.5),
        Math.round(terrain.height * depth),
      ),
      AIR,
    );
  assert.deepEqual(decodeTerrain(encodeTerrain(terrain)), terrain);
});
