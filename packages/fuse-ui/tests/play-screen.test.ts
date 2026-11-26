import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boxInStage,
  createPlayScreen,
  fitPlayViewport,
  isTurned,
  pointInBox,
  playModeFor,
  type PlayMode,
  type PlayScreenDevice,
} from "fuse-ui";
import { page } from "./dom-fixture.js";

test("the board keeps one scale and stays centered in wide and tall stages", () => {
  assert.deepEqual(fitPlayViewport(844, 390, 640, 360), {
    scale: 390 / 360,
    x: (844 - 640 * (390 / 360)) / 2,
    y: 0,
  });
  assert.deepEqual(fitPlayViewport(480, 360, 640, 360), {
    scale: 0.75,
    x: 0,
    y: 45,
  });
  assert.deepEqual(fitPlayViewport(1280, 720, 640, 360), {
    scale: 2,
    x: 0,
    y: 0,
  });
});

function build(wide: boolean, touch = true) {
  const { document } = page();
  const stage = document.createElement("section");
  document.body.append(stage);
  let size = { width: 390, height: 844 };
  const listeners = new Set<() => void>();
  const locks: boolean[] = [];
  const device: PlayScreenDevice = {
    lockLandscape: (lock) => locks.push(lock),
    touch: () => touch,
    size: () => size,
    onResize(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const changes: PlayMode[] = [];
  const screen = createPlayScreen({
    stage,
    wide,
    device,
    onChange: (mode) => changes.push(mode),
  });
  return {
    document,
    stage,
    screen,
    changes,
    listeners,
    locks,
    resize(width: number, height: number) {
      size = { width, height };
      for (const listener of listeners) listener();
    },
  };
}

test("a phone is a touch screen with a short side; anything else keeps its page", () => {
  const upright = { width: 390, height: 844 },
    onSide = { width: 844, height: 390 };
  assert.equal(playModeFor(true, true, true, upright), "turned");
  assert.equal(playModeFor(true, false, true, upright), "phone");
  assert.equal(playModeFor(true, true, true, onSide), "phone");
  assert.equal(playModeFor(false, true, true, upright), "off");
  assert.equal(playModeFor(true, true, false, upright), "off", "a mouse");
  assert.equal(
    playModeFor(true, true, true, { width: 820, height: 1180 }),
    "off",
    "a tablet",
  );
});

test("a live round makes the stage the screen, and the end of it gives the page back", () => {
  const { document, stage, screen, changes } = build(false);
  const root = document.documentElement;
  assert.equal(root.dataset.fuiPlay, undefined);
  screen.update(true);
  assert.equal(root.dataset.fuiPlay, "phone");
  assert.ok(stage.classList.contains("fui-play-stage"));
  screen.update(true);
  screen.update(false);
  assert.equal(root.dataset.fuiPlay, undefined);
  assert.ok(!stage.classList.contains("fui-play-stage"));
  assert.deepEqual(changes, ["phone", "off"], "one change per new mode");
});

test("a wide stage is turned on an upright phone and straight once the phone is on its side", () => {
  const { document, screen, changes, locks, resize } = build(true);
  screen.update(true);
  assert.equal(document.documentElement.dataset.fuiPlay, "turned");
  resize(844, 390);
  assert.equal(document.documentElement.dataset.fuiPlay, "phone");
  resize(390, 844);
  assert.deepEqual(changes, ["turned", "phone", "turned"]);
  screen.update(false);
  assert.deepEqual(
    locks,
    [true, true, true, false],
    "held on its side for the round",
  );
});

test("a desktop never enters play mode, and destroy lets go of the device", () => {
  const desktop = build(true, false);
  desktop.screen.update(true);
  assert.equal(desktop.screen.mode(), "off");
  assert.equal(desktop.document.documentElement.dataset.fuiPlay, undefined);

  const phone = build(true);
  phone.screen.update(true);
  phone.screen.destroy();
  assert.equal(phone.listeners.size, 0);
  assert.equal(phone.document.documentElement.dataset.fuiPlay, undefined);
});

test("a pointer is read along the element's own axes when its stage is turned", () => {
  // On the screen the turned pad is 100 wide and 200 tall: its own box is 200 by 100.
  const box = { left: 50, top: 300, width: 100, height: 200 };
  assert.deepEqual(pointInBox(box, 60, 320, false), {
    x: 10,
    y: 20,
    width: 100,
    height: 200,
  });
  // The pad's own left edge is the top of its screen box, its own top edge the right of it.
  assert.deepEqual(pointInBox(box, 140, 320, true), {
    x: 20,
    y: 10,
    width: 200,
    height: 100,
  });
});

test("only elements inside the stage are turned, and only while it is", () => {
  const { document, stage, screen, resize } = build(true);
  const pad = document.createElement("div"),
    outside = document.createElement("div");
  stage.append(pad);
  document.body.append(outside);
  assert.equal(isTurned(pad), false);
  screen.update(true);
  assert.equal(isTurned(pad), true);
  assert.equal(isTurned(outside), false);
  resize(844, 390);
  assert.equal(isTurned(pad), false, "straight again on its side");
});

test("a box on the screen is read in the turned stage's frame", () => {
  const box = { left: 300, top: 40, right: 380, bottom: 200 };
  assert.deepEqual(boxInStage(box, false, 390), box);
  // At the screen's right edge, near its top: the stage's top left.
  assert.deepEqual(boxInStage(box, true, 390), {
    left: 40,
    right: 200,
    top: 10,
    bottom: 90,
  });
});
