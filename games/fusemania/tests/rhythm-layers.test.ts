import assert from "node:assert/strict";
import test from "node:test";
import {
  detectRhythmLayers,
  melodicEvidence,
  selectRhythmLayers,
} from "../src/lab/rhythm-layers.js";
import { computeSpectra, LAB_RATE } from "../src/lab/spectrum.js";
import type { RhythmResult } from "../src/lab/rhythm.js";

const line = (
  times: number[],
  changes: number[],
  hz: number,
): RhythmResult => ({
  options: {
    start: 0,
    end: 4,
    lowHz: 40,
    highHz: 4000,
    mode: "melody",
    sensitivity: 0.6,
    minGapBeats: 0.125,
    timing: { offset: 0, bpms: [[0, 120]], stops: [] },
  },
  fromFrame: 0,
  pitch: new Float32Array(401).fill(hz),
  novelty: new Float32Array(401),
  events: times.map((time) => ({ time, hz, kind: "attack", strength: 3 })),
  pitchChanges: changes.map((time) => ({ time, hz })),
});

test("phrase selection uses bass when upper spectral attacks have no articulated melody", () => {
  const lead = line(
    [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75],
    [],
    660,
  );
  const bass = line([0.4, 1.4, 2.4, 3.4], [], 110);
  assert.deepEqual(selectRhythmLayers(lead, bass).events, bass.events);
});

test("independent pitch changes corroborate a lead phrase without adding timestamps", () => {
  const times = [
    0.2, 0.45, 0.7, 0.95, 1.2, 1.45, 1.7, 2.2, 2.45, 2.7, 2.95, 3.2, 3.45, 3.7,
  ];
  const lead = line(
    times,
    times.map((t) => t + 0.01),
    660,
  );
  const bass = line([0.4, 1.4, 2.4, 3.4], [], 110);
  assert.ok(melodicEvidence(lead, 0, 4) > 0.9);
  assert.deepEqual(selectRhythmLayers(lead, bass).events, lead.events);
});

test("a dense attack train cannot claim melodic evidence merely by covering all time", () => {
  const times = Array.from({ length: 200 }, (_, i) => i * 0.02);
  const lead = line(
    times,
    times.map((t) => t + 0.01),
    660,
  );
  assert.equal(melodicEvidence(lead, 0, 3.9), 0);
});

test("missing bass falls back to detected lead, and silence never gains events", () => {
  const lead = line([0.4, 1.4, 2.4, 3.4], [], 660),
    silence = line([], [], 0);
  assert.deepEqual(selectRhythmLayers(lead, silence).events, lead.events);
  assert.deepEqual(selectRhythmLayers(silence, silence).events, []);
});

test("candidate spacing uses beats across a tempo slowdown", () => {
  const lead = line([0.975, 1.05], [], 660),
    bass = line([], [], 110);
  const timing = {
    offset: 0,
    bpms: [
      [0, 240],
      [4, 60],
    ] as const,
    stops: [],
  };
  lead.options.timing = timing;
  bass.options.timing = timing;
  assert.equal(selectRhythmLayers(lead, bass).events.length, 2);
});

test("a crop includes its last attack without duplicating bar boundaries", () => {
  const lead = line([0.2, 2, 4], [], 660),
    bass = line([], [], 110);
  assert.deepEqual(selectRhythmLayers(lead, bass).events, lead.events);
});

test("Auto lab crops retain the full-song generator's voice choices and timestamps", () => {
  const samples = Float32Array.from({ length: LAB_RATE * 4 }, (_, i) => {
    const t = i / LAB_RATE;
    return t % 0.25 < 0.1 ? 0.3 * Math.sin(2 * Math.PI * 660 * t) : 0;
  });
  const spectra = computeSpectra(samples),
    options = { ...line([], [], 0).options, layer: "auto" as const };
  const full = detectRhythmLayers(spectra, options),
    span = { start: 1.33, end: 2.91 };
  const crop = detectRhythmLayers(spectra, { ...options, ...span });
  const expected = full.events.filter(
    (e) => e.time >= span.start && e.time <= span.end,
  );
  assert.ok(expected.length > 0);
  assert.deepEqual(crop.events, expected);
});
