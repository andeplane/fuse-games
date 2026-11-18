import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeOffroadTerrain } from "../src/game/offroad/terrain.js";

const emptyContour = () => new Uint8Array(44 * 44 * 2);

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
