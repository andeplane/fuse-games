import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initialOffroadPickups,
  isOffroadPickups,
  offroadRacePurse,
  stepOffroadPickups,
} from "../src/game/offroad/pickups.js";

test("original 8086 spawn routine chooses matching positions, kinds and next seeds on all courses", () => {
  // Captured by running CS:0508 through RET in Unicorn with the original RNG.
  const cases = [
    [0, 2304, 1408, "nitro", 29412],
    [1, 4736, 9600, "nitro", 28330],
    [17, 7968, 9728, "nitro", 11018],
    [55, 8000, 1984, "cash", 225],
    [65535, 8192, 2048, "cash", 171],
    [30322, 2816, 2560, "cash", 171],
    [420, 2208, 1536, "cash", 29817],
    [987, 4352, 6368, "cash", 22783],
  ] as const;
  for (const [course, [seed, x, y, kind, next]] of cases.entries()) {
    let state = initialOffroadPickups();
    for (let i = 0; i < 119; i++) {
      const result = stepOffroadPickups(state, course, [], seed);
      state = result.state;
      assert.equal(state.active, null);
      assert.equal(result.randomSeed, seed);
    }
    const spawned = stepOffroadPickups(state, course, [], seed);
    assert.deepEqual(spawned.state.active, { x, y, kind });
    assert.equal(spawned.randomSeed, next);
    assert.ok(isOffroadPickups(spawned.state, course));
    assert.equal(
      stepOffroadPickups(spawned.state, course, [], next).state,
      spawned.state,
    );
  }
});

test("bucket edges, slot order, reward ladders, wait and state validation", () => {
  const active = { kind: "cash" as const, x: 2304, y: 1408 };
  const state = {
    ...initialOffroadPickups(),
    waitTicks: 0,
    active,
    cashLevel: 8,
    nitroLevel: 2,
  };
  // Pickup X buckets [17,25), heading-zero truck occupies four.
  const misses = { x: 27 * 128, y: 1408, heading: 0 };
  const touches = { ...misses, x: 26 * 128 };
  const result = stepOffroadPickups(state, 0, [misses, touches, touches], 5);
  assert.deepEqual(result.award, { slot: 1, kind: "cash", amount: 9 });
  assert.deepEqual(result.state, {
    waitTicks: 120,
    active: null,
    cashLevel: 9,
    nitroLevel: 2,
  });
  const capped = stepOffroadPickups(
    { ...result.state, active, waitTicks: 0 },
    0,
    [touches],
    5,
  );
  assert.equal(capped.award?.amount, 9);
  assert.equal(result.randomSeed, 5);
  assert.ok(!isOffroadPickups({ ...state, waitTicks: 1 }, 0));
  assert.ok(!isOffroadPickups({ ...state, active: { ...active, x: 2305 } }, 0));
  assert.ok(!isOffroadPickups({ ...state, nitroLevel: 10 }, 0));
  assert.ok(!isOffroadPickups({ ...state, active: null }, 0));
});

test("finish purse combines two-digit race cash with the DOS place award", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => offroadRacePurse(i, 3)),
    [13, 12, 11, 10, 3],
  );
  assert.equal(offroadRacePurse(0, 95), 5);
});
