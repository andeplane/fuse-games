import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMachine,
  createMachine,
  PUZZLES,
  stepMachine,
  validMachine,
} from "../src/game/machine.js";
import { SHOWCASE_PUZZLE } from "../src/game/machine-showcase.js";

test("the packing line waits for the marble to close the outlet before the motor delivers its parcel", () => {
  for (const installed of [false, true]) {
    const m = createMachine(PUZZLES.indexOf(SHOWCASE_PUZZLE));
    if (installed)
      assert.ok(
        applyMachine(m, { type: "place", kind: "ramp", x: 110, y: 130 }),
      );
    assert.ok(applyMachine(m, { type: "run" }));
    while (m.mode === "running") stepMachine(m);
    assert.ok(validMachine(m));
    assert.equal(m.mode, installed ? "solved" : "failed");
    if (installed) {
      const parcel = m.bodies.find((b) => b.id === 5);
      assert.deepEqual([parcel?.x, parcel?.y], [572, 240]);
    }
  }
});
