import assert from "node:assert/strict";
import { test } from "node:test";
import { cameraFor } from "../src/app/camera.js";
import {
  createWorld,
  DEFAULT_SETTINGS,
  WIDTH,
  HEIGHT,
} from "../src/engine/index.js";

const world = () =>
  createWorld(
    913,
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 1 },
    ],
    DEFAULT_SETTINGS,
  );
test("individual cameras track the corresponding player without changing authoritative state", () => {
  const state = world();
  Object.assign(state.worms[0]!, { x: 620, y: 420, aim: 0 });
  Object.assign(state.worms[1]!, { x: 1120, y: 600, aim: 16 });
  const before = structuredClone(state);
  const a = cameraFor(state, "a", false),
    b = cameraFor(state, "b", false);
  assert.equal(a.overview, false);
  assert.equal(a.width, 640);
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
  Object.assign(worm, { x: WIDTH / 2, y: HEIGHT / 2, health: 0, respawn: 60 });
  const phone = cameraFor(state, "a", true);
  assert.equal(phone.width, 384);
  assert.equal(phone.height, 288);
  assert.equal(phone.overview, false);
  Object.assign(worm, { x: WIDTH - 60, y: 60, health: 100, respawn: 0 });
  const respawned = cameraFor(state, "a", true);
  assert.notEqual(respawned.x, phone.x);
  assert.ok(worm.x >= respawned.x && worm.x < respawned.x + respawned.width);
});
