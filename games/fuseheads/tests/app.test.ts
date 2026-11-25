import assert from "node:assert/strict";
import test from "node:test";
import { createInputs } from "../src/app/controls.js";
import { INPUT_JUMP, INPUT_LEFT, INPUT_RIGHT } from "../src/game/simulation.js";

test("releasing an alias or cancelled finger preserves other held controls", () => {
  const calls: number[] = [];
  const input = createInputs(false, (mask) => calls.push(mask));
  input.key("KeyA", true);
  input.key("ArrowLeft", true);
  input.key("KeyA", false);
  input.touch(INPUT_JUMP, true);
  input.touch(INPUT_JUMP, false);
  input.clear();
  assert.deepEqual(calls, [INPUT_LEFT, INPUT_LEFT | INPUT_JUMP, INPUT_LEFT, 0]);
});
test("two local players can steer and release independently", () => {
  const calls: number[][] = [];
  const input = createInputs(true, (mask, slot) => calls.push([slot, mask]));
  input.key("ArrowRight", true);
  input.key("KeyA", true);
  input.key("KeyA", false);
  input.clear();
  assert.deepEqual(calls, [
    [1, INPUT_RIGHT],
    [0, INPUT_LEFT],
    [0, 0],
    [1, 0],
  ]);
});
