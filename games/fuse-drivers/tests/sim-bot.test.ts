import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getOffroadCourse,
  OFFROAD_COURSE_NAMES,
} from "../src/game/offroad/course.js";
import { BASE_STATS } from "../src/game/sim/config.js";
import { createRace, step } from "../src/game/sim/race.js";

test("all five Fuse slots race with the native CPU and wheel contacts on every circuit", () => {
  const bots = [true, true, true, true, true];
  for (const name of OFFROAD_COURSE_NAMES) {
    const track = getOffroadCourse(name).track;
    let race = createRace(
      track,
      1234,
      Array.from({ length: 5 }, () => BASE_STATS),
      bots,
    );
    while (race.phase !== "finished" && race.tick < 4000)
      race = step(race, [], track, bots).state;
    assert.equal(race.phase, "finished", name);
    assert.equal(new Set(race.placements).size, 5);
    assert.ok(
      race.trucks.every((t) => t.cpu && t.laps >= 2),
      name,
    );
    assert.equal(race.trucks[race.placements[0]!]!.laps, 4);
  }
});
