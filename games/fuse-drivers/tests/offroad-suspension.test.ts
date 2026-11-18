import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOffroadSuspension,
  stepOffroadSuspension,
} from "../src/game/offroad/suspension.js";

const motion = {
  x: 1024,
  y: 1024,
  heading: 0,
  momentum: 0,
  speed: 100,
  throttle: 200,
  nitroTicks: 0,
  backwards: false,
};
const flat = {
  height: 0x8000,
  kind: 0,
  blocked: false,
  direction: 0,
  slopeX: 0,
  slopeY: 0,
};

test("four contact probes follow body heading and retain their bit order", () => {
  const state = createOffroadSuspension();
  const points: number[][] = [];
  const result = stepOffroadSuspension(
    state,
    motion,
    (x, y) => {
      points.push([x, y]);
      return {
        ...flat,
        height: x < motion.x ? flat.height - 1024 : flat.height,
      };
    },
    1,
  );
  assert.deepEqual(points, [
    [843, 843],
    [843, 1205],
    [1205, 843],
    [1205, 1205],
  ]);
  assert.equal(result.groundMask, 3);
  assert.deepEqual(
    result.suspension.wheels.map((w) => w.velocity),
    [-256, -256, 0, 0],
  );
  assert.equal(result.suspension.bodyHeight, 0x8000);
  assert.equal(result.suspension.groundHeight, 0x7e00);
  assert.deepEqual(state, createOffroadSuspension());
  assert.deepEqual(result.motion, motion);
});

test("a landing keeps its signed impact, snaps small rebounds, and caps a hard bounce", () => {
  const state = createOffroadSuspension();
  const speeds = [-1000, -3000, -10000, 0];
  state.wheels.forEach((w, i) => {
    w.velocity = speeds[i]!;
  });
  const landed = stepOffroadSuspension(state, motion, () => flat, 9);
  assert.deepEqual(
    landed.suspension.wheels.map((w) => w.velocity),
    [0, 703, 2048, 0],
  );
  assert.equal(landed.groundMask, 15);
  const bounced = stepOffroadSuspension(
    landed.suspension,
    motion,
    () => flat,
    9,
  );
  assert.deepEqual(
    bounced.suspension.wheels.map((w) => w.clearance),
    [0, 703, 2048, 0],
  );
  assert.deepEqual(
    bounced.suspension.wheels.map((w) => w.velocity),
    [0, 447, 1792, 0],
  );
  assert.equal(bounced.groundMask, 9);
  // Chassis load raises the lower diagonal after contact and body-height measurement.
  assert.deepEqual(
    bounced.suspension.wheels.map((w) => w.height),
    [33455, 33471, 34816, 33455],
  );
});

test("an oblique first-wheel barrier pins one axis and turns subsequent wheel probes", () => {
  let probes = 0;
  const points: number[][] = [];
  const result = stepOffroadSuspension(
    createOffroadSuspension(),
    motion,
    (x, y) => {
      points.push([x, y]);
      return ++probes === 1 ? { ...flat, blocked: true, direction: 192 } : flat;
    },
    123,
  );
  assert.equal(result.stopX, false);
  assert.equal(result.stopY, true);
  assert.equal(result.motion.heading, 61440);
  assert.equal(result.motion.momentum, 0);
  assert.equal(result.motion.throttle, 150);
  assert.equal(result.motion.speed, 78);
  assert.equal(result.randomSeed, 123);
  assert.deepEqual(points[1], [926, 1261]);
});

test("a head-on collision consumes one DOS random draw, reverses and cancels nitro", () => {
  let probes = 0;
  const result = stepOffroadSuspension(
    createOffroadSuspension(),
    { ...motion, nitroTicks: 15 },
    () => (++probes === 1 ? { ...flat, blocked: true, direction: 128 } : flat),
    7,
  );
  assert.equal(result.randomSeed, 1368);
  assert.equal(result.stopX, true);
  assert.equal(result.stopY, true);
  assert.equal(result.motion.speed, 83);
  assert.equal(result.motion.throttle, 0);
  assert.equal(result.motion.nitroTicks, 0);
  assert.equal(result.motion.backwards, true);
  assert.equal(result.motion.heading, 57344);
  assert.equal(result.motion.momentum, 24576);
});

test("an out-of-grid probe keeps the previous ground and blocks travel on both axes", () => {
  const state = createOffroadSuspension(4567);
  const result = stepOffroadSuspension(state, motion, () => null, 555);
  // Body and terrain averages truncate each half, as the DOS routine does.
  assert.equal(result.suspension.groundHeight, 4566);
  assert.equal(result.suspension.bodyHeight, 4566);
  assert.equal(result.stopX && result.stopY, true);
  assert.equal(result.groundMask, 15);
  assert.deepEqual(result.motion, motion);
});

test("a wheel reaching column 44 samples column zero of the next row with its original fraction", () => {
  const points: number[][] = [];
  const state = createOffroadSuspension();
  const moved = { ...motion, x: 44 * 256 - 90 };
  const result = stepOffroadSuspension(
    state,
    moved,
    (x, y) => {
      points.push([x, y]);
      return x < 256 ? { ...flat, height: 0x9000 } : flat;
    },
    1,
  );
  assert.deepEqual(points.slice(2), [
    [91, 1099],
    [91, 1461],
  ]);
  assert.equal(result.suspension.groundHeight, 0x8800);
  assert.equal(result.stopX || result.stopY, false);
  // A wheel beyond the last row has no valid contour record to alias.
  const edge = stepOffroadSuspension(
    state,
    { ...moved, y: 44 * 256 - 181 },
    () => null,
    1,
  );
  assert.equal(edge.stopX && edge.stopY, true);
});

test("observed Y overrun rows use the original default barrier normal inside the 44 course columns", () => {
  const state = createOffroadSuspension();
  for (const y of [44 * 256 + 128, 45 * 256 - 1, 65535]) {
    const result = stepOffroadSuspension(
      state,
      { ...motion, y },
      () => flat,
      1,
    );
    // With heading zero and the polygon-zero normal (+Y), the wheel routine
    // restores momentum along the body without pinning either position axis.
    assert.equal(result.stopX || result.stopY, false);
    assert.equal(result.groundMask, 15);
  }
  const distant = stepOffroadSuspension(
    state,
    { ...motion, y: 48 * 256 },
    () => flat,
    1,
  );
  assert.equal(distant.stopX && distant.stopY, true);
  const corner = stepOffroadSuspension(
    state,
    { ...motion, x: 48 * 256, y: 44 * 256 + 220 },
    () => flat,
    1,
  );
  assert.equal(corner.stopX && corner.stopY, true);
});
