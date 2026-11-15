import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DUKAMOK_SONGS } from "../../../scripts/lib/fusemania/dukamok-songs.js";
import { LIBRARY, SONGS_DATA } from "../src/songs.js";
import { parseSimfile } from "../src/engine/simfile.js";
import { PACKS_DATA, COVER_IDS } from "../src/app/packs-data.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

test("DukAmok Originals ships all 47 songs and every original four-arrow chart", () => {
  assert.equal(DUKAMOK_SONGS.length, 47);
  assert.equal(
    DUKAMOK_SONGS.filter((song) => song.simfile.endsWith(".sm")).length,
    43,
  );
  assert.equal(
    DUKAMOK_SONGS.filter((song) => song.simfile.endsWith(".dwi")).length,
    4,
  );
  const pack = PACKS_DATA.find((entry) => entry.id === "dukamok-originals");
  assert.equal(pack?.songs.length, 47);
  for (const spec of DUKAMOK_SONGS) {
    assert.ok(pack?.songs.includes(spec.id), spec.id);
    const original = readFileSync(`${repo}${spec.simfile}`, "utf8");
    const source = SONGS_DATA.find((song) => song.id === spec.id);
    assert.equal(
      source?.ssc,
      original,
      `${spec.id}: original simfile preserved`,
    );
    const parsed = parseSimfile(original);
    const song = LIBRARY.song(spec.id);
    assert.ok(song, `${spec.id}: playable in the actual game library`);
    assert.equal(song.title, parsed.title);
    assert.equal(song.artist, parsed.artist);
    assert.equal(song.sampleStart, parsed.sampleStart);
    const charts = parsed.charts.filter(
      (chart) => chart.stepsType === "dance-single",
    );
    assert.equal(
      song.charts.length,
      charts.length,
      `${spec.id}: no chart dropped`,
    );
    assert.ok(song.charts.every((chart) => chart.steps > 0));
    assert.deepEqual(
      song.charts.map((chart) => chart.meter).sort((a, b) => a - b),
      charts.map((chart) => chart.meter).sort((a, b) => a - b),
    );
    assert.equal(new URL(spec.audio).origin, "https://storage.googleapis.com");
    assert.ok(spec.audioIntegrity.bytes > 0);
    assert.match(spec.audioIntegrity.sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      existsSync(`${repo}public/music/dukamok-originals`),
      false,
      "audio stays outside Git",
    );
    assert.ok(COVER_IDS.includes(spec.id));
    assert.ok(existsSync(`${repo}public/music/covers/${spec.id}.jpg`));
  }
});

test("the four DWI-only songs retain original difficulties and timing", () => {
  for (const [id, meter, bpm] of [
    ["big-blue", 12, 113],
    ["presto", 12, 136],
    ["salieri-strikes-back", 13, 241.25],
    ["utopia", 11, 166],
  ] as const) {
    const song = LIBRARY.song(`dukamok-${id}`);
    assert.ok(song, id);
    assert.equal(song.charts[0]?.name, "Hard", id);
    assert.equal(song.charts[0]?.meter, meter, id);
    assert.equal(song.bpm[1], bpm, id);
    assert.ok(song.charts[0]!.steps > 0, id);
  }
  assert.deepEqual(LIBRARY.song("dukamok-utopia")?.bpm, [88, 166]);
  assert.deepEqual(
    LIBRARY.song("dukamok-salieri-strikes-back")?.bpm,
    [140, 241.25],
  );
});
