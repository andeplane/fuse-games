import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createOffroadCpu,
  driveOffroadCpu,
  isOffroadCpuState,
  offroadCpuStats,
  offroadStartingLevel,
  offroadPaceProgress,
  offroadCatchupLevel,
  type OffroadCpuState,
} from "../src/game/offroad/cpu.js";

test("the CPU grid skips humans when handing out per-course difficulty tiers", () => {
  const all = [true, true, true, true];
  assert.deepEqual(
    all.map((_, slot) => offroadStartingLevel("offroad-4", slot, all)),
    [0, 0, 1, 2],
  );
  const mixed = [true, false, true, false];
  assert.equal(offroadStartingLevel("offroad-4", 0, mixed), 4);
  assert.equal(offroadStartingLevel("offroad-4", 2, mixed), 5);
  assert.equal(offroadStartingLevel("offroad-7-reverse", 2, mixed), 4);
});

test("pace mutates previously normalized out-of-region progress again on the next frame", () => {
  // GAME.EXE full race 0, mixed-human trace, updates 180 and 181.
  const human = offroadPaceProgress(27, 141);
  assert.equal(human, 12549);
  assert.equal(
    offroadCatchupLevel(
      5,
      0,
      offroadPaceProgress(58, 141) >>> 8,
      0,
      human >>> 8,
    ),
    4,
  );
  const stillOutside = offroadPaceProgress(human, 141);
  assert.equal(stillOutside, 65535);
  assert.equal(
    offroadCatchupLevel(
      5,
      0,
      offroadPaceProgress(59, 141) >>> 8,
      0,
      stillOutside >>> 8,
    ),
    3,
  );
});

test("all 16 CPU programs reproduce 1,920 original route and input decisions", () => {
  let sequence = 417;
  function sample(lo: number, hi: number) {
    sequence = (Math.imul(sequence, 1664525) + 1013904223) >>> 0;
    return lo + (sequence % (hi - lo));
  }
  const hash = createHash("sha256");
  for (let variant = 0; variant < 16; variant++) {
    let state: OffroadCpuState | undefined,
      seed = 13,
      x = 0,
      y = 0;
    const name =
      "offroad-" + String((variant % 8) + 1) + (variant >= 8 ? "-reverse" : "");
    for (let i = 0; i < 120; i++) {
      if (i % 7 === 0) {
        x = sample(1024, 10240);
        y = sample(1024, 10240);
      } else {
        x += sample(-180, 181);
        y += sample(-180, 181);
      }
      const heading = sample(0, 65536),
        throttle = [0, 32, 96, 256][sample(0, 4)]!,
        region = sample(0, 12),
        nitroTicks = sample(0, 21);
      const decision = driveOffroadCpu(
        name,
        state,
        { x, y, heading, throttle, nitroTicks, region },
        seed,
      );
      state = decision.state;
      seed = decision.seed;
      assert.ok(isOffroadCpuState(state, name));
      hash.update(
        [
          decision.input.steer,
          Number(decision.input.gas),
          Number(decision.input.nitro),
          state.pc,
          state.radius,
          state.pedal,
          seed,
        ].join(",") + "\n",
      );
    }
  }
  assert.equal(
    hash.digest("hex"),
    "3aef00ec1492c3a649be06454404856cefc0955bd88d84687b8f2cb676efc37d",
  );
});

test("grid setup selects targets before the driver's first input", () => {
  const frame = {
    x: 1920,
    y: 6880,
    heading: 0,
    throttle: 0,
    nitroTicks: 0,
    region: 0,
    difficulty: 3,
  };
  const { state, seed } = createOffroadCpu("offroad-1", frame, 0);
  assert.equal(state.level, 3);
  assert.deepEqual(
    driveOffroadCpu("offroad-1", state, frame, seed),
    driveOffroadCpu("offroad-1", undefined, frame, 0),
  );
  assert.equal(isOffroadCpuState({ ...state, pc: 0 }, "offroad-1"), false);
  assert.equal(
    isOffroadCpuState({ ...state, next: Infinity }, "offroad-1"),
    false,
  );
  assert.equal(isOffroadCpuState({ ...state, level: 18 }, "offroad-1"), false);
  assert.equal(offroadCpuStats(3).speedLimit, 128);
  assert.equal(offroadCpuStats(3).acceleration, 11);
});
