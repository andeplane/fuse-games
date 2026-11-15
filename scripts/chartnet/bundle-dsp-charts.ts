/** Register a playable experimental pack only after verifying the learned model kept every DSP head time. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseSimfile } from "../../games/fusemania/src/engine/simfile.js";
import { placeChart } from "../../games/fusemania/src/lab/charts.js";
import { SONGS, type SongSpec } from "../lib/fusemania/songs.js";
import { DSP_SONGS } from "../lib/fusemania/dsp-songs.js";

const [directory, jobsPath] = process.argv.slice(2);
if (!directory || !jobsPath)
  throw Error(
    "bundle-dsp-charts.ts <generated directory> <fixed-rhythm jobs JSON>",
  );
const jobs = JSON.parse(readFileSync(jobsPath, "utf8")) as {
  id: string;
  charts: {
    level: string;
    beats: number[];
    times: number[];
    pattern: {
      allowedPanels: number[];
      maxPanels: number;
      allowCrossovers: false;
      allowHolds: false;
    };
  }[];
}[];
const specs = new Map<string, SongSpec>(
  DSP_SONGS.map((s: SongSpec) => [
    s.id,
    { ...s, previewOf: s.previewOf ?? s.id.slice(4) },
  ]),
);
const pending: { path: string; text: string }[] = [];
const manifestPath = "games/fusemania/charts/dsp-generation.json";
const manifest: Record<string, unknown> = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : {};
let canonical = 0;
mkdirSync("games/fusemania/charts/dsp", { recursive: true });
for (const job of jobs) {
  const levels = ["Easy", "Medium", "Hard", "Challenge"];
  if (
    !Array.isArray(job.charts) ||
    job.charts.length !== 4 ||
    new Set(job.charts.map((c) => c.level)).size !== 4 ||
    !levels.every((level) => job.charts.some((c) => c.level === level)) ||
    job.charts.some(
      (c) =>
        !Array.isArray(c.times) ||
        !Array.isArray(c.beats) ||
        !c.times.length ||
        c.times.length !== c.beats.length ||
        ![...c.times, ...c.beats].every(Number.isFinite),
    )
  )
    throw Error(`${job.id}: invalid fixed-rhythm chart contract`);
  const source = SONGS.find((s) => s.id === job.id);
  if (!source) throw Error(`Unknown original ${job.id}`);
  const text = readFileSync(join(directory, `${job.id}.ssc`), "utf8"),
    sim = parseSimfile(text);
  const report = JSON.parse(
    readFileSync(join(directory, `${job.id}.json`), "utf8"),
  ) as {
    sscSha256: string;
    generatorSources: Record<string, string>;
    charts: {
      level: string;
      finalPatternVerified: boolean;
      fixedTimingVerified: boolean;
      pattern: (typeof job.charts)[number]["pattern"];
    }[];
  };
  const sha = (bytes: string | Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  if (
    report.sscSha256 !== sha(text) ||
    report.charts.length !== 4 ||
    [
      "dsp_patterns.py",
      "arrows.py",
      "gen.py",
      "data.py",
      "features.py",
      "feet.py",
      "steps.py",
    ].some(
      (name) =>
        report.generatorSources[name] !==
        sha(readFileSync(join("scripts/chartnet", name))),
    )
  )
    throw Error(`${job.id}: stale or unverified pattern generation`);
  if (sim.charts.length !== 4)
    throw Error(`${job.id}: expected four playable charts`);
  for (const expected of job.charts) {
    const chart = sim.charts.find((c) => c.difficulty === expected.level);
    if (!chart) throw Error(`${job.id}: missing ${expected.level}`);
    const verified = report.charts.find((c) => c.level === expected.level);
    const pattern = expected.pattern;
    if (
      !verified?.finalPatternVerified ||
      !verified.fixedTimingVerified ||
      !pattern ||
      pattern.allowHolds !== false ||
      pattern.allowCrossovers !== false ||
      verified.pattern.maxPanels !== pattern.maxPanels ||
      verified.pattern.allowHolds !== pattern.allowHolds ||
      verified.pattern.allowCrossovers !== pattern.allowCrossovers ||
      JSON.stringify(verified.pattern.allowedPanels) !==
        JSON.stringify(pattern.allowedPanels)
    )
      throw Error(
        `${job.id}/${expected.level}: pattern constraints were not verified`,
      );
    const notes = placeChart(sim, chart, "check", "generated").notes;
    const counts = new Map<number, number>();
    for (const note of notes) {
      if (note.kind !== "tap" || !pattern.allowedPanels.includes(note.column))
        throw Error(`${job.id}/${expected.level}: illegal panel or hold`);
      counts.set(note.time, (counts.get(note.time) ?? 0) + 1);
    }
    if ([...counts.values()].some((count) => count > pattern.maxPanels))
      throw Error(`${job.id}/${expected.level}: too many simultaneous panels`);
    const heads = [...new Set(notes.map((n) => n.time))].sort((a, b) => a - b);
    if (
      heads.length !== expected.times.length ||
      heads.some((t, i) => Math.abs(t - expected.times[i]!) > 0.0001)
    )
      throw Error(`${job.id}/${expected.level}: SSC changed DSP timing`);
  }
  const id = `dsp-${job.id}`,
    simfile = `games/fusemania/charts/dsp/${id}.ssc`;
  manifest[source.simfile ? id : source.id] = report;
  if (!source.simfile) {
    pending.push({ path: `games/fusemania/charts/${source.id}.ssc`, text });
    specs.delete(id);
    canonical++;
    continue;
  }
  pending.push({ path: simfile, text });
  specs.set(id, {
    ...source,
    id,
    pack: "dsp-rhythm",
    simfile,
    previewOf: source.id,
  });
}
for (const file of pending) writeFileSync(file.path, file.text);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(
  "scripts/lib/fusemania/dsp-songs.ts",
  `// Generated by scripts/chartnet/bundle-dsp-charts.ts. Separate experimental charts; original references stay intact.\nexport const DSP_SONGS = ${JSON.stringify(
    [...specs.values()].sort((a, b) => a.id.localeCompare(b.id)),
    null,
    2,
  )} as const;\n`,
);
console.log(
  `Registered ${jobs.length} songs / ${jobs.length * 4} charts with fixed DSP timing (${canonical} normal game songs)`,
);
