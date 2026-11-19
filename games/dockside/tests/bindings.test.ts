import test from "node:test";
import assert from "node:assert/strict";
import { KEY } from "../src/game/canal.js";
import { radarProjection } from "../src/app/radar.js";
import { tacticalMapControls } from "../src/app/map-controls.js";
import {
  CAMERA,
  MAP,
  standardPadBits,
  shoulderControls,
} from "../src/app/bindings.js";

test("the standard gamepad keeps the original four positional face buttons, shoulders, view, map and D-pad", () => {
  const expected = [
    KEY.missile,
    KEY.special,
    KEY.fire,
    KEY.jump,
    KEY.modifier,
    KEY.lock,
    KEY.jinkLeft,
    KEY.jinkRight,
    CAMERA,
    MAP,
    0,
    0,
    KEY.up,
    KEY.down,
    KEY.left,
    KEY.right,
  ];
  for (const [index, bit] of expected.entries()) {
    const buttons = expected.map((_, i) => ({
      pressed: i === index,
      touched: i === index,
      value: i === index ? 1 : 0,
    }));
    assert.equal(
      standardPadBits({ mapping: "standard", buttons, axes: [0, 0] }),
      bit,
    );
    assert.equal(standardPadBits({ mapping: "", buttons, axes: [0, 0] }), 0);
  }
  assert.equal(
    standardPadBits({ mapping: "standard", buttons: [], axes: [-1, -1] }),
    KEY.left | KEY.up,
  );
});
test("staggered shoulder chords transform without buying or targeting; plain shoulder taps still dispatch", () => {
  for (const [first, second] of [
    [KEY.lock, KEY.modifier],
    [KEY.modifier, KEY.lock],
  ] as const) {
    const s = shoulderControls();
    assert.equal(s.read(first), first === KEY.modifier ? KEY.modifier : 0);
    assert.equal(s.read(first | second), KEY.shift);
    assert.equal(s.read(second), 0);
    assert.equal(s.read(0), 0);
    s.read(KEY.modifier);
    assert.equal(s.read(0), KEY.launch);
    s.read(KEY.lock);
    assert.equal(s.read(0), KEY.lock);
    s.read(KEY.modifier | KEY.jump);
    s.read(KEY.modifier);
    assert.equal(s.read(0), 0);
    s.read(KEY.modifier);
    s.clear();
    assert.equal(s.read(0), 0);
  }
});
test("cancelling either shoulder releases its hold without committing the tap or releasing another input source", () => {
  for (const bit of [KEY.modifier, KEY.lock]) {
    const s = shoulderControls();
    s.read(bit | KEY.fire);
    assert.equal(s.read(KEY.fire, bit), KEY.fire);
    s.read(bit);
    s.read(bit, bit);
    assert.equal(s.read(0), bit === KEY.modifier ? KEY.launch : KEY.lock);
  }
});
test("local radar follows each pilot; expanded map frames the entire unchanged arena", () => {
  for (const pilot of [
    { x: -2700, z: 600 },
    { x: 2700, z: -900 },
  ]) {
    const radar = radarProjection(pilot, false),
      map = radarProjection(pilot, true);
    assert.deepEqual([radar.x(pilot.x), radar.z(pilot.z)], [180, 110]);
    assert.ok(
      radar.x(pilot.x + 1000) - radar.x(pilot.x) > map.x(1000) - map.x(0),
    );
    assert.deepEqual(
      [map.x(-3600), map.x(3600), map.z(-2200), map.z(2200)],
      [0, 360, 0, 220],
    );
  }
});
test("map navigation, recenter and held inputs crossing both modal boundaries stay local", () => {
  const map = tacticalMapControls(),
    pilot = { x: -2700, z: 0 };
  assert.equal(map.read(KEY.up), KEY.up);
  assert.equal(map.read(KEY.up | MAP), 0);
  assert.equal(map.read(KEY.up), 0);
  assert.equal(map.frame(pilot, 12), undefined);
  map.read(0);
  assert.equal(map.read(KEY.right | KEY.fire), 0);
  assert.deepEqual(map.frame(pilot, 13), { x: 80, z: 0 });
  map.read(0);
  assert.equal(map.read(KEY.modifier), 0);
  assert.deepEqual(map.frame(pilot, 14), pilot);
  assert.equal(map.read(KEY.modifier | KEY.fire | MAP), 0);
  assert.equal(map.open, false);
  assert.equal(map.read(KEY.modifier | KEY.fire), 0);
  assert.equal(map.read(0), 0);
  assert.equal(map.read(KEY.fire), KEY.fire);
});
test("a new match starts with a collapsed radar and held map buttons require a fresh press", () => {
  const map = tacticalMapControls();
  map.read(MAP);
  assert.ok(map.open);
  map.read(MAP | KEY.right);
  map.frame({ x: 0, z: 0 }, 10);
  map.reset();
  assert.equal(map.open, false);
  assert.equal(map.read(MAP | KEY.right), 0);
  assert.equal(map.open, false);
  map.read(0);
  map.read(MAP);
  assert.equal(map.open, true);
  assert.equal(map.frame({ x: 0, z: 0 }, 1), undefined);
});
