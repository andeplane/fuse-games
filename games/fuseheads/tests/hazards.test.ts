import assert from "node:assert/strict";
import test from "node:test";
import { getLevel } from "../src/levels/index.js";
import { createWorld } from "../src/game/simulation.js";
import {
  blastBat,
  hazardDelay,
  stepHazards,
  validHazards,
} from "../src/game/hazards.js";

test("hazards use the level's frequency and only the bat responds to TNT", () => {
  const world = createWorld(0, [0], 3);
  const level = { ...getLevel(1), batFrequency: 50, tireFrequency: 50 };
  const step = () =>
    stepHazards(
      world,
      level,
      () => {},
      () => false,
      () => 8,
    );
  for (let i = 0; i < hazardDelay(50); i++) step();
  assert.equal(world.hazards.bat, null);
  assert.equal(world.hazards.tire, null);
  step();
  assert.ok(world.hazards.bat);
  assert.ok(world.hazards.tire);
  assert.ok(validHazards(world.hazards));
  const tire = world.hazards.tire;
  blastBat(world.hazards);
  assert.equal(world.hazards.bat, null);
  assert.equal(world.hazards.tire, tire);
});
test("a tire bounces off a platform, then passes that platform on the way down", () => {
  const world = createWorld(0, [0], 3);
  const level = getLevel(1);
  world.hazards.tire = { x: 80, y: 25, vx: 2, vy: 8, lastRow: -3 };
  const step = () =>
    stepHazards(
      world,
      level,
      () => {},
      (_col, row) => row === 5,
      () => 0,
    );
  step();
  assert.equal(world.hazards.tire.vy, -6);
  assert.equal(world.hazards.tire.lastRow, 5);
  for (let tick = 0; tick < 30; tick++) step();
  assert.ok(world.hazards.tire.y > 80);
  assert.equal(validHazards({ ...world.hazards, batClock: Infinity }), false);
});
