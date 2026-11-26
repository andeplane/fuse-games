import assert from "node:assert/strict";
import test from "node:test";
import {
  cameraPanels,
  frameCamera,
  TILE_H,
  TILE_W,
} from "../src/render/camera.js";

const map = { width: 64, height: 64 };
const first = { x: 400, y: 300 };
const two = (dx: number, dy: number) => [
  first,
  { x: first.x + dx, y: first.y + dy },
];

test("a phone closes in on its lone operative while keeping nearby paths visible", () => {
  for (const [width, height] of [
    [360, 800],
    [844, 390],
  ] as const) {
    const [phone] = cameraPanels([first], width, height, true);
    const [desktop] = cameraPanels([first], width, height);
    const camera = frameCamera(map, [first], width, height, phone!.localZoom);
    assert.ok(camera.zoom > desktop!.localZoom);
    assert.ok(camera.width >= 8 * TILE_W);
    assert.ok(camera.height >= 12 * TILE_H);
    assert.equal(camera.left + camera.width / 2, first.x);
    assert.equal(camera.top + camera.height / 2, first.y - 5);
    assert.deepEqual(
      cameraPanels(two(380, 205), width, height, true),
      cameraPanels(two(380, 205), width, height),
    );
  }
});

test("DOS split is strict at 300 horizontal or 180 vertical world pixels", () => {
  assert.equal(cameraPanels(two(299, 179), 1280, 720).length, 1);
  assert.equal(cameraPanels(two(300, 0), 1280, 720).length, 2);
  assert.equal(cameraPanels(two(0, 180), 1280, 720).length, 2);
  assert.equal(cameraPanels(two(-300, -179), 1280, 720).length, 2);
});

test("distant DOS seats get ordered half-screens at the same scale as local play", () => {
  const party = two(380, 205);
  const [left, right] = cameraPanels(party, 844, 390);
  assert.deepEqual(left!.party, [party[0]]);
  assert.deepEqual(right!.party, [party[1]]);
  assert.equal(left!.x, 0);
  assert.equal(right!.x + right!.width, 844);
  assert.ok(left!.x + left!.width < right!.x);
  const solo = frameCamera(map, [first], 844, 390);
  for (const panel of [left!, right!]) {
    const camera = frameCamera(
      map,
      panel.party,
      panel.width,
      panel.height,
      panel.localZoom,
    );
    assert.equal(camera.zoom, solo.zoom);
    assert.equal(camera.left + camera.width / 2, panel.party[0]!.x);
    assert.equal(camera.top + camera.height / 2, panel.party[0]!.y - 5);
  }
});

test("three to six seats share only mutually close viewpoints and use every panel once", () => {
  const a = { x: 100, y: 200 },
    b = { x: 116, y: 204 },
    c = { x: 310, y: 205 },
    d = { x: 510, y: 203 },
    e = { x: 810, y: 400 },
    f = { x: 490, y: 750 };
  for (const n of [3, 4, 5, 6]) {
    const operators = [a, b, c, d, e, f].slice(0, n);
    const panels = cameraPanels(operators, 1440, 810);
    assert.deepEqual(
      panels.flatMap((p) => p.party),
      operators,
    );
    for (const p of panels) {
      assert.ok(p.width > 0 && p.height > 0);
      for (const i of p.party)
        for (const j of p.party)
          assert.ok(Math.abs(i.x - j.x) < 300 && Math.abs(i.y - j.y) < 180);
      for (const q of panels.filter((q) => q !== p))
        assert.ok(
          p.x + p.width <= q.x ||
            q.x + q.width <= p.x ||
            p.y + p.height <= q.y ||
            q.y + q.height <= p.y,
        );
    }
  }
  const isolated = [0, 1, 2, 3, 4].map((i) => ({ x: i * 301, y: i * 181 }));
  assert.equal(cameraPanels(isolated, 1440, 810).length, 5);
  assert.equal(cameraPanels([first], 360, 740).length, 1);
});
