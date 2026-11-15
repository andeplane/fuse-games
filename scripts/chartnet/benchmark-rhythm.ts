/** Reproducible audio-only detector calibration against authored charts. See README's rhythm benchmark section. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseSimfile } from "../../games/fusemania/src/engine/simfile.js";
import { placeChart } from "../../games/fusemania/src/lab/charts.js";
import {
  detectRhythm,
  type RhythmOptions,
} from "../../games/fusemania/src/lab/rhythm.js";
import { scoreRhythm } from "../../games/fusemania/src/lab/rhythm-score.js";
import {
  computeSpectra,
  FRAMES_PER_SECOND,
  LAB_RATE,
  type Spectra,
} from "../../games/fusemania/src/lab/spectrum.js";
import { SONGS_DATA } from "../../games/fusemania/src/engine/songs-data.js";

interface Song {
  id: string;
  audio: string;
  ssc: string;
}
const FOCUS = new Set([
  "dukamok-beyond-abilities-v2",
  "dukamok-big-blue",
  "dukamok-return-of-salieri",
  "dukamok-salieri-strikes-back",
]);
const ORDER = ["beginner", "easy", "medium", "hard", "challenge", "edit"];
const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const version = hash(
  readFileSync(
    new URL("../../games/fusemania/src/lab/spectrum.ts", import.meta.url),
  ),
);
const detectorHash = hash(
  readFileSync(
    new URL("../../games/fusemania/src/lab/rhythm.ts", import.meta.url),
  ),
);
const args = process.argv.slice(2);
const mode = args[0];
const option = (name: string, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : (args[i + 1] ?? "");
};
const manifest = option("manifest"),
  work = option("work");
const cacheRoot = option("cache", join(work, "cache"));
if (mode === "manifest") {
  if (!manifest)
    throw new Error("manifest mode requires --manifest <output JSON>");
  const originals = SONGS_DATA.filter((s) => s.id.startsWith("dukamok-")).map(
    ({ id, audio, ssc }) => ({ id, audio, ssc }),
  );
  if (originals.length !== 47)
    throw new Error("Expected the merged 47-song DukAmok catalogue");
  writeFileSync(manifest, JSON.stringify(originals));
  console.log(`Wrote ${originals.length} authored song/audio pairs`);
  process.exit(0);
}
if (!manifest || !work || !["run", "summary"].includes(mode ?? ""))
  throw new Error(
    "Usage: benchmark-rhythm.ts run|summary --manifest <47-song JSON> --work <cache/results> [--shard 0/6]",
  );
const raw: unknown = JSON.parse(readFileSync(manifest, "utf8"));
if (
  !Array.isArray(raw) ||
  raw.length !== 47 ||
  !raw.every((s: unknown): s is Song => {
    if (!s || typeof s !== "object") return false;
    const row = s as Record<string, unknown>;
    return (
      typeof row.id === "string" &&
      /^dukamok-[a-z0-9-]+$/.test(row.id) &&
      typeof row.audio === "string" &&
      /^https:\/\/storage\.googleapis\.com\/andershaf-87-fuse-media\/fusemania\/dukamok-originals\/.+\/[0-9a-f]{64}\/.+\.(mp3|ogg)$/.test(
        row.audio,
      ) &&
      typeof row.ssc === "string" &&
      row.ssc.length > 0
    );
  })
)
  throw new Error(
    "Expected all 47 DukAmok originals with immutable public audio URLs and authored charts",
  );
const songs = raw as Song[];
if (new Set(songs.map((s) => s.id)).size !== 47)
  throw new Error("Duplicate song IDs");
mkdirSync(work, { recursive: true });
mkdirSync(cacheRoot, { recursive: true });
const configs = [
  {
    id: "baseline",
    mode: "melody",
    lowHz: 200,
    highHz: 3000,
    sensitivity: 0.6,
    minGapBeats: 1 / 4,
  },
  {
    id: "melody-fast",
    mode: "melody",
    lowHz: 200,
    highHz: 3000,
    sensitivity: 0.8,
    minGapBeats: 1 / 8,
  },
  {
    id: "melody-wide",
    mode: "melody",
    lowHz: 80,
    highHz: 5000,
    sensitivity: 0.8,
    minGapBeats: 1 / 8,
  },
  {
    id: "melody-high",
    mode: "melody",
    lowHz: 400,
    highHz: 4000,
    sensitivity: 0.9,
    minGapBeats: 1 / 8,
  },
  {
    id: "attacks",
    mode: "attacks",
    lowHz: 80,
    highHz: 8000,
    sensitivity: 0.6,
    minGapBeats: 1 / 6,
  },
  {
    id: "attacks-fast",
    mode: "attacks",
    lowHz: 200,
    highHz: 5000,
    sensitivity: 0.9,
    minGapBeats: 1 / 8,
  },
  {
    id: "attacks-high",
    mode: "attacks",
    lowHz: 400,
    highHz: 4000,
    sensitivity: 0.8,
    minGapBeats: 1 / 8,
  },
  {
    id: "attacks-full",
    mode: "attacks",
    lowHz: 32.7,
    highHz: 11000,
    sensitivity: 0.8,
    minGapBeats: 1 / 8,
  },
] satisfies (Omit<RhythmOptions, "start" | "end" | "timing"> & {
  id: string;
})[];
const manifestHash = hash(readFileSync(manifest));
const benchmarkHash = hash(readFileSync(new URL(import.meta.url)));
const scorerHash = hash(
  readFileSync(
    new URL("../../games/fusemania/src/lab/rhythm-score.ts", import.meta.url),
  ),
);
const referenceHashes = Object.fromEntries(
  ["engine/simfile.ts", "engine/timing.ts", "lab/charts.ts"].map((path) => [
    path,
    hash(
      readFileSync(
        new URL(`../../games/fusemania/src/${path}`, import.meta.url),
      ),
    ),
  ]),
);
const decoder = execFileSync("ffmpeg", ["-version"], {
  encoding: "utf8",
}).split("\n")[0];
const decodeArgs = [
  "-v",
  "error",
  "-i",
  "<original audio>",
  "-f",
  "f32le",
  "-ac",
  "1",
  "-ar",
  String(LAB_RATE),
  "-",
];
const decoderHash = hash(JSON.stringify({ decoder, decodeArgs }));
const runHash = hash(
  JSON.stringify({
    configs,
    manifestHash,
    benchmarkHash,
    scorerHash,
    referenceHashes,
    decoderHash,
    detectorHash,
    spectrumHash: version,
  }),
);
const resultPath = (id: string) => join(work, `${id}.result.json`);
const write = (path: string, value: unknown) => {
  writeFileSync(`${path}.tmp`, JSON.stringify(value));
  renameSync(`${path}.tmp`, path);
};

async function analyse(song: Song) {
  const audioHash = song.audio.split("/").at(-2)!;
  const stem = join(cacheRoot, `${song.id}-${audioHash.slice(0, 12)}`);
  const audioPath = `${stem}.${song.audio.split(".").at(-1)}`;
  if (!existsSync(audioPath)) {
    const response = await fetch(song.audio, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw new Error(`${song.id}: audio HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== audioHash)
      throw new Error(`${song.id}: original audio checksum mismatch`);
    writeFileSync(`${audioPath}.tmp`, bytes);
    renameSync(`${audioPath}.tmp`, audioPath);
  } else if (hash(readFileSync(audioPath)) !== audioHash)
    throw new Error(`${song.id}: cached audio checksum mismatch`);
  const cache = `${stem}-${version.slice(0, 12)}`;
  let detail: Float32Array,
    frames: number,
    detailBins: number,
    duration: number;
  if (
    existsSync(`${cache}.json`) &&
    existsSync(`${cache}.f32`) &&
    JSON.parse(readFileSync(`${cache}.json`, "utf8")).decoderHash ===
      decoderHash
  ) {
    ({ frames, detailBins, duration } = JSON.parse(
      readFileSync(`${cache}.json`, "utf8"),
    ));
    const bytes = readFileSync(`${cache}.f32`);
    detail = new Float32Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    if (detail.length !== frames * detailBins)
      throw new Error(`${song.id}: incomplete spectrum cache`);
  } else {
    const bytes = execFileSync(
      "ffmpeg",
      decodeArgs.map((arg) => (arg === "<original audio>" ? audioPath : arg)),
      { maxBuffer: 256 * 1024 * 1024 },
    );
    const samples = new Float32Array(bytes.length / 4);
    for (let i = 0; i < samples.length; i++)
      samples[i] = bytes.readFloatLE(i * 4);
    duration = samples.length / LAB_RATE;
    if (duration > 2400)
      throw new Error(`${song.id}: unexpected audio longer than 40 minutes`);
    ({ detail, frames, detailBins } = computeSpectra(samples));
    writeFileSync(`${cache}.f32.tmp`, new Uint8Array(detail.buffer));
    renameSync(`${cache}.f32.tmp`, `${cache}.f32`);
    write(`${cache}.json`, {
      version,
      decoderHash,
      decoder,
      decodeArgs,
      frames,
      detailBins,
      duration,
    });
  }
  const sim = parseSimfile(song.ssc);
  const charts = sim.charts
    .filter((c) => c.stepsType === "dance-single")
    .map((c, index) => {
      const placed = placeChart(sim, c, `chart:${index}`, "authored");
      const rows = [
        ...new Set(
          placed.notes.filter((n) => n.kind !== "mine").map((n) => n.time),
        ),
      ].sort((a, b) => a - b);
      if (!rows.length || rows.some((t) => t < -0.1 || t > duration + 0.1))
        throw new Error(
          `${song.id}: authored chart/audio alignment outside duration`,
        );
      const beats = [
        ...new Set(
          placed.notes.filter((n) => n.kind !== "mine").map((n) => n.beat),
        ),
      ].sort((a, b) => a - b);
      const streams: { start: number; end: number; rows: number }[] = [];
      let from = 0;
      for (let i = 1; i <= beats.length; i++) {
        if (
          i < beats.length &&
          beats[i]! - beats[i - 1]! <= 0.500001 &&
          rows[i]! - rows[i - 1]! <= 0.2
        )
          continue;
        if (i - from >= 16)
          streams.push({
            start: rows[from]!,
            end: rows[i - 1]!,
            rows: i - from,
          });
        from = i;
      }
      return {
        index,
        difficulty: c.difficulty,
        description: c.description,
        meter: c.meter,
        rows,
        streams,
      };
    });
  if (!charts.length) throw new Error(`${song.id}: no authored single chart`);
  const primary = [...charts]
    .sort(
      (a, b) =>
        ORDER.indexOf(a.difficulty.toLowerCase()) -
          ORDER.indexOf(b.difficulty.toLowerCase()) || a.meter - b.meter,
    )
    .at(-1)!;
  const features: Pick<Spectra, "frames" | "detail" | "detailBins"> = {
    frames,
    detail,
    detailBins,
  };
  const results = configs.map((config) => {
    const result = detectRhythm(features, {
      ...config,
      start: 0,
      end: duration,
      timing: sim.timing,
    });
    const times = result.events.map((e) => e.time);
    return {
      config: config.id,
      events: result.events,
      charts: charts.map((chart) => ({
        ...chart,
        rows: undefined,
        scores: [0.02, 0.04, 0.06].map((tolerance) => ({
          tolerance,
          ...scoreRhythm(chart.rows, times, tolerance),
        })),
        streamScore: scoreRhythm(
          chart.rows.filter((t) =>
            chart.streams.some((s) => t >= s.start && t <= s.end),
          ),
          times.filter((t) =>
            chart.streams.some((s) => t >= s.start - 0.04 && t <= s.end + 0.04),
          ),
          0.04,
        ),
      })),
    };
  });
  const result = {
    id: song.id,
    development: FOCUS.has(song.id),
    audio: song.audio,
    audioHash,
    chartHash: hash(song.ssc),
    detectorHash,
    runHash,
    spectrumHash: version,
    fps: FRAMES_PER_SECOND,
    duration,
    primary: {
      index: primary.index,
      difficulty: primary.difficulty,
      meter: primary.meter,
      rows: primary.rows.length,
    },
    results,
  };
  write(resultPath(song.id), result);
  console.log(
    `${song.id}: ${duration.toFixed(1)} s, ${charts.length} charts, ${primary.rows.length} primary rows`,
  );
}

if (mode === "run") {
  const shard = /^(\d+)\/(\d+)$/.exec(option("shard", "0/1"));
  if (!shard || +shard[2]! < 1 || +shard[1]! >= +shard[2]!)
    throw new Error("Invalid shard");
  for (const [i, song] of songs.entries())
    if (i % +shard[2]! === +shard[1]!) await analyse(song);
} else {
  const all = songs.map((song) =>
    JSON.parse(readFileSync(resultPath(song.id), "utf8")),
  );
  if (
    all.some(
      (r) =>
        r.detectorHash !== detectorHash ||
        r.spectrumHash !== version ||
        r.runHash !== runHash,
    )
  )
    throw new Error("Results do not match this source revision");
  const mean = (values: number[]) =>
    values.reduce((a, b) => a + b, 0) / values.length;
  const score = (row: (typeof all)[number], config: string, tolerance = 0.04) =>
    row.results
      .find((r: { config: string }) => r.config === config)
      .charts.find((c: { index: number }) => c.index === row.primary.index)
      .scores.find((s: { tolerance: number }) => s.tolerance === tolerance);
  // Selection consults only the four development songs. Remaining 43 songs are reported after that choice.
  const development = all.filter((r) => r.development),
    validation = all.filter((r) => !r.development);
  if (development.length !== 4 || validation.length !== 43)
    throw new Error("Incomplete pack split");
  const ranking = configs
    .map((c) => ({
      id: c.id,
      f1: mean(development.map((r) => score(r, c.id).f1)),
    }))
    .sort((a, b) => b.f1 - a.f1);
  const selected = ranking[0]!.id;
  const streamScore = (row: (typeof all)[number], config: string) =>
    row.results
      .find((r: { config: string }) => r.config === config)
      .charts.find((c: { index: number }) => c.index === row.primary.index)
      .streamScore;
  const streamMean = (rows: typeof all, config: string) => {
    const values = rows
      .map((r) => streamScore(r, config))
      .filter((s) => s.reference > 0)
      .map((s) => s.f1);
    return values.length ? mean(values) : null;
  };
  const summary = {
    version: 1,
    detectorHash,
    spectrumHash: version,
    manifestHash,
    benchmarkHash,
    scorerHash,
    referenceHashes,
    decoderHash,
    decodeArgs,
    runHash,
    configs,
    node: process.version,
    decoder,
    streamDefinition:
      "At least 16 consecutive authored rows, gaps at most half a beat and 200 ms. A density proxy, not annotated instrument solos.",
    totalSongs: all.length,
    totalCharts: all.reduce((n, r) => n + r.results[0].charts.length, 0),
    selected,
    ranking,
    aggregate: configs.map((c) => ({
      config: c.id,
      developmentF1: mean(development.map((r) => score(r, c.id).f1)),
      validationF1: mean(validation.map((r) => score(r, c.id).f1)),
      allF1: mean(all.map((r) => score(r, c.id).f1)),
      developmentStreamF1: streamMean(development, c.id),
      validationStreamF1: streamMean(validation, c.id),
      validationRecall: mean(validation.map((r) => score(r, c.id).recall)),
      validationPrecision: mean(
        validation.map((r) => score(r, c.id).precision),
      ),
    })),
    songs: all.map((r) => ({
      id: r.id,
      development: r.development,
      duration: r.duration,
      primary: r.primary,
      baseline: score(r, "baseline"),
      selected: score(r, selected),
      baselineStreams: streamScore(r, "baseline"),
      selectedStreams: streamScore(r, selected),
      auditionSpans: r.results[0].charts
        .find((c: { index: number }) => c.index === r.primary.index)
        .streams.sort(
          (a: { rows: number }, b: { rows: number }) => b.rows - a.rows,
        )
        .slice(0, 5),
    })),
  };
  write(join(work, "summary.json"), summary);
  console.log(JSON.stringify(summary.aggregate, null, 2));
}
