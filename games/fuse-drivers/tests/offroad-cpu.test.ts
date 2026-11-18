import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createOffroadCpu,
  driveOffroadCpu,
  isOffroadCpuState,
  offroadCpuStats,
  type OffroadCpuState,
} from "../src/game/offroad/cpu.js";

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
