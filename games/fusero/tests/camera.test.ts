import assert from "node:assert/strict";
import { test } from "node:test";
import { cameraFor } from "../src/app/camera.js";

const WIDTH = 1536,
  HEIGHT = 864;
const desktop = { width: 1280, height: 720 },
  phone = { width: 393, height: 852 };
const world = () => ({
  terrain: { width: WIDTH, height: HEIGHT },
  worms: [
    {
      id: "a",
      x: 120,
      y: 200,
      vx: 0,
      aim: 0,
      facing: 1 as const,
      health: 100,
      alive: true,
      respawnAtMs: null as number | null,
    },
    {
      id: "b",
      x: 1100,
      y: 600,
      vx: 0,
      aim: 0,
      facing: -1 as const,
      health: 100,
      alive: true,
      respawnAtMs: null as number | null,
    },
  ],
});

test("individual cameras track the corresponding player without changing authoritative state", () => {
  const state = world();
  Object.assign(state.worms[0]!, { x: 620, y: 420 });
  Object.assign(state.worms[1]!, { x: 1120, y: 600 });
  const before = structuredClone(state);
  const a = cameraFor(state, "a", desktop),
    b = cameraFor(state, "b", desktop);
  assert.equal(a.overview, false);
  assert.equal(a.width, 427);
  assert.notEqual(a.x, b.x);
  state.worms[0]!.x += 100;
  assert.equal(cameraFor(state, "a", desktop).x - a.x, 100);
  state.worms[0]!.x -= 100;
  assert.deepEqual(state, before);
});

test("native local view uses fixed 480 logical height and is independent of display resolution", () => {
  const state = world(),
    low = cameraFor(state, "a", desktop);
  assert.deepEqual(cameraFor(state, "a", { width: 1920, height: 1080 }), low);
  assert.equal(low.width, 427);
  assert.equal(low.height, 240);
  assert.equal(cameraFor(state, "a", { width: 640, height: 480 }).width, 320);
  assert.equal(cameraFor(state, "a", { width: 1610, height: 900 }).width, 430);
});

test("native portrait local view keeps its logical minimum width and full world height", () => {
  const camera = cameraFor(world(), "a", phone);
  assert.equal(camera.width, 160);
  assert.equal(camera.height, 240);
});

test("native network play keeps the same fair 320 by 240 world view on every display", () => {
  const state = world(),
    expected = cameraFor(state, "a", desktop, { wideScreen: false });
  assert.equal(expected.width, 320);
  assert.equal(expected.height, 240);
  for (const viewport of [
    phone,
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
  ])
    assert.deepEqual(
      cameraFor(state, "a", viewport, { wideScreen: false }),
      expected,
    );
});

test("follow cameras clamp at all world edges and keep the worm inside the viewport", () => {
  const state = world(),
    worm = state.worms[0]!;
  for (const viewport of [desktop, phone])
    for (const [x, y] of [
      [12, 12],
      [WIDTH - 12, 12],
      [12, HEIGHT - 12],
      [WIDTH - 12, HEIGHT - 12],
    ]) {
      Object.assign(worm, { x, y });
      const camera = cameraFor(state, "a", viewport);
      assert.ok(camera.x >= 0 && camera.y >= 0);
      assert.ok(
        camera.x + camera.width <= WIDTH && camera.y + camera.height <= HEIGHT,
      );
      assert.ok(worm.x >= camera.x && worm.x < camera.x + camera.width);
      assert.ok(worm.y >= camera.y && worm.y < camera.y + camera.height);
    }
});

test("shared displays and unseated spectators retain the full-world overview", () => {
  for (const self of ["", "display-member", "spectator"])
    for (const viewport of [desktop, phone])
      assert.deepEqual(cameraFor(world(), self, viewport), {
        x: 0,
        y: 0,
        width: WIDTH,
        height: HEIGHT,
        overview: true,
      });
});

test("follow camera retains its player through death and respawn", () => {
  const state = world(),
    worm = state.worms[0]!;
  Object.assign(worm, {
    x: WIDTH / 2,
    y: HEIGHT / 2,
    health: -1,
    alive: false,
    respawnAtMs: 2500,
  });
  const dead = cameraFor(state, "a", phone);
  assert.equal(dead.overview, false);
  Object.assign(worm, {
    x: WIDTH - 60,
    y: 60,
    health: 100,
    alive: true,
    respawnAtMs: null,
  });
  const respawned = cameraFor(state, "a", phone);
  assert.notEqual(respawned.x, dead.x);
  assert.ok(worm.x >= respawned.x && worm.x < respawned.x + respawned.width);
});

test("native follow camera stays centred independently of aim, facing and velocity", () => {
  const state = world(),
    worm = state.worms[0]!;
  Object.assign(worm, { x: 700, y: 400, aim: 0, facing: 1 });
  const before = cameraFor(state, "a", desktop);
  assert.equal(
    before.x,
    487,
    "native integer half-width is 213 for a 427-wide view",
  );
  for (const change of [{ facing: -1 }, { aim: -90 }, { vx: 200 }]) {
    Object.assign(worm, change);
    assert.deepEqual(cameraFor(state, "a", desktop), before);
  }
});

test("native viewport dimensions stay fixed on a smaller map while its origin clamps to zero", () => {
  const state = world();
  state.terrain = { width: 200, height: 120 };
  Object.assign(state.worms[0]!, { x: 100, y: 60 });
  assert.deepEqual(cameraFor(state, "a", desktop), {
    x: 0,
    y: 0,
    width: 427,
    height: 240,
    overview: false,
  });
});

test("the native DirtLevel scrolls with the full native height rather than a 180-world-pixel crop", () => {
  const state = world();
  state.terrain = { width: 504, height: 350 };
  Object.assign(state.worms[0]!, { x: 252, y: 175 });
  assert.deepEqual(cameraFor(state, "a", desktop), {
    x: 39,
    y: 55,
    width: 427,
    height: 240,
    overview: false,
  });
  assert.deepEqual(cameraFor(state, "a", desktop, { wideScreen: false }), {
    x: 92,
    y: 55,
    width: 320,
    height: 240,
    overview: false,
  });
});

test("native touch camera keeps a spawned worm centred at an edge with off-map background", () => {
  const state = world();
  state.terrain = { width: 504, height: 350 };
  Object.assign(state.worms[0]!, { x: 10, y: 12 });
  assert.deepEqual(cameraFor(state, "a", phone, { touchControls: true }), {
    x: -70,
    y: -108,
    width: 160,
    height: 240,
    overview: false,
  });
});

test("native touch camera centres the map before its player has spawned", () => {
  const state = world();
  state.terrain = { width: 504, height: 350 };
  Object.assign(state.worms[0]!, { x: 0, y: 0, spawnedOnce: false });
  assert.deepEqual(cameraFor(state, "a", phone, { touchControls: true }), {
    x: 172,
    y: 55,
    width: 160,
    height: 240,
    overview: false,
  });
});

test("a temporarily unavailable browser size falls back to the native 640 by 480 logical display", () => {
  for (const viewport of [
    { width: 0, height: 0 },
    { width: NaN, height: 720 },
    { width: 1280, height: Infinity },
  ]) {
    const camera = cameraFor(world(), "a", viewport);
    assert.equal(camera.width, 320);
    assert.equal(camera.height, 240);
  }
});
