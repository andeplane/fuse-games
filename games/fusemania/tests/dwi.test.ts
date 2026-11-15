import test from "node:test";
import assert from "node:assert/strict";
import { createLibrary } from "../src/engine/library.js";
import {
  MAX_SIMFILE_BYTES,
  SimfileError,
  parseSimfile,
  writeSsc,
} from "../src/engine/simfile.js";
import { createTiming } from "../src/engine/timing.js";

const file = (data: string, extra = "") =>
  `#TITLE:DWI test;#ARTIST:Test artist;#FILE:test.ogg;#BPM:120;#GAP:250;${extra}#SINGLE:MANIAC:9:${data};`;

test("DWI keypad taps, chords and jumps use four-panel columns and eighth-note time", () => {
  const sim = parseSimfile(file("4286AB<48>0"));
  assert.equal(sim.title, "DWI test");
  assert.equal(sim.artist, "Test artist");
  assert.equal(sim.music, "test.ogg");
  assert.equal(sim.charts[0]!.difficulty, "Hard");
  assert.equal(sim.charts[0]!.meter, 9);
  assert.deepEqual(
    sim.charts[0]!.notes.map((n) => [n.beat, n.column]),
    [
      [0, 0],
      [0.5, 1],
      [1, 2],
      [1.5, 3],
      [2, 1],
      [2, 2],
      [2.5, 0],
      [2.5, 3],
      [3, 0],
      [3, 2],
    ],
  );
});

test("DWI subdivisions return to eighths; legacy angle 192nds and modern jumps are distinct", () => {
  const notes = parseSimfile(file("(42)8[426]8{42}8`42'8<402>8")).charts[0]!
    .notes;
  assert.deepEqual(
    notes.map((n) => Math.round(n.beat * 48)),
    [0, 12, 24, 48, 56, 64, 72, 96, 99, 102, 126, 127, 128, 152, 154, 155],
  );
});

test("DWI holds end on the next arrow in their column and consume that tail", () => {
  const sim = parseSimfile(file("4!4004286!6006"));
  assert.deepEqual(sim.charts[0]!.notes, [
    { beat: 0, column: 0, kind: "hold", endBeat: 1.5 },
    { beat: 2, column: 1, kind: "tap" },
    { beat: 2.5, column: 2, kind: "tap" },
    { beat: 3, column: 3, kind: "hold", endBeat: 4.5 },
  ]);
  assert.deepEqual(parseSimfile(file("<4!48!8>0048")).charts[0]!.notes, [
    { beat: 0, column: 0, kind: "hold", endBeat: 1.5 },
    { beat: 0, column: 2, kind: "hold", endBeat: 2 },
  ]);
});

test("DWI timing converts GAP, quarter-beat change positions and millisecond freezes", () => {
  const sim = parseSimfile(
    file(
      "444444444",
      "#CHANGEBPM:8=240;#BPMCHANGE:16=60;#FREEZE:8=500;#SAMPLESTART:1:02.5;#SAMPLELENGTH:15000;",
    ),
  );
  assert.deepEqual(sim.timing, {
    offset: -0.25,
    bpms: [
      [0, 120],
      [2, 240],
      [4, 60],
    ],
    stops: [[2, 0.5]],
  });
  assert.equal(sim.sampleStart, 62.5);
  assert.equal(sim.sampleLength, 15);
  const timing = createTiming(sim.timing);
  assert.equal(timing.timeAt(0), 0.25);
  assert.equal(timing.timeAt(3), 2);
  assert.equal(timing.timeAt(4), 2.25);
});

test("DWI difficulties normalize; unsupported modes and corrupt charts cannot become four-panel play", () => {
  const sim = parseSimfile(
    file(
      "42",
      "#SINGLE:BASIC:3:42;#SINGLE:ANOTHER:6:42;#SINGLE:SMANIAC:11:42;#DOUBLE:MANIAC:9:4286:4286;#SOLO:MANIAC:9:CDEF;#SINGLE:MANIAC:9:4?2;",
    ),
  );
  assert.deepEqual(
    sim.charts.map((c) => c.difficulty),
    ["Easy", "Medium", "Challenge", "Hard"],
  );
  for (const data of [
    "0",
    "4!4",
    "<48",
    "4!",
    "4?2",
    "CDEF",
    "4".repeat(20_001),
  ])
    assert.throws(() => parseSimfile(file(data)), SimfileError);
  assert.throws(
    () => parseSimfile(file("42").replace("#BPM:120", "#BPM:0")),
    SimfileError,
  );
  assert.throws(
    () => parseSimfile(" ".repeat(MAX_SIMFILE_BYTES + 1)),
    SimfileError,
  );
});

test("DWI compiles through the public library and survives SSC export with timing and holds intact", () => {
  const source = file("4!4004286AB", "#FREEZE:8=1000;");
  const sim = parseSimfile(source);
  const exported = writeSsc(sim);
  const library = createLibrary([
    { id: "dwi", audio: "song.ogg", ssc: source },
  ]);
  const converted = createLibrary([
    { id: "dwi", audio: "song.ogg", ssc: exported },
  ]);
  assert.ok(library.song("dwi"));
  assert.deepEqual(library.song("dwi"), converted.song("dwi"));
  assert.deepEqual(library.steps("dwi", 0), converted.steps("dwi", 0));
});

test("DWI preserves repeated timing tags and rejects nested arrow groups", () => {
  const sim = parseSimfile(
    file(
      "4286",
      "#CHANGEBPM:8=240;#CHANGEBPM:16=60;#FREEZE:16=500;#FREEZE:8=1000;#SAMPLESTART:1e308:1e308;",
    ),
  );
  assert.deepEqual(sim.timing.bpms, [
    [0, 120],
    [2, 240],
    [4, 60],
  ]);
  assert.deepEqual(sim.timing.stops, [
    [2, 1],
    [4, 0.5],
  ]);
  assert.equal(sim.sampleStart, 0);
  assert.throws(
    () => parseSimfile(file("<".repeat(200_000) + "0>")),
    SimfileError,
  );
});
