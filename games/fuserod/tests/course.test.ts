import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  courseContact,
  aqueductBank,
  rearEndContact,
  courseFeatures,
  channelStep,
} from "../src/course/index.js";

const expected = {
  strip: "094fa2b70e5dd953482bd01bcf633f401d7bb5cc47509b1869097a3b6065f8d7",
  aqueduct: "f6bd63a12a928b30a475b93dd4b6008ebafec448650bb1656ff4712002a2d220",
  canyon: "bcade4e214b96ddcb9e1adda378fbdaf28d0bd327a0cca7da9303a69869c7df3",
};

test("channel climb and trough crossings match 729 DOS camera and speed updates", () => {
  const rows = [];
  for (let lane = -1000; lane <= 1000; lane += 25) {
    for (const delta of [-180, 0, 180])
      for (const speed of [10, 11, 60]) {
        const step = channelStep(lane - delta, lane, speed);
        rows.push([step.x, step.speed, step.roll]);
      }
  }
  assert.equal(
    createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    "c41c1411b7367caf9094880f16524cb7702f10949ee05b86a6df21e819c728d6",
  );
});

test("authored canyon hazards retain DOS clear, crash and scrape thresholds", () => {
  const expected = {
    bridge: "5964722b645a337eff869063af4e5e0186dbb11339854df2b1a4e650d5dfe6a4",
    rough: "cb1840eaf3ffa955b1c88075b942966b42ed02b8a093d9a274400411e8c1bd86",
    rock: "a7cb6fe8753e9b2469954c261dd4f6576ffa1096de6ffb6fd1802d560ec0fc8f",
    guardrail:
      "2817154fb858d880043bc09596859ff9641c805187b8617bdd9e00f4815e5d50",
  };
  for (const feature of ["bridge", "rough", "rock", "guardrail"] as const) {
    const position = courseFeatures("canyon").find(
      (f) => f.kind === feature,
    )!.start;
    const rows = [];
    for (const x of [
      -1200, -1001, -420, -369, -368, -280, -140, 0, 323, 324, 999, 1000, 1001,
      1100,
    ]) {
      for (const speed of [10, 30, 31, 39, 40, 60, 61]) {
        const hit = courseContact("canyon", x, speed, position);
        rows.push([
          hit.x,
          hit.speed,
          Number(hit.shoulder),
          Number(hit.crashed),
        ]);
      }
    }
    assert.equal(
      createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
      expected[feature],
      feature,
    );
  }
});

test("left and right channel banking matches 401 sampled DOS camera poses", () => {
  const angles = Array.from({ length: 401 }, (_, i) =>
    aqueductBank((-1000 + 5 * i) / 1000),
  );
  assert.equal(
    createHash("sha256").update(JSON.stringify(angles)).digest("hex"),
    "e37d7e31befeeea5cceaba041cb579816257db45fcad1b222bc169dba50e11d2",
  );
});

test("overtaking contact accounts for same-lane approach, crossing and passing clearance", () => {
  assert.equal(rearEndContact("canyon", 0, 0, 65, 64, 10, 9), true);
  assert.equal(rearEndContact("canyon", 0, 0, 2, -2, 10, 6), true);
  assert.equal(rearEndContact("canyon", 0, 0, 66, 65, 10, 9), false);
  assert.equal(rearEndContact("canyon", 0, 212, 65, 64, 10, 9), false);
  assert.equal(rearEndContact("canyon", 0, 0, 0, -2, 10, 9), false);
  assert.equal(rearEndContact("canyon", 0, 0, 65, 64, 9, 9), false);
});

for (const route of ["strip", "aqueduct", "canyon"] as const) {
  test(`${route} boundary decisions and impacts match the DOS contact routine`, () => {
    const rows = [];
    for (const lane of [
      -1450, -1306, -1177, -1176, -1001, -1000, -999, 0, 787, 788, 789, 998,
      999, 1000, 1001, 1176, 1177, 1306, 1450,
    ]) {
      for (const mph of [0, 9, 10, 39, 40, 41, 75]) {
        const hit = courseContact(route, lane, mph);
        rows.push([
          hit.x,
          hit.speed,
          Number(hit.shoulder),
          Number(hit.crashed),
        ]);
      }
    }
    assert.equal(
      createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
      expected[route],
    );
  });
}
