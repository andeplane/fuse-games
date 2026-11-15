import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  SCORE_MODE,
  type ChartInfo,
  type SongInfo,
} from "../src/engine/index.js";
import { createSongPicker } from "../src/app/song-picker.js";
import { sortLabel, sortSongs } from "../src/app/song-sort.js";

const chart = (name: string, meter: number): ChartInfo => ({
  name,
  meter,
  steps: 100,
  holds: 0,
  mines: 0,
  peak: 5,
});
const song = (
  id: string,
  title: string,
  bpm: number,
  charts: ChartInfo[],
): SongInfo => ({
  id,
  title,
  artist: "x",
  audio: `${id}.mp3`,
  bpm: [bpm, bpm],
  sampleStart: 0,
  sampleLength: 10,
  charts,
  endMs: 1000,
});
const SONGS = [
  song("a", "Zebra", 150, [chart("Easy", 3), chart("Hard", 9)]),
  song("b", "apple", 90, [chart("Easy", 2), chart("Challenge", 12)]),
  song("c", "Mango", 120, [chart("Medium", 5), chart("Hard", 7)]),
];
const ids = (songs: readonly SongInfo[]) => songs.map((s) => s.id).join("");

test("sorts by title, bpm and each difficulty, in both directions", () => {
  assert.equal(
    ids(sortSongs(SONGS, { key: "title", direction: "asc" })),
    "bca",
  );
  assert.equal(
    ids(sortSongs(SONGS, { key: "title", direction: "desc" })),
    "acb",
  );
  assert.equal(ids(sortSongs(SONGS, { key: "bpm", direction: "asc" })), "bca");
  assert.equal(ids(sortSongs(SONGS, { key: "bpm", direction: "desc" })), "acb");
  assert.equal(
    ids(sortSongs(SONGS, { key: "pack", direction: "desc" })),
    "cba",
  );
});

test("a song without that difficulty goes last in either direction", () => {
  assert.equal(ids(sortSongs(SONGS, { key: "hard", direction: "asc" })), "cab");
  assert.equal(
    ids(sortSongs(SONGS, { key: "hard", direction: "desc" })),
    "acb",
  );
  assert.equal(
    ids(sortSongs(SONGS, { key: "challenge", direction: "asc" })),
    "bac",
  );
  assert.equal(ids(sortSongs(SONGS, { key: "easy", direction: "asc" })), "bac");
});

test("does not touch its input and breaks ties by the given order", () => {
  const same = [song("x", "Same", 100, []), song("y", "Same", 100, [])];
  const before = [...same];
  assert.equal(ids(sortSongs(same, { key: "bpm", direction: "asc" })), "xy");
  assert.deepEqual(same, before);
  assert.equal(sortLabel({ key: "bpm", direction: "desc" }), "BPM ↓");
});

test("the picker's sort modal reorders the carousel and keeps the selected song", () => {
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  const picker = createSongPicker({
    document: document as unknown as Document,
    songs: SONGS,
    onSong: () => {},
    onChart: () => {},
    onMode: () => {},
  });
  document.body.append(picker.element);
  const root = picker.element;
  picker.update({ song: "c", chart: 0, mode: SCORE_MODE, host: true });
  const trigger = root.querySelector<HTMLButtonElement>(".fm-picker-sort")!;
  assert.equal(trigger.hidden, false);
  const titles = () =>
    [...root.querySelectorAll(".fm-picker-row")].map(
      (row) => row.querySelector(".fm-picker-row-title")?.textContent,
    );
  assert.deepEqual(titles(), ["Zebra", "apple", "Mango"]);
  trigger.click();
  const option = (name: string) =>
    [...root.querySelectorAll<HTMLButtonElement>(".fm-sort-option")].find(
      (node) => node.textContent === name,
    )!;
  option("Title").click();
  assert.deepEqual(titles(), ["apple", "Mango", "Zebra"]);
  assert.equal(
    root.querySelector(".fm-picker-row[data-offset='0'] .fm-picker-row-title")
      ?.textContent,
    "Mango",
  );
  assert.equal(trigger.textContent, "SORTTITLE ↑");
  trigger.click();
  root.querySelectorAll<HTMLButtonElement>(".fm-sort-direction")[1]!.click();
  assert.deepEqual(titles(), ["Zebra", "Mango", "apple"]);
  // Not a host: no sort button, and the dialog's keys are not the carousel's.
  picker.update({ song: "c", chart: 0, mode: SCORE_MODE, host: false });
  assert.equal(trigger.hidden, true);
});
