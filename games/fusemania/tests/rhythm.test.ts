import assert from "node:assert/strict";
import test from "node:test";
import { detectRhythm, type RhythmOptions } from "../src/lab/rhythm.js";
import { computeSpectra, LAB_RATE } from "../src/lab/spectrum.js";

const options: RhythmOptions = {
  start: 0.2,
  end: 1.8,
  lowHz: 300,
  highHz: 1800,
  sensitivity: 0.6,
  minGapBeats: 0.16,
  timing: { offset: 0, bpms: [[0, 120]], stops: [] },
  mode: "melody",
};
const audio = (fn: (time: number) => number) =>
  Float32Array.from({ length: LAB_RATE * 2 }, (_, i) => fn(i / LAB_RATE));
const tone = (hz: number, time: number) =>
  0.3 * Math.sin(2 * Math.PI * hz * time);
const near = (times: number[], expected: number) =>
  assert.ok(
    times.some((t) => Math.abs(t - expected) <= 0.05),
    `no event near ${expected}: ${times}`,
  );

test("silence and a steady pitched sustain do not acquire a rhythm", () => {
  for (const signal of [audio(() => 0), audio((t) => tone(440, t))]) {
    const result = detectRhythm(computeSpectra(signal), options);
    assert.deepEqual(result.events, []);
  }
});

test("a continuous pitch bend does not become a run of separate notes", () => {
  for (const [start, end] of [
    [440, 880],
    [1760, 440],
    [110, 440],
    [440, 110],
  ]) {
    const rate = Math.log(end! / start!) / 2;
    const signal = audio(
      (t) =>
        0.3 * Math.sin((2 * Math.PI * start! * Math.expm1(rate * t)) / rate),
    );
    const result = detectRhythm(computeSpectra(signal), {
      ...options,
      lowHz: 80,
      highHz: 2000,
    });
    assert.deepEqual(
      result.events,
      [],
      `${start}→${end} Hz crosses a spectrum-resolution seam`,
    );
  }
});

test("fresh attacks on the same pitch retain their unsnapped timing", () => {
  const hits = [0.317, 0.643, 1.017, 1.463];
  const signal = audio((t) => {
    const hit = hits.find((at) => t >= at && t < at + 0.13);
    return hit === undefined ? 0 : tone(440, t - hit);
  });
  const result = detectRhythm(computeSpectra(signal), options);
  const times = result.events.map((e) => e.time);
  for (const hit of hits) near(times, hit);
  assert.equal(times.length, hits.length);
  assert.ok(result.events.every((e) => e.kind === "attack"));
});

test("bass attacks do not inherit the long window's early log-flux timestamp", () => {
  const hits = [0.4, 0.8, 1.2];
  const signal = audio((t) => {
    const hit = hits.find((at) => t >= at && t < at + 0.15);
    return hit === undefined ? 0 : tone(220, t - hit);
  });
  const result = detectRhythm(computeSpectra(signal), {
    ...options,
    lowHz: 176,
    highHz: 275,
  });
  assert.equal(result.events.length, hits.length);
  for (const hit of hits)
    assert.ok(result.events.some((e) => Math.abs(e.time - hit) < 0.025));
});

test("calibrated stream settings retain closely spaced repeated notes", () => {
  const hits = Array.from({ length: 16 }, (_, i) => 0.3 + i * 0.067);
  const signal = audio((t) => {
    const hit = hits.find((at) => t >= at && t < at + 0.04);
    return hit === undefined ? 0 : tone(1200, t - hit);
  });
  const spectra = computeSpectra(signal);
  const result = detectRhythm(spectra, {
    ...options,
    lowHz: 400,
    highHz: 4000,
    sensitivity: 0.9,
    minGapBeats: 0.08,
  });
  assert.equal(result.events.length, hits.length);
  for (const hit of hits)
    assert.ok(result.events.some((e) => Math.abs(e.time - hit) < 0.025));
  assert.ok(
    detectRhythm(spectra, { ...options, minGapBeats: 0.16 }).events.length <
      hits.length,
  );
});

test("equal-loudness connected melody notes produce events without requiring silence", () => {
  const signal = audio((t) =>
    tone(t < 0.5 ? 440 : t < 0.9 ? 554.37 : t < 1.3 ? 659.25 : 493.88, t),
  );
  const result = detectRhythm(computeSpectra(signal), options);
  const times = result.events.map((e) => e.time);
  for (const change of [0.5, 0.9, 1.3]) near(times, change);
  assert.equal(times.length, 3);
  const pitchAt = (time: number) =>
    result.pitch[Math.round(time * 100) - result.fromFrame]!;
  assert.ok(Math.abs(pitchAt(0.7) - 554.37) < 20);
  assert.ok(Math.abs(pitchAt(1.1) - 659.25) < 20);
});

test("a quiet melody band does not follow stronger bass attacks outside it", () => {
  const signal = audio(
    (t) => tone(440, t) + (t % 0.25 < 0.07 ? tone(90, t) * 2 : 0),
  );
  const result = detectRhythm(computeSpectra(signal), {
    ...options,
    lowHz: 350,
    highHz: 550,
  });
  assert.deepEqual(result.events, []);
});

test("harmonic stacks reveal a missing fundamental and its repeated attacks", () => {
  const hits = [0.4, 0.8, 1.2];
  const spectra = computeSpectra(
    audio((t) => {
      const hit = hits.find((at) => t >= at && t < at + 0.18);
      return hit === undefined
        ? 0
        : tone(880, t - hit) + tone(1320, t - hit) * 0.8;
    }),
  );
  const result = detectRhythm(spectra, { ...options, lowHz: 350, highHz: 550 });
  for (const hit of hits)
    near(
      result.events.map((e) => e.time),
      hit,
    );
  assert.equal(result.events.length, 3);
  // Check the pitched sustain, rather than the broadband transient at each abrupt waveform boundary.
  for (const hit of hits) {
    const hz = result.pitch[Math.round((hit + 0.1) * 100) - result.fromFrame]!;
    assert.ok(
      Math.abs(hz - 440) < 20,
      `tracked ${hz} Hz instead of the missing 440 Hz fundamental`,
    );
  }
});

test("small vibrato is not a succession of new notes", () => {
  for (const centre of [440, 452.89]) {
    const signal = audio((t) => {
      // Frequency oscillates by about 25 cents, phase is the integral of instantaneous frequency.
      const phase =
        2 * Math.PI * centre * t - (6.4 / 5) * Math.cos(2 * Math.PI * 5 * t);
      return 0.3 * Math.sin(phase);
    });
    const result = detectRhythm(computeSpectra(signal), options);
    assert.deepEqual(result.events, []);
  }
});

test("selection boundaries do not invent attacks; min gap suppresses double clicks", () => {
  const spectra = computeSpectra(
    audio((t) => tone(t < 0.6 ? 440 : t < 0.7 ? 660 : 550, t)),
  );
  const sustain = detectRhythm(spectra, { ...options, start: 0.85, end: 1.3 });
  assert.deepEqual(sustain.events, []);
  const result = detectRhythm(spectra, { ...options, minGapBeats: 0.36 });
  assert.equal(result.events.length, 1);
});

test("the same finest subdivision permits faster notes at a faster BPM", () => {
  const hits = [0.4, 0.47];
  const spectra = computeSpectra(
    audio((t) => {
      const hit = hits.find((at) => t >= at && t < at + 0.035);
      return hit === undefined ? 0 : tone(1000, t - hit);
    }),
  );
  const count = (bpm: number) =>
    detectRhythm(spectra, {
      ...options,
      mode: "attacks",
      minGapBeats: 0.25,
      timing: { offset: 0, bpms: [[0, bpm]], stops: [] },
    }).events.length;
  assert.equal(count(120), 1);
  assert.equal(count(240), 2);
});

test("attack-only mode works on broadband percussion and leaves input features intact", () => {
  let seed = 17;
  const signal = audio((t) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return [0.4, 0.8, 1.2].some((at) => t >= at && t < at + 0.04)
      ? (seed / 2 ** 32 - 0.5) * 0.5
      : 0;
  });
  const spectra = computeSpectra(signal);
  const before = spectra.detail.slice();
  const result = detectRhythm(spectra, { ...options, mode: "attacks" });
  for (const hit of [0.4, 0.8, 1.2])
    near(
      result.events.map((e) => e.time),
      hit,
    );
  assert.equal(result.events.length, 3);
  assert.deepEqual(spectra.detail, before);
});

test("invalid controls fail clearly, out-of-range bands and non-finite bins fail quietly", () => {
  const spectra = computeSpectra(audio(() => 0));
  assert.throws(
    () => detectRhythm(spectra, { ...options, start: NaN }),
    /valid time span/,
  );
  assert.throws(
    () => detectRhythm(spectra, { ...options, minGapBeats: 0 }),
    /valid time span/,
  );
  assert.deepEqual(
    detectRhythm(spectra, { ...options, lowHz: 20000, highHz: 30000 }).events,
    [],
  );
  spectra.detail.fill(NaN);
  assert.deepEqual(detectRhythm(spectra, options).events, []);
});
