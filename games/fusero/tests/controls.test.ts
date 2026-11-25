import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HeldControls,
  KEY_BITS,
  keyboardBindings,
  keyboardPreset,
} from "../src/app/controls.js";
import {
  LEFT,
  RIGHT,
  UP,
  DOWN,
  JUMP,
  FIRE,
  ROPE,
  PREV,
  NEXT,
  CARVE,
  SLOT1,
  SLOT5,
  SELECT_MOD,
  STRAFE,
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

test("PC keyboard uses the native primary player's actual defaults, without conflicting WASD aliases", () => {
  assert.equal(KEY_BITS, keyboardBindings("pc"));
  assert.equal(KEY_BITS.Space, undefined, "Space is not native PC jump");
  assert.equal(
    KEY_BITS.KeyC,
    undefined,
    "keyboard carving uses direction chords",
  );
  assert.equal(KEY_BITS.KeyF, undefined, "F was an invented fire binding");
  assert.deepEqual(KEY_BITS, {
    ArrowLeft: LEFT,
    ArrowRight: RIGHT,
    ArrowUp: UP,
    ArrowDown: DOWN,
    KeyX: ROPE,
    KeyA: PREV,
    KeyS: NEXT,
    Digit1: SLOT1,
    Digit2: SLOT1 << 1,
    Digit3: SLOT1 << 2,
    Digit4: SLOT1 << 3,
    Digit5: SLOT5,
    ControlLeft: FIRE,
    AltLeft: JUMP,
    KeyZ: STRAFE,
    ShiftLeft: SELECT_MOD,
  });
});

test("the default avoids the macOS Control shortcut and honors saved presets", () => {
  const mac = keyboardPreset(null, "MacIntel");
  assert.equal(mac, "mac");
  assert.equal(keyboardBindings(mac).ControlLeft, undefined);
  assert.equal(keyboardPreset(null, "Win32"), "pc");
  assert.equal(keyboardPreset("pc", "MacIntel"), "pc");
  assert.equal(keyboardPreset("mac", "Win32"), "mac");
});

test("Apple keyboard uses the upstream Apple overrides, including Space for weapon selection", () => {
  const keys = keyboardBindings("mac");
  assert.equal(keys.AltLeft, FIRE);
  assert.equal(keys.MetaLeft, JUMP);
  assert.equal(keys.Space, SELECT_MOD);
  assert.equal(keys.KeyC, STRAFE);
  assert.equal(keys.KeyX, ROPE);
  assert.equal(keys.KeyA, PREV);
  assert.equal(keys.KeyS, NEXT);
  assert.equal(keys.ArrowLeft, LEFT);
  assert.equal(keys.ArrowUp, UP);
  assert.equal(keys.ControlLeft, undefined);
  assert.equal(keys.ShiftLeft, undefined);
});

test("native modifier chords combine normal input sources without inventing manual-carve keys", () => {
  const sent: number[] = [];
  const held = new HeldControls(
    (bits) => sent.push(bits),
    () => 0,
  );
  const keys = keyboardBindings("pc");
  held.set("ShiftLeft", keys.ShiftLeft!);
  held.set("ArrowRight", keys.ArrowRight!);
  assert.equal(sent.at(-1), SELECT_MOD | RIGHT);
  held.release();
  held.set("ArrowLeft", keys.ArrowLeft!);
  held.set("ArrowRight", keys.ArrowRight!);
  assert.equal(
    sent.at(-1),
    LEFT | RIGHT,
    "native keyboard digging is the opposite-direction chord",
  );
});
