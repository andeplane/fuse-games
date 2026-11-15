import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { Window } from "happy-dom";
import {
  createSongLeaderboards,
  sortScoreSongs,
  type ScoreReader,
} from "../src/app/song-leaderboards.js";
import type { SongBoard } from "../src/song-scores.js";

const songs: SongBoard[] = [
  {
    song: "grid",
    title: "Grid",
    charts: [
      {
        chart: 0,
        difficulty: "Easy",
        version: "v1",
        top: { name: "Ada", rating: 999_999, endedAt: 10 },
      },
      { chart: 1, difficulty: "Hard", version: "v1" },
    ],
  },
  { song: "other", title: "Another song", charts: [] },
];
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const doc = () =>
  parseHTML("<!doctype html><html><body></body></html>").document;
const { window: dom } = parseHTML("<!doctype html><html></html>");

test("groups songs by their real packs, sorts score columns in both directions and keeps empty charts last", async () => {
  const extra: SongBoard = {
    song: "third",
    title: "Third",
    charts: [
      {
        chart: 0,
        difficulty: "Easy",
        version: "v1",
        top: { name: "Bo", rating: 0, endedAt: 10 },
      },
    ],
  };
  const page = createSongLeaderboards(
    { catalog: async () => [...songs, extra], leaderboard: async () => [] },
    doc(),
    {
      packs: [
        { id: "first", name: "FIRST PACK", songs: ["grid", "third"] },
        { id: "second", name: "SECOND PACK", songs: ["other"] },
      ],
    },
  );
  await flush();
  assert.deepEqual(
    [...page.element.querySelectorAll("tbody")].map((body) =>
      body.getAttribute("aria-label"),
    ),
    ["FIRST PACK", "SECOND PACK"],
  );
  const sort = () =>
    page.element
      .querySelectorAll<HTMLButtonElement>("thead button")[1]!
      .click();
  sort();
  assert.equal(
    page.element.querySelectorAll("thead th")[1]!.getAttribute("aria-sort"),
    "descending",
  );
  assert.deepEqual(
    [...page.element.querySelectorAll("tr[data-song]")].map((row) =>
      row.getAttribute("data-song"),
    ),
    ["grid", "third", "other"],
  );
  sort();
  assert.deepEqual(
    [...page.element.querySelectorAll("tr[data-song]")].map((row) =>
      row.getAttribute("data-song"),
    ),
    ["third", "grid", "other"],
  );
  assert.deepEqual(
    sortScoreSongs([...songs, extra], { column: "Easy", direction: "asc" }).map(
      (song) => song.song,
    ),
    ["third", "grid", "other"],
  );
  const search = page.element.querySelector<HTMLInputElement>("input")!;
  search.value = "Another";
  search.dispatchEvent(new dom.Event("input"));
  assert.equal(page.element.querySelectorAll("tbody").length, 1);
  assert.equal(
    page.element.querySelector("tbody")!.getAttribute("aria-label"),
    "SECOND PACK",
  );
});

test("a named song leader opens shared player activity independently of the chart leaderboard", async () => {
  let opened: [string, string] | undefined;
  const withPlayer: SongBoard = {
    ...songs[0]!,
    charts: [
      {
        ...songs[0]!.charts[0]!,
        top: { ...songs[0]!.charts[0]!.top!, publicId: "a".repeat(20) },
      },
    ],
  };
  const page = createSongLeaderboards(
    { catalog: async () => [withPlayer], leaderboard: async () => [] },
    doc(),
    {
      openPlayer: (id, name) => {
        opened = [id, name];
      },
    },
  );
  await flush();
  page.element
    .querySelector<HTMLButtonElement>(".fm-score-player-link")!
    .click();
  assert.deepEqual(opened, ["a".repeat(20), "Ada"]);
});

test("all songs, four difficulty columns, blank unplayed cells and correctly formatted named leaders", async () => {
  const page = createSongLeaderboards(
    { catalog: async () => songs, leaderboard: async () => [] },
    doc(),
  );
  await flush();
  assert.equal(page.element.querySelectorAll("tr[data-song]").length, 2);
  assert.deepEqual(
    [...page.element.querySelectorAll("thead th")].map((th) => th.textContent),
    ["SONG", "Easy", "Medium", "Hard", "Challenge"],
  );
  const buttons = [
    ...page.element.querySelectorAll<HTMLButtonElement>(".fm-score-pick"),
  ];
  assert.equal(buttons[0]!.textContent, "Ada99.99%");
  assert.equal(buttons[1]!.textContent, "");
  assert.match(buttons[1]!.getAttribute("aria-label")!, /no scores yet/);
  const search = page.element.querySelector<HTMLInputElement>("input")!;
  search.value = "GRID";
  search.dispatchEvent(new dom.Event("input"));
  assert.equal(page.element.querySelectorAll("tr[data-song]").length, 1);
  search.value = "absent";
  search.dispatchEvent(new dom.Event("input"));
  assert.match(page.element.textContent!, /No songs match/);
});

test("catalog failure retries, empty leaderboard and failed leaderboard have recovery", async () => {
  let fail = true,
    failBoard = true;
  const page = createSongLeaderboards(
    {
      catalog: async () => {
        if (fail) throw new Error();
        return songs;
      },
      leaderboard: async () => {
        if (failBoard) throw new Error();
        return [];
      },
    },
    doc(),
  );
  await flush();
  assert.match(page.element.textContent!, /Could not load song scores/);
  fail = false;
  page.element.querySelector<HTMLButtonElement>("button")!.click();
  await flush();
  page.element.querySelector<HTMLButtonElement>(".fm-score-pick")!.click();
  await flush();
  assert.match(page.element.textContent!, /Could not load this leaderboard/);
  failBoard = false;
  [...page.element.querySelectorAll<HTMLButtonElement>("button")]
    .find((b) => b.textContent === "RETRY LEADERBOARD")!
    .click();
  await flush();
  assert.match(page.element.textContent!, /No verified scores yet/);
});

test("a later chart selection wins when responses arrive out of order; dispose ignores pending work", async () => {
  let resolve!: (
    players: { name: string; rating: number; endedAt: number }[],
  ) => void;
  const reader: ScoreReader = {
    catalog: async () => songs,
    leaderboard: async (_, chart) =>
      chart === 0
        ? new Promise((done) => {
            resolve = done;
          })
        : [{ name: "Bo", rating: 500_000, endedAt: 10 }],
  };
  const page = createSongLeaderboards(reader, doc());
  await flush();
  const picks =
    page.element.querySelectorAll<HTMLButtonElement>(".fm-score-pick");
  picks[0]!.click();
  picks[1]!.click();
  await flush();
  resolve([{ name: "Old response", rating: 100_000, endedAt: 10 }]);
  await flush();
  assert.match(
    page.element.querySelector(".fm-score-detail")!.textContent!,
    /Bo50.00%/,
  );
  assert.ok(!page.element.textContent!.includes("Old response"));
  page.dispose();
});

test("opening a chart moves keyboard focus to its stable heading and announces the async result", async () => {
  const window = new Window();
  // happy-dom supplies the browser capability but its separate DOM declaration needs an adapter at this boundary.
  const document = window.document as unknown as Document;
  let resolve!: (
    players: { name: string; rating: number; endedAt: number }[],
  ) => void;
  const page = createSongLeaderboards(
    {
      catalog: async () => songs,
      leaderboard: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
    document,
  );
  document.body.append(page.element);
  await flush();
  const pick = page.element.querySelector<HTMLButtonElement>(".fm-score-pick")!;
  pick.focus();
  pick.click();
  const heading = page.element.querySelector(".fm-score-detail h3")!;
  assert.equal(document.activeElement, heading);
  assert.equal(heading.getAttribute("tabindex"), "-1");
  const status = page.element.querySelector(
    '.fm-score-detail [role="status"]',
  )!;
  assert.match(status.textContent!, /Loading leaderboard/);
  resolve([{ name: "Ada", rating: 999_999, endedAt: 10 }]);
  await flush();
  assert.equal(document.activeElement, heading);
  assert.equal(status.textContent, "1 verified score.");
  assert.equal(status.getAttribute("aria-live"), "polite");
  page.dispose();
  await window.happyDOM.close();
});
