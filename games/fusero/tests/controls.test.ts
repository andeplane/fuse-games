import { test } from "node:test";
import assert from "node:assert/strict";
import { HeldControls, KEY_BITS } from "../src/app/controls.js";
import {
  LEFT,
  FIRE,
  ROPE,
  PREV,
  NEXT,
  CARVE,
  SLOT1,
  SLOT5,
} from "../src/engine/classic/physics-types.js";

test("held controls preserve overlapping keyboard and touch sources and cancel completely", () => {
  const sent: number[] = [];
  const held = new HeldControls(
    (bits) => sent.push(bits),
    () => 0,
  );
  held.set("keyboard", LEFT);
  held.set("finger1", LEFT);
  held.set("finger2", FIRE);
  held.set("finger1", 0);
  held.set("keyboard", 0);
  held.release();
  assert.deepEqual(sent, [LEFT, LEFT, LEFT | FIRE, LEFT | FIRE, FIRE, 0]);
});

test("touch walking auto-carves every 200 ms through ordinary press and release edges", () => {
  let now = 0;
  const sent: number[] = [];
  const held = new HeldControls(
    (bits) => sent.push(bits),
    () => now,
  );
  held.setTouch("finger", LEFT);
  now = 199;
  held.update();
  assert.equal(sent.at(-1), LEFT);
  now = 200;
  held.update();
  assert.equal(sent.at(-1), LEFT | CARVE);
  now = 211;
  held.update();
  assert.equal(sent.at(-1), LEFT);
  now = 400;
  held.update();
  assert.equal(sent.at(-1), LEFT | CARVE);
  held.setTouch("finger", 0);
  assert.equal(sent.at(-1), 0);
  now = 800;
  held.update();
  assert.equal(sent.at(-1), 0);
});

test("keyboard walking does not gain automatic carving, and hidden controls stop touch repeats", () => {
  let now = 0;
  const sent: number[] = [];
  const held = new HeldControls(
    (bits) => sent.push(bits),
    () => now,
  );
  held.set("KeyA", LEFT);
  now = 500;
  held.update();
  assert.equal(sent.at(-1), LEFT);
  held.setTouch("finger", LEFT);
  held.update(false);
  assert.equal(sent.at(-1), LEFT);
  held.release();
  now = 1000;
  held.update();
  assert.equal(sent.at(-1), 0);
});

test("keyboard exposes native rope press, manual carving and five selectable slots", () => {
  assert.equal(KEY_BITS.KeyR, ROPE);
  assert.equal(KEY_BITS.KeyQ, PREV);
  assert.equal(KEY_BITS.KeyE, NEXT);
  assert.equal(KEY_BITS.KeyG, CARVE);
  assert.equal(KEY_BITS.Digit1, SLOT1);
  assert.equal(KEY_BITS.Digit5, SLOT5);
});
