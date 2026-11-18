import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOffroadMotion,
  offroadDriveStats,
  offroadTrucksOverlap,
  resolveOffroadTruckContact,
  stepOffroadMotion,
} from "../src/game/offroad/motion.js";

// Expected values recorded by executing the supplied GAME.EXE's real-mode
// instructions under Unicorn (SHA-256 a67ba31b021ed53d2d033cbe67ecb32a4537bf20593392bcf4ba85d3fd67836c).
// CS:1388 initializes human slot zero on track zero. Each step enters 1778
// with the input mask in AL, then calls 17a1 (nitro), 1871 (movement) and
// 1c8b (contact-dependent steering/drive). Only nitro sound and effect
// allocation calls are skipped. Wheel clearances are supplied by each case.
test("matches the DOS four-wheel acceleration, turn and coast trace", () => {
  let state = createOffroadMotion(1920, 6880, 0);
  assert.equal(state.acceleration, 215);
  const expected = [
    [32, 1920, 6880, 0, 0, 16],
    [64, 1936, 6880, 0, 0, 33],
    [96, 1969, 6880, 0, 0, 50],
    [128, 2019, 6880, 0, 0, 67],
    [160, 2086, 6880, 1536, 0, 83],
    [192, 2169, 6880, 3072, 576, 100],
    [224, 2267, 6899, 4608, 1440, 117],
    [256, 2381, 6921, 6144, 2592, 134],
    [256, 2504, 6972, 7680, 3840, 134],
    [256, 2627, 7023, 7680, 5280, 134],
    [240, 2738, 7097, 7680, 6144, 130],
    [224, 2846, 7169, 7680, 6720, 126],
    [208, 2935, 7258, 7680, 7008, 122],
    [192, 3021, 7344, 7680, 7200, 118],
    [176, 3104, 7427, 7680, 7296, 114],
  ];
  for (const [i, row] of expected.entries()) {
    state = stepOffroadMotion(state, {
      gas: i < 10,
      steer: i >= 4 && i < 9 ? 1 : 0,
      nitro: false,
    });
    const { throttle, x, y, heading, momentum, speed } = state;
    assert.deepEqual([throttle, x, y, heading, momentum, speed], row);
  }
});

test("first contact matches DOS vector exchange and inverse-angle conversion", () => {
  const stock = createOffroadMotion(1000, 1000, 0);
  // Captured from CS:169d with BP selecting slot one, SI the slot-zero actor.
  // The sole skipped call at 16e3 plays the impact sound.
  const cases = [
    [134, 0, 0, 0, 0x01ab, 34, 0x01ac, 100],
    [90, 31, -75, -30, 0x91ab, 35, 0x0dac, 50],
    [0, 0, 0, 0, 0x00ab, 0, 0x00ac, 0],
    [0, -256, -76, 96, 0x7bab, 57, 0xbbac, 169],
    [294, 414, -98, 920, 0x3fab, 794, 0x31ac, 574],
  ] as const;
  for (const [vxA, vyA, vxB, vyB, angleA, speedA, angleB, speedB] of cases) {
    const [a, b] = resolveOffroadTruckContact(
      { ...stock, vx: vxA, vy: vyA, momentum: 0x77ab, throttle: 14 },
      { ...stock, vx: vxB, vy: vyB, momentum: 0x77ac, throttle: 48 },
    );
    assert.deepEqual([a.momentum, a.speed, a.throttle], [angleA, speedA, 32]);
    assert.deepEqual([b.momentum, b.speed, b.throttle], [angleB, speedB, 48]);
  }
});

test("heading selects the footprint and touching adjacent occupancy buckets stays clear", () => {
  const a = createOffroadMotion(1024, 1024, 0);
  assert.equal(offroadTrucksOverlap(a, { ...a, x: 1024 + 511 }), true);
  assert.equal(offroadTrucksOverlap(a, { ...a, x: 1024 + 512 }), false);
  assert.equal(offroadTrucksOverlap(a, { ...a, y: 1024 + 256 }), false);
  const vertical = { ...a, heading: 16384 };
  assert.equal(
    offroadTrucksOverlap(vertical, { ...vertical, y: 1024 + 256 }),
    true,
  );
});

test("steering and drive axles respond separately to the contact mask", () => {
  const stock = createOffroadMotion(1000, 1000, 0);
  const state = { ...stock, heading: 0x2400, speed: 80, throttle: 128 };
  const input = { gas: true, steer: 1, nitro: false } as const;
  for (const [mask, heading, momentum, speed] of [
    [5, 9984, 1728, 83],
    [12, 9216, 0, 83],
    [0, 9216, 0, 80],
  ] as const) {
    const next = stepOffroadMotion(state, input, mask);
    assert.deepEqual(
      [next.x, next.y, next.heading, next.momentum, next.speed],
      [1080, 1000, heading, momentum, speed],
    );
  }
});

test("nitro repeat gate and backwards recovery match DOS branches", () => {
  const stock = createOffroadMotion(1000, 1000, 0, 2);
  const state = { ...stock, speed: 200, throttle: 256 };
  const input = { gas: true, steer: 1, nitro: true } as const;
  for (const [ticks, x, speed, timer, stockLeft] of [
    [13, 1200, 201, 12, 2],
    [12, 1300, 296, 20, 1],
  ] as const) {
    const next = stepOffroadMotion({ ...state, nitroTicks: ticks }, input);
    assert.deepEqual(
      [next.x, next.speed, next.nitroTicks, next.nitros],
      [x, speed, timer, stockLeft],
    );
  }
  const backwards = stepOffroadMotion(
    { ...stock, backwards: true, momentum: 32768, speed: 96, throttle: 96 },
    { gas: false, steer: 1, nitro: true },
    0,
  );
  assert.deepEqual(
    [
      backwards.x,
      backwards.speed,
      backwards.throttle,
      backwards.momentum,
      backwards.nitros,
    ],
    [1000, 0, 0, 0, 1],
  );
});

test("upgraded tires steer faster and upgraded top speed reaches its DOS cap", () => {
  let state = createOffroadMotion(1000, 1000, 0);
  const stats = offroadDriveStats(5, 5);
  for (let i = 0; i < 12; i++)
    state = stepOffroadMotion(
      state,
      { gas: true, steer: 0, nitro: false },
      15,
      stats,
    );
  assert.equal(state.speed, 154);
  state = stepOffroadMotion(
    state,
    { gas: true, steer: -1, nitro: false },
    15,
    stats,
  );
  assert.equal(state.heading, 65536 - 2176);
});
