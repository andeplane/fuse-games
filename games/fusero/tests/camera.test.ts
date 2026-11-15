import assert from "node:assert/strict";
import { test } from "node:test";
import { cameraFor } from "../src/app/camera.js";
const WIDTH = 1536,
  HEIGHT = 864;
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
  Object.assign(state.worms[0]!, { x: 620, y: 420, aim: 0 });
  Object.assign(state.worms[1]!, { x: 1120, y: 600, aim: 0, facing: -1 });
  const before = structuredClone(state);
  const a = cameraFor(state, "a", false),
    b = cameraFor(state, "b", false);
  assert.equal(a.overview, false);
  assert.equal(a.width, 320);
  assert.notEqual(a.x, b.x);
  state.worms[0]!.x += 100;
  assert.equal(cameraFor(state, "a", false).x - a.x, 100);
  state.worms[0]!.x -= 100;
  assert.deepEqual(state, before);
});
test("follow cameras clamp at all world edges and keep the worm inside the viewport", () => {
  const state = world(),
    worm = state.worms[0]!;
  for (const narrow of [false, true])
    for (const [x, y] of [
      [12, 12],
      [WIDTH - 12, 12],
      [12, HEIGHT - 12],
      [WIDTH - 12, HEIGHT - 12],
    ]) {
      Object.assign(worm, { x, y });
      const camera = cameraFor(state, "a", narrow);
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
    for (const narrow of [true, false])
      assert.deepEqual(cameraFor(world(), self, narrow), {
        x: 0,
        y: 0,
        width: WIDTH,
        height: HEIGHT,
        overview: true,
      });
});
test("phone cameras show a closer view and keep following through death and respawn", () => {
  const state = world(),
    worm = state.worms[0]!;
  Object.assign(worm, {
    x: WIDTH / 2,
    y: HEIGHT / 2,
    health: -1,
    alive: false,
    respawnAtMs: 2500,
  });
  const phone = cameraFor(state, "a", true);
  assert.equal(phone.width, 192);
  assert.equal(phone.height, 144);
  assert.equal(phone.overview, false);
  Object.assign(worm, {
    x: WIDTH - 60,
    y: 60,
    health: 100,
    alive: true,
    respawnAtMs: null,
  });
  const respawned = cameraFor(state, "a", true);
  assert.notEqual(respawned.x, phone.x);
  assert.ok(worm.x >= respawned.x && worm.x < respawned.x + respawned.width);
});

test("native follow camera stays centred independently of aim, facing and velocity", () => {
  const state = world(),
    worm = state.worms[0]!;
  Object.assign(worm, { x: 700, y: 400, aim: 0, facing: 1 });
  const right = cameraFor(state, "a", false);
  Object.assign(worm, { facing: -1 });
  const left = cameraFor(state, "a", false);
  Object.assign(worm, { aim: -90 });
  const up = cameraFor(state, "a", false);
  assert.deepEqual(left, right);
  assert.deepEqual(up, right);
  Object.assign(worm, { vx: 200 });
  assert.deepEqual(cameraFor(state, "a", false), right);
});

test("a map smaller than the preferred viewport stays wholly within its bounds", () => {
  const state = world();
  state.terrain = { width: 200, height: 120 };
  Object.assign(state.worms[0]!, { x: 100, y: 60 });
  assert.deepEqual(cameraFor(state, "a", false), {
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    overview: false,
  });
});

test("the original 504×350 DirtLevel scrolls at the native two-times display scale", () => {
  const state = world();
  state.terrain = { width: 504, height: 350 };
  Object.assign(state.worms[0]!, { x: 252, y: 175 });
  assert.deepEqual(cameraFor(state, "a", false), {
    x: 92,
    y: 85,
    width: 320,
    height: 180,
    overview: false,
  });
  assert.deepEqual(cameraFor(state, "display", false), {
    x: 0,
    y: 0,
    width: 504,
    height: 350,
    overview: true,
  });
});

test("native touch camera keeps the worm centred at an edge and leaves off-map background visible", () => {
  const state = world();
  state.terrain = { width: 504, height: 350 };
  Object.assign(state.worms[0]!, { x: 10, y: 12 });
  assert.deepEqual(cameraFor(state, "a", true, true), {
    x: -86,
    y: -60,
    width: 192,
    height: 144,
    overview: false,
  });
  assert.deepEqual(cameraFor(state, "display", true, true), {
    x: 0,
    y: 0,
    width: 504,
    height: 350,
    overview: true,
  });
});
