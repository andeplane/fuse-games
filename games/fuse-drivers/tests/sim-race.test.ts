import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  getOffroadCourse,
  OFFROAD_COURSE_NAMES,
} from "../src/game/offroad/course.js";
import { BASE_STATS } from "../src/game/sim/config.js";
import { NEUTRAL_INPUT } from "../src/game/sim/input.js";
import { createRace, step } from "../src/game/sim/race.js";

// Digests from the original 8086 game.exe (a67ba31b021ed53d2d033cbe67ecb32a4537bf20593392bcf4ba85d3fd67836c).
// Run its actor VM and occupancy update once per frame, seed zero. Record active trucks from grid setup through
// the first four-lap finish; leave out the marshal's post-race animation. Each course variant appears once.
// -1 is the opener with the recorded human pedal, steering and nitro inputs below.
const references = [
  [
    0,
    3,
    1679,
    "f826e59a47bc4ba432c867767ec03993cb2fb4d24976c209ba974a6cb263be99",
  ],
  [
    1,
    6,
    1769,
    "0956101a7e7f4e5323c617816f944508e379bd25f6449bb779444e3c7467d58e",
  ],
  [
    2,
    11,
    1604,
    "c9cf6d64dceb2186da0aa47a89d368d3d7d60cb3c54fa918a881e5b7b901daa1",
  ],
  [
    3,
    14,
    1807,
    "b1817db3754a7393b9d1c993cf2b1ee02ecd6347f18efda30d3b703d85fca51f",
  ],
  [
    4,
    9,
    1918,
    "ed4c43b23071db145cc9bcccf41f09299af44627353c9c67b9b019a9a895404d",
  ],
  [
    7,
    1,
    1964,
    "c9ce86457faff4c796cdb0314c3a3f0364f373f14f190da58126d7b235add79f",
  ],
  [
    8,
    5,
    1665,
    "a32a927abdb9ab54854fb82c05c47b15ebe98268eabaccf5c6955f5e8d6e2b00",
  ],
  [
    12,
    13,
    1657,
    "c1fb5572a70b6ed9d9422fe41366ce8918fc280c2109b64f804e83c3c5b21b7d",
  ],
  [
    13,
    15,
    1443,
    "a5021d7a41238ab529457d0d884b050da25618bca7f922ba7e399faa43c11f4d",
  ],
  [
    18,
    7,
    1398,
    "4f68bd2d2e2b5dd3447fe7ab8dd309bb6e338b021299c4594b6a6c3e248b6efb",
  ],
  [
    19,
    4,
    1501,
    "b8f1e5543cb54ae2390dafa6612bd217bf82b61b2757d3fd4ea379b4743a3fe6",
  ],
  [
    25,
    12,
    1406,
    "6f12d61fc42bcc64404348cc3a55e0ce80f6300edc4af81d7979197af6e067b9",
  ],
  [
    26,
    8,
    1560,
    "95ddda8b88552a64ba28a9ad2fe482289b6136d62459fe08a0e7ee0cb6202d93",
  ],
  [
    33,
    0,
    1252,
    "ff7d95f6a58b5f5a606511288f7d51dcb97a46b8850fe37aa5576df4a1f34295",
  ],
  [
    34,
    2,
    1425,
    "0ab7cd0cd8382aa9f7f5410660a5f64e82363471b910abacf2d8bccfc69f5723",
  ],
  [
    42,
    10,
    1254,
    "6bf224f82723acc25c1a69ffea21f88be1088ebdebe1261207b91d5bbaf88498",
  ],
  [
    -1,
    3,
    1626,
    "05e2d3ed94f022aa3cd047194bd5679e1cfba48b9ec82fdb5b543cf87edc988d",
  ],
] as const;
const humanInputs = new Map([
  [1, 0],
  [40, 8],
  [50, 9],
  [61, 8],
  [67, 72],
  [82, 8],
  [90, 10],
  [103, 8],
  [110, 0],
  [130, 9],
  [170, 8],
  [210, 10],
  [230, 0],
]);
for (const [stage, variant, finish, digest] of references) {
  test(`DOS race replay matches every truck through the finish: stage ${stage}, variant ${variant}`, () => {
    const track = getOffroadCourse(OFFROAD_COURSE_NAMES[variant]!).track;
    const bots = [stage >= 0, true, true, true];
    let race = createRace(
      track,
      0,
      Array.from({ length: 4 }, () => BASE_STATS),
      bots,
      Math.max(0, stage),
    );
    const hash = createHash("sha256");
    let bits = 0;
    for (let tick = 1; tick <= finish; tick++) {
      bits = humanInputs.get(tick) ?? bits;
      const human = {
        ...NEUTRAL_INPUT,
        gas: !!(bits & 8),
        right: !!(bits & 1),
        left: !!(bits & 2),
        nitro: !!(bits & 64),
      };
      race = step(race, stage < 0 ? [human] : [], track, bots).state;
      assert.equal(race.tick, tick);
      const trucks = race.trucks.map((t) => {
        const m = t.motion;
        const cashBcd = (Math.floor(t.cash / 10) << 4) | (t.cash % 10);
        return [
          m.x,
          m.y,
          m.heading,
          m.momentum,
          m.speed,
          t.laps,
          t.checkpoint,
          m.nitros,
          cashBcd,
        ];
      });
      hash.update(JSON.stringify([tick, ...trucks]) + "\n");
    }
    assert.equal(hash.digest("hex"), digest);
    assert.equal(race.phase, "finished");
    assert.equal(race.raceEndTick, finish);
    assert.equal(step(race, [], track, bots).state, race);
  });
}
