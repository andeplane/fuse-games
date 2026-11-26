import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildTraffic,
  decodeTraffic,
  dodgeTraffic,
  hitTraffic,
  obstacleLateral,
  raceTraffic,
  trafficView,
  type RoadObstacle,
} from "../src/game/traffic.js";
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
test("seeded canyon placements preserve the DOS road-builder's lane records and outgoing RNG state", () => {
  for (const [seed, after, count, hash] of [
    [
      0,
      1666867474,
      17,
      "0dd9ce6295a161d4f4c08f8c93a8df1015de1c05ed5a38bd1933e0ca49eb5b0d",
    ],
    [
      1,
      1666867474,
      17,
      "0dd9ce6295a161d4f4c08f8c93a8df1015de1c05ed5a38bd1933e0ca49eb5b0d",
    ],
    [
      37,
      2158898899,
      16,
      "08cef8ccf2b35d80e3a4974c35ddc69671daa9778d9019444e06b7c3891152e3",
    ],
    [
      3735928559,
      3225524979,
      16,
      "3d0b68117ab375fbaf43f5c33e62c2fad472b6cfcc744ea53f0329c61d186103",
    ],
  ] as const) {
    const state = buildTraffic("canyon", seed);
    assert.equal(state.seedAfter, after);
    assert.equal(state.obstacles.length, count);
    assert.equal(
      digest(state.obstacles.map((o) => [o.segment, o.kind, o.lane])),
      hash,
    );
    const course = raceTraffic("canyon", seed);
    assert.deepEqual(decodeTraffic(course, "canyon", seed), course);
    assert.equal(
      decodeTraffic({ ...course, seedAfter: 0 }, "canyon", seed),
      undefined,
    );
    assert.equal(
      decodeTraffic(
        { ...course, obstacles: course.obstacles.slice(1) },
        "canyon",
        seed,
      ),
      undefined,
    );
    assert.equal(trafficView(course).length, course.obstacles.length);
  }
  for (const route of ["strip", "aqueduct"] as const)
    assert.deepEqual(buildTraffic(route, 37).obstacles, []);
});
test("the original seven-segment rival scan matches 240 DOS calls across speed, position, field and competing-driver cases", () => {
  const rows: number[] = [];
  for (const x of [-900, -250, 0, 500, 950])
    for (const offset of [0, 2, 6, 7])
      for (const kind of ["rock", "left", "right"] as const)
        for (const speed of [50, 51])
          for (const p of [50, 104]) {
            const obstacle: RoadObstacle = {
              kind: kind === "rock" ? "rock" : "bush",
              segment: 100 + offset,
              lane: kind === "left" ? 0 : kind === "right" ? 16 : 6,
            };
            const delta = dodgeTraffic(
              { seedAfter: 0, obstacles: [obstacle] },
              { x, position: 100 * 64 },
              { x: 0, position: p * 64 },
              320,
              speed,
            );
            rows.push(Math.round((delta * 850) / 1000));
          }
  assert.equal(
    digest(rows),
    "e339df3df9df686a166ac621b1b9cbbece977c073c1670818525762a0db5fc8e",
  );
});
test("the lane rendered is the lane hit; clearing it avoids contact, and low-speed debris and rocks have different effects", () => {
  const rock: RoadObstacle = { segment: 101, kind: "rock", lane: 6 };
  const t = { seedAfter: 0, obstacles: [rock] };
  const x = Math.round(obstacleLateral(rock) * 1000);
  const from = 100 * 64 + 63,
    to = 102 * 64 + 2;
  const hit = (at: number, speed: number) => hitTraffic(t, from, to, at, speed);
  assert.equal(hit(x, 31).crashed, true);
  assert.equal(hit(x, 30).crashed, false);
  assert.equal(hit(x + 500, 31).crashed, false);
  t.obstacles = [{ ...rock, kind: "debris" }];
  assert.deepEqual(hit(x + 50, 51), {
    speed: 41,
    crashed: false,
    sideways: 40,
  });
  assert.equal(hit(x, 20).speed, 20);
  assert.equal(hitTraffic(t, to, to + 2, x, 51).speed, 51);
});
