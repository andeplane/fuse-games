import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { getOffroadTerrain } from "../src/game/offroad/courses.js";
import { decodeOffroadTerrain } from "../src/game/offroad/terrain.js";

const emptyContour = () => new Uint8Array(44 * 44 * 2);

test("bundled contact planes match 61,952 probes of the DOS executable", () => {
  // Reference: run GAME.EXE 0x227e–0x2359 to build the grid, then run
  // 0x1d0a to the blocked path (0x1e68) or computed height (AX at 0x1d95).
  // Hash one sample inside each triangle in row order. Blocked contacts use
  // the truck's previous heights and have no computed ground height.
  const expected = [
    "9b8087420333010bbbbae1058668aa12f81e3774e7038001abcad9fe86ebae2c",
    "7e006777d9d0516400ad21c51954977fdc9fec8205c12e828d13435337f7579a",
    "198a79a87e563dcdcb57eb41ab4188a2ce43e6c4dee44a354ff879f44e952693",
    "8ac6105f9501c0a2a409e95014e55ad4092e4a72c4bcbd99d14c5bd579e074b0",
    "5d2df81dbf3f5c09cfd6ab45583651807749fabf339342d5802ad6c05af96d76",
    "94a30b638a74b6bd0f36137fa6d60dcf2867a52f659192a14eab94c1d863bdeb",
    "4f5f8cc7522d49f23d49575361b6426630b8413e0ca4ca1c88246397d913841c",
    "5638ef26d1650397206d31aac6e18d47171db0b0debf4c3a7dad7022ac1efb9b",
  ];
  for (const [index, expectedHash] of expected.entries()) {
    const course = "offroad-" + (index + 1);
    const terrain = getOffroadTerrain(course)!;
    assert.equal(getOffroadTerrain(course + "-reverse"), terrain);
    const hash = createHash("sha256");
    for (let row = 0; row < 44; row++) {
      for (let col = 0; col < 44; col++) {
        for (const [x, y] of [
          [128, 128],
          [75, 190],
          [25, 94],
          [170, 25],
        ] as const) {
          const s = terrain.sample(col * 256 + x, row * 256 + y)!;
          const height = s.blocked ? 0 : s.height;
          hash.update(
            Uint8Array.of(
              +s.blocked,
              s.kind,
              s.direction,
              s.slopeX,
              s.slopeY,
              height & 255,
              height >>> 8,
            ),
          );
        }
      }
    }
    assert.equal(hash.digest("hex"), expectedHash, course);
  }
  assert.equal(getOffroadTerrain("offroad-0"), null);
  assert.equal(getOffroadTerrain("offroad-9"), null);
  assert.equal(getOffroadTerrain("custom"), null);
});

test("chooses the four triangular sectors, including both exact diagonals", () => {
  const contour = emptyContour();
  contour[0] = 1;
  const quad = Uint8Array.of(0, 0, 4, 0, 8, 0, 12, 0);
  const poly = Uint8Array.of(
    0,
    11,
    0,
    0,
    0,
    22,
    0,
    0,
    0,
    33,
    0,
    0,
    2,
    44,
    0,
    0,
  );
  const terrain = decodeOffroadTerrain(0, contour, quad, poly);
  contour.fill(255);
  quad.fill(255);
  poly.fill(255);
  assert.equal(terrain.sample(96, 160)?.direction, 11);
  assert.equal(terrain.sample(128, 128)?.direction, 22);
  assert.equal(terrain.sample(20, 100)?.direction, 33);
  assert.equal(terrain.sample(100, 100)?.kind, 2);
});

test("rebuilds row and column center heights, quantizes wheel positions to even units and wraps heights", () => {
  const terrain = decodeOffroadTerrain(
    0,
    emptyContour(),
    new Uint8Array(),
    Uint8Array.of(0, 32, 2, 253),
  );
  assert.deepEqual(terrain.sample(128, 128), {
    height: 32768,
    kind: 0,
    direction: 32,
    slopeX: 2,
    slopeY: -3,
    blocked: false,
  });
  assert.equal(terrain.sample(384, 128)?.height, 32768 + 512);
  assert.equal(terrain.sample(128, 384)?.height, 32768 + 768);
  assert.equal(terrain.sample(131, 137)?.height, 32768 + 4 - 24);
  assert.equal(
    terrain.sample(43 * 256 + 128, 43 * 256 + 128)?.height,
    (32768 + 43 * 1280) & 65535,
  );
  for (const v of [-1, 11264, 0.5, NaN, Infinity])
    assert.equal(terrain.sample(v, 0), null);
  assert.equal(terrain.sample(0, 11264), null);
});

test("uses the course-specific unsigned grade gate as well as the wall flag", () => {
  const contour = emptyContour();
  const build = (track: number, kind: number, dx: number, dy: number) =>
    decodeOffroadTerrain(
      track,
      contour,
      new Uint8Array(),
      Uint8Array.of(kind, 0, dx, dy),
    ).sample(128, 128)?.blocked;
  assert.equal(build(0, 2, -18, 18), false);
  assert.equal(build(0, 0, -19, 0), true);
  assert.equal(build(0, 0, 0, 19), true);
  assert.equal(build(0, 128, 0, 0), true);
  assert.equal(build(1, 0, 0, 16), true);
});

test("rejects truncated, misaligned, and out-of-range contour and polygon records", () => {
  const poly = new Uint8Array(4);
  const quad = new Uint8Array(8);
  const contour = emptyContour();
  assert.throws(() => decodeOffroadTerrain(8, contour, quad, poly), /course/);
  assert.throws(
    () => decodeOffroadTerrain(0, contour.subarray(2), quad, poly),
    /contour/,
  );
  assert.throws(
    () => decodeOffroadTerrain(0, contour, quad.subarray(1), poly),
    /quad/,
  );
  assert.throws(
    () => decodeOffroadTerrain(0, contour, quad, poly.subarray(1)),
    /poly/,
  );
  for (const offset of [2, 4, 5, 9]) {
    contour[0] = offset;
    assert.throws(() => decodeOffroadTerrain(0, contour, quad, poly), /offset/);
  }
  contour[0] = 1;
  quad[0] = 4;
  assert.throws(() => decodeOffroadTerrain(0, contour, quad, poly), /polygon/);
});
