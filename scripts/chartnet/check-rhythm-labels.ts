/** Private calibration: compare measured attacks with a user's tapped phrase. Labels never enter detection. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SONGS_DATA } from "../../games/fusemania/src/engine/songs-data.js";
import { parseSimfile } from "../../games/fusemania/src/engine/simfile.js";
import {
  computeSpectra,
  LAB_RATE,
} from "../../games/fusemania/src/lab/spectrum.js";
import { type RhythmOptions } from "../../games/fusemania/src/lab/rhythm.js";
import { scoreRhythm } from "../../games/fusemania/src/lab/rhythm-score.js";
import { detectRhythmLayers } from "../../games/fusemania/src/lab/rhythm-layers.js";

const [id, audio, labelsFile, out] = process.argv.slice(2);
if (!id || !audio || !labelsFile || !out)
  throw Error(
    "check-rhythm-labels.ts <song> <original audio> <private {start,end,times}> <output>",
  );
const labels = JSON.parse(readFileSync(labelsFile, "utf8")) as {
  start: number;
  end: number;
  times: number[];
};
if (
  !Number.isFinite(labels.start) ||
  !Number.isFinite(labels.end) ||
  labels.end <= labels.start ||
  !labels.times.length ||
  !labels.times.every(Number.isFinite)
)
  throw Error("Invalid private labels");
const sim = parseSimfile(SONGS_DATA.find((s) => s.id === id)!.ssc);
const decoded = execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-i",
    audio,
    "-f",
    "f32le",
    "-ac",
    "1",
    "-ar",
    String(LAB_RATE),
    "-",
  ],
  { maxBuffer: 256 * 1024 * 1024 },
);
const samples = new Float32Array(decoded.length / 4);
for (let i = 0; i < samples.length; i++)
  samples[i] = decoded.readFloatLE(i * 4);
const spectra = computeSpectra(samples);
const profiles = [
  { name: "auto", lowHz: 400, highHz: 4000, mode: "melody", layer: "auto" },
  { name: "lead", lowHz: 200, highHz: 3000, mode: "attacks" },
  { name: "upper-lead", lowHz: 400, highHz: 2000, mode: "attacks" },
  { name: "bass", lowHz: 40, highHz: 250, mode: "melody" },
  { name: "selected-band", lowHz: 32, highHz: 1135, mode: "attacks" },
  { name: "harmonic-lead", lowHz: 400, highHz: 4000, mode: "melody" },
] as const;
const results = profiles.map((profile) => {
  const options: RhythmOptions = {
    ...profile,
    start: 0,
    end: samples.length / LAB_RATE,
    sensitivity: 0.6,
    minGapBeats: 1 / 8,
    timing: sim.timing,
  };
  const result = detectRhythmLayers(spectra, options);
  const phrase = result.events
    .filter((e) => e.time >= labels.start && e.time <= labels.end)
    .map((e) => e.time);
  const summary = {
    profile: profile.name,
    events: phrase.length,
    introEvents: result.events.filter((e) => e.time >= 1.5 && e.time <= 2.5)
      .length,
    score40: scoreRhythm(labels.times, phrase, 0.04),
    score60: scoreRhythm(labels.times, phrase, 0.06),
  };
  console.log(JSON.stringify(summary));
  return {
    ...summary,
    options,
    fromFrame: result.fromFrame,
    pitch: Array.from(result.pitch),
    novelty: Array.from(result.novelty),
    pitchChanges: result.pitchChanges,
    detected: result.events,
    layers: result.layers,
  };
});
writeFileSync(
  out,
  JSON.stringify({
    song: id,
    span: [labels.start, labels.end],
    labels: labels.times.length,
    sources: Object.fromEntries(
      ["spectrum.ts", "rhythm.ts", "rhythm-layers.ts"].map((name) => [
        name,
        createHash("sha256")
          .update(
            readFileSync(
              new URL(`../../games/fusemania/src/lab/${name}`, import.meta.url),
            ),
          )
          .digest("hex"),
      ]),
    ),
    detectorHash: createHash("sha256")
      .update(
        readFileSync(
          new URL("../../games/fusemania/src/lab/rhythm.ts", import.meta.url),
        ),
      )
      .digest("hex"),
    results,
  }),
);
