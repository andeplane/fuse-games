import assert from "node:assert/strict";
import test from "node:test";
import { createTiming } from "../src/engine/timing.js";
import { parseSimfile } from "../src/engine/simfile.js";
import { SONGS_DATA } from "../src/engine/songs-data.js";
import { placeChart } from "../src/lab/charts.js";
import {
  LEVELS,
  mapReferences,
  rhythmStats,
  selectPolicyEvents,
  validateLadder,
  type RhythmPolicy,
} from "../src/lab/rhythm-policy.js";
import type { RhythmEvent } from "../src/lab/rhythm.js";

const timing = createTiming({ offset: 0, bpms: [[0, 120]], stops: [] });
const policy: RhythmPolicy = {
  targetNps: 4,
  peakNps2s: 4,
  subdivisions: [1, 2, 4],
  maxStreamBeats: 16,
  recoveryBeats: 2,
};
const events = (n: number, gap = 0.125): RhythmEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    time: i * gap,
    hz: 880,
    strength: 1,
    kind: "attack",
  }));

test("top authored charts map to the upper end of the four-level ladder; Edit becomes Challenge", () => {
  const data = SONGS_DATA.find((s) => s.id === "dukamok-return-of-salieri")!;
  const sim = parseSimfile(data.ssc);
  const mapped = mapReferences(
    sim.charts
      .filter((c) => c.stepsType === "dance-single")
      .map((c, i) => placeChart(sim, c, `song:${i}`, "authored")),
  );
  assert.deepEqual(
    mapped.map((r) => r.level),
    ["Medium", "Hard", "Challenge"],
  );
  assert.equal(mapped.at(-1)!.chart.chart.difficulty, "Edit");
});

test("subdivision spacing follows BPM and event selection preserves candidate strengths", () => {
  const fast = createTiming({ offset: 0, bpms: [[0, 240]], stops: [] });
  const input = events(32, 0.0625);
  assert.equal(
    selectPolicyEvents(input, fast, 0, 2, {
      ...policy,
      targetNps: 24,
      peakNps2s: 32,
    }).length,
    32,
  );
  assert.equal(
    selectPolicyEvents(input, timing, 0, 2, {
      ...policy,
      targetNps: 24,
      peakNps2s: 32,
    }).length,
    16,
  );
  assert.equal(input[1]!.time, 0.0625);
});

test("every sliding two-second window respects the peak cap, with a separate overall budget", () => {
  const selected = selectPolicyEvents(events(160), timing, 0, 20, policy);
  assert.ok(selected.length <= 80);
  for (const event of selected)
    assert.ok(
      selected.filter((e) => e.time >= event.time && e.time < event.time + 2)
        .length <= 8,
    );
  assert.deepEqual(
    selected,
    selectPolicyEvents(events(160), timing, 0, 20, policy),
  );
});

test("dense streams create a recovery gap, and crops never gain outside clicks", () => {
  const selected = selectPolicyEvents(events(80), timing, 0.125, 8, {
    ...policy,
    targetNps: 16,
    peakNps2s: 16,
    maxStreamBeats: 2,
    recoveryBeats: 2,
  });
  assert.ok(selected.every((e) => e.time >= 0.125 && e.time <= 8));
  assert.ok(selected.slice(1).some((e, i) => e.time - selected[i]!.time >= 1));
});

test("untrusted policies reject invalid bounds, grids and descending difficulty", () => {
  const ladder = Object.fromEntries(
    LEVELS.map((level) => [level, { ...policy }]),
  );
  assert.doesNotThrow(() => validateLadder(ladder));
  assert.throws(() =>
    validateLadder({ ...ladder, Hard: { ...policy, targetNps: NaN } }),
  );
  assert.throws(() =>
    validateLadder({ ...ladder, Hard: { ...policy, subdivisions: [99] } }),
  );
  assert.throws(() =>
    validateLadder({ ...ladder, Challenge: { ...policy, targetNps: 1 } }),
  );
  assert.throws(() =>
    validateLadder({ ...ladder, Challenge: { ...policy, recoveryBeats: 8 } }),
  );
});

test("a long timing stop supplies recovery and the post-stop melody resumes", () => {
  const stopped = createTiming({
    offset: 0,
    bpms: [[0, 120]],
    stops: [[2, 5]],
  });
  const source = Array.from({ length: 17 }, (_, i) => ({
    time: stopped.timeAt(i / 4),
    hz: 880,
    strength: 1,
    kind: "attack" as const,
  }));
  const selected = selectPolicyEvents(source, stopped, 0, 8, {
    ...policy,
    targetNps: 24,
    peakNps2s: 32,
    maxStreamBeats: 2,
    recoveryBeats: 2,
  });
  assert.ok(selected.some((e) => e.time >= stopped.timeAt(2.25)));
});

test("peak rate uses sliding two-second windows and does not amplify a partial tail", () => {
  const sample = [1.98, 1.99, 2.01, 2.02].map((time) => ({
    time,
    hz: 880,
    strength: 1,
    kind: "attack" as const,
  }));
  assert.equal(rhythmStats(sample, timing, 0, 4).rate2s.peak, 2);
  assert.equal(
    rhythmStats(
      [{ time: 4.005, hz: 880, strength: 1, kind: "attack" }],
      timing,
      0,
      4.01,
    ).rate2s.peak,
    0.5,
  );
});
