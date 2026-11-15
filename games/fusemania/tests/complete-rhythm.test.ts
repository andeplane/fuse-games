import assert from "node:assert/strict";
import test from "node:test";
import { createTiming } from "../src/engine/timing.js";
import { completeRhythmEvents } from "../src/lab/complete-rhythm.js";
import { selectPolicyEvents } from "../src/lab/rhythm-policy.js";

test("Challenge retains a continuous uneven melodic run that a stream budget suppresses", () => {
  const timing = createTiming({
    offset: -0.157,
    bpms: [[0, 179.366]],
    stops: [],
  });
  const events = Array.from({ length: 40 }, (_, i) => ({
    time: 12 + i * 0.09 + (i % 3) * 0.005,
    hz: 500 + (i % 8) * 50,
    kind: "attack" as const,
    strength: 3,
  }));
  const full = completeRhythmEvents(events, timing, 12, 16);
  assert.equal(full.length, events.length);
  full.forEach((event, i) =>
    assert.ok(
      Math.abs(event.time - events[i]!.time) < (i === 0 ? 0.0071 : 0.004),
    ),
  );
  const limited = selectPolicyEvents(events, timing, 12, 16, {
    targetNps: 3,
    peakNps2s: 4,
    subdivisions: [1, 2, 3, 4],
    maxStreamBeats: 4,
    recoveryBeats: 2,
  });
  assert.ok(limited.length < full.length);
});

test("fine timing respects offset, tempo changes and a stop without adding crop-boundary notes", () => {
  const timing = createTiming({
    offset: 0.31,
    bpms: [
      [0, 120],
      [4, 180],
    ],
    stops: [[6, 2]],
  });
  const beats = [1, 2.25, 4.5, 5.75, 6, 6.25, 8];
  const events = beats.map((beat) => ({
    time: timing.timeAt(beat),
    hz: 660,
    kind: "pitch" as const,
    strength: 2.1,
  }));
  const result = completeRhythmEvents(
    events,
    timing,
    events[1]!.time,
    events[5]!.time,
  );
  assert.deepEqual(
    result.map((e) => e.time),
    events.slice(1, 6).map((e) => e.time),
  );
});

test("attacks after a stop stay after it; interior pause attacks are not relocated", () => {
  const timing = createTiming({ offset: 0, bpms: [[0, 120]], stops: [[2, 2]] });
  const events = [1, 2, 3.001].map((time) => ({
    time,
    hz: 660,
    kind: "attack" as const,
    strength: 2,
  }));
  const result = completeRhythmEvents(events, timing, 0, 4);
  assert.equal(result.length, 2);
  assert.equal(result[0]!.time, 1);
  assert.ok(result[1]!.time > 3 && result[1]!.time < 3.012);
});
