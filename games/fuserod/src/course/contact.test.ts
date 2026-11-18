import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { courseContact } from "./index.js";

const expected = {
  strip: "094fa2b70e5dd953482bd01bcf633f401d7bb5cc47509b1869097a3b6065f8d7",
  aqueduct: "f6bd63a12a928b30a475b93dd4b6008ebafec448650bb1656ff4712002a2d220",
  canyon: "bcade4e214b96ddcb9e1adda378fbdaf28d0bd327a0cca7da9303a69869c7df3",
};

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
