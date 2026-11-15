import { test } from "node:test";
import assert from "node:assert/strict";
import { HeldControls } from "../src/app/controls.js";
import { LEFT, FIRE } from "../src/engine/index.js";

test("held controls preserve overlapping keyboard and touch sources and cancel completely", () => {
  const sent: number[] = [];
  const held = new HeldControls((bits) => sent.push(bits));
  held.set("keyboard", LEFT);
  held.set("finger1", LEFT);
  held.set("finger2", FIRE);
  held.set("finger1", 0);
  held.set("keyboard", 0);
  held.release();
  assert.deepEqual(sent, [LEFT, LEFT, LEFT | FIRE, LEFT | FIRE, FIRE, 0]);
});
