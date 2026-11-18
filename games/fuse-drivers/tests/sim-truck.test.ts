import { test } from "node:test";
import assert from "node:assert/strict";
import { getOffroadCourse } from "../src/game/offroad/course.js";
import { createOffroadDriver } from "../src/game/offroad/campaign.js";
import { BASE_STATS } from "../src/game/sim/config.js";
import { NEUTRAL_INPUT } from "../src/game/sim/input.js";
import { createRace, step } from "../src/game/sim/race.js";

const track = getOffroadCourse("offroad-4").track;
test("a released pedal leaves the human truck at rest through green; holding it builds throttle and momentum", () => {
  let race = createRace(track, 0);
  const before = race.trucks[0]!.motion;
  for (let i = 0; i < 50; i++) race = step(race, [NEUTRAL_INPUT], track).state;
  assert.equal(race.phase, "racing");
  assert.deepEqual(race.trucks[0]!.motion, before);
  for (let i = 0; i < 8; i++)
    race = step(race, [{ ...NEUTRAL_INPUT, gas: true }], track).state;
  assert.equal(race.trucks[0]!.motion.throttle, 256);
  assert.equal(race.trucks[0]!.motion.speed, 134);
  assert.ok(race.trucks[0]!.motion.x > before.x);
  const coast = step(race, [NEUTRAL_INPUT], track).state;
  assert.equal(coast.trucks[0]!.motion.throttle, 240);
  assert.equal(race.trucks[0]!.motion.throttle, 256);
});
test("the campaign grid carries nitro stock, tires, shocks and engine speed into the real truck", () => {
  const driver = {
    ...createOffroadDriver(),
    nitros: 7,
    tires: 5 as const,
    shocks: 5 as const,
    topSpeed: 5 as const,
  };
  let race = createRace(track, 0, [BASE_STATS], [false], 0, [driver]);
  assert.equal(race.trucks[0]!.nitros, 7);
  for (let i = 0; i < 48; i++)
    race = step(race, [{ ...NEUTRAL_INPUT, gas: true }], track).state;
  const truck = race.trucks[0]!;
  assert.equal(truck.motion.speed, 154);
  const next = step(
    race,
    [{ ...NEUTRAL_INPUT, gas: true, right: true, nitro: true }],
    track,
  ).state.trucks[0]!;
  assert.equal(next.motion.heading - truck.motion.heading, 2176);
  assert.equal(next.nitros, 6);
  assert.deepEqual(next.upgrades, { topSpeed: 5, tires: 5, shocks: 5 });
});
