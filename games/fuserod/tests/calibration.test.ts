import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createMotor,
  isCarCalibration,
  motorGears,
  stepMotor,
  stockDrive,
  type Grade,
} from "../src/motor/index.js";
import { performanceFor } from "../src/motor/calibration.js";

for (const modified of [false, true]) {
  test(`DOS equipment setup for all 22 ${modified ? "modified" : "stock"} model profiles`, () => {
    const rows = Array.from({ length: 22 }, (_, model) => {
      const tune = stockDrive(model);
      if (modified) {
        Object.assign(tune, {
          power: 2,
          gearbox: 2,
          tires: 2,
          automatic: false,
        });
        Object.assign(tune.calibration, {
          manifold: model % 2 ? 8 : 2,
          carb: 2,
          exhaust: 1,
          muffler: -1,
          differential: (model % 3) as Grade,
          timing: -5 + (model % 9),
          wear: model * 399,
          removed: model % 8,
        });
      }
      assert.ok(isCarCalibration(tune.calibration));
      const fresh = createMotor(37, tune);
      assert.equal(fresh.engineWear, tune.calibration.wear);
      const step = stepMotor(
        { ...fresh, gear: 1, engaged: true },
        { throttle: true, brake: false, shift: 0, steer: 0 },
        tune,
      );
      return [motorGears(tune), performanceFor(tune), step.rpm, step.speed];
    });
    const digest = createHash("sha256")
      .update(JSON.stringify(rows))
      .digest("hex");
    assert.equal(
      digest,
      modified
        ? "d7678be75cf01afdf952bcd88c1ae711048e13dc12ea236d37d2f90ce9d0c8e0"
        : "eb7eefdda0c209985ede73ea0a5f29508dc4282a5a7119debbe4b1d12a156369",
      JSON.stringify(rows),
    );
  });
}

test("rejects malformed serialized garage setups", () => {
  const tune = stockDrive(0).calibration;
  for (const patch of [
    { model: 22 },
    { manifold: -1 },
    { muffler: 2 },
    { timing: 4 },
    { wear: 10001 },
    { removed: 8 },
    { carb: "1" },
    { extra: {} },
  ]) {
    assert.equal(isCarCalibration({ ...tune, ...patch }), false);
  }
});
