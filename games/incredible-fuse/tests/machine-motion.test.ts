import assert from "node:assert/strict";
import test from "node:test";
import { atmosphere } from "../src/game/machine-motion.js";
import type { PartKind } from "../src/game/machine-parts.js";

// Output of the supplied DOS executable at rest and at saturated velocity.
// Columns follow the moving-part order in the original game data.
const classes: PartKind[] = [
  "bowling",
  "balloon",
  "basketball",
  "cage",
  "cat",
  "basket",
  "spark",
  "baseball",
  "rocket",
  "mouse",
  "ball",
  "tennis",
  "candle",
];
const samples: [number, number, number, number[]][] = [
  [
    0,
    144,
    9728,
    [144, 144, 144, 144, 144, 144, 144, 144, 144, 144, 144, 144, 144],
  ],
  [
    1,
    147,
    9728,
    [147, 147, 147, 147, 147, 147, 147, 147, 147, 147, 147, 147, 147],
  ],
  [18, 115, 9719, [29, 0, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29]],
  [
    22,
    195,
    9717,
    [195, -36, 194, 195, 194, 195, 194, 194, 195, 194, 195, 194, 194],
  ],
  [
    64,
    272,
    9696,
    [269, -196, 266, 271, 268, 271, 265, 268, 272, 268, 272, 266, 268],
  ],
  [
    64,
    275,
    9696,
    [272, -198, 269, 274, 271, 274, 268, 271, 275, 271, 275, 269, 271],
  ],
  [
    65,
    272,
    9696,
    [269, -196, 266, 271, 268, 271, 265, 268, 272, 268, 272, 266, 268],
  ],
  [
    65,
    275,
    9696,
    [272, -198, 269, 274, 271, 274, 268, 271, 275, 271, 275, 269, 271],
  ],
  [
    66,
    268,
    9695,
    [265, -195, 262, 267, 264, 267, 261, 264, 268, 264, 268, 262, 264],
  ],
  [
    66,
    272,
    9695,
    [269, -198, 266, 271, 268, 271, 265, 268, 272, 268, 272, 266, 268],
  ],
  [
    66,
    275,
    9695,
    [272, -200, 269, 274, 271, 274, 267, 271, 275, 271, 275, 269, 271],
  ],
  [
    67,
    268,
    9695,
    [265, -195, 262, 267, 264, 267, 261, 264, 268, 264, 268, 262, 264],
  ],
  [
    67,
    272,
    9695,
    [269, -198, 266, 271, 268, 271, 265, 268, 272, 268, 272, 266, 268],
  ],
  [
    67,
    275,
    9695,
    [272, -200, 269, 274, 271, 274, 267, 271, 275, 271, 275, 269, 271],
  ],
  [
    68,
    272,
    9694,
    [269, -200, 266, 271, 268, 271, 264, 268, 272, 268, 272, 266, 268],
  ],
];
test("all 15 original campaign atmospheres agree with native acceleration and cap for all 13 moving classes", () => {
  for (const [air, gravity, terminal, accelerations] of samples) {
    for (const [i, kind] of classes.entries()) {
      assert.deepEqual(
        atmosphere(kind, air, gravity),
        {
          acceleration: accelerations[i],
          terminal: kind === "ball" ? 12288 : terminal,
        },
        `${kind}, air ${air} gravity ${gravity}`,
      );
    }
  }
});
