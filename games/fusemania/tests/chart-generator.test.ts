import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Analysis } from "../../../scripts/lib/fusemania/analysis.js";
import {
  DIFFICULTIES,
  generateCharts,
} from "../../../scripts/lib/fusemania/generate.js";

test("a supplied rhythm with no playable rows produces an empty chart at every difficulty", () => {
  const analysis = JSON.parse(
    readFileSync(
      new URL("../charts/analysis/burning-heat.json", import.meta.url),
      "utf8",
    ),
  ) as Analysis;
  const placements = { Easy: [], Medium: [], Hard: [-1], Challenge: [] };
  const charts = generateCharts(analysis, placements);
  assert.deepEqual(
    charts.map(({ difficulty }) => difficulty),
    DIFFICULTIES,
  );
  for (const chart of charts) assert.deepEqual(chart.notes, []);
});
