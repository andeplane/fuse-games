import test from "node:test";
import assert from "node:assert/strict";
import { KEY } from "../src/game/canal.js";
import { radarProjection } from "../src/app/radar.js";
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
    s.read(bit | KEY.up);
    assert.equal(s.read(KEY.up, bit), KEY.up);
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
