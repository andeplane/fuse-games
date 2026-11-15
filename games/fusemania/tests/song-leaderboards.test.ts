import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  createSongLeaderboards,
  sortScoreSongs,
  type ScoreReader,
} from "../src/app/song-leaderboards.js";
import { chartSlots } from "../src/chart-slots.js";
import type { SongBoard, ScoreEntry } from "../src/song-scores.js";

const songs: SongBoard[] = [
  {
    song: "grid",
    title: "Grid",
    plays: 12,
    charts: [
      {
        chart: 0,
        difficulty: "Easy",
        meter: 3,
        version: "v1",
        top: {
          publicId: "a".repeat(20),
          name: "Ada",
          rating: 999_999,
          endedAt: 10,
        },
      },
      { chart: 1, difficulty: "Hard", meter: 8, version: "v1" },
    ],
  },
  {
    song: "other",
    title: "Another song",
    plays: 30,
    charts: [
      {
        chart: 0,
        difficulty: "Easy",
        meter: 4,
        version: "v1",
        top: { name: "Bo", rating: 0, endedAt: 10 },
      },
    ],
  },
  { song: "empty", title: "Empty", charts: [] },
];
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function setup(
  reader: ScoreReader = {
    catalog: async () => songs,
    leaderboard: async () => [],
  },
  options: Parameters<typeof createSongLeaderboards>[2] = {},
) {
  const window = new Window();
  const document = window.document as unknown as Document;
  const page = createSongLeaderboards(reader, document, {
    packs: [
      { id: "a", name: "FIRST PACK", songs: ["grid", "empty"] },
      { id: "b", name: "SECOND PACK", songs: ["other"] },
    ],
    ...options,
  });
  document.body.append(page.element);
  const click = (selector: string) =>
    page.element.querySelector<HTMLButtonElement>(selector)!.click();
  const rows = () =>
    [...page.element.querySelectorAll("tr[data-song]")].map((row) =>
      row.getAttribute("data-song"),
    );
  const change = (selector: string, value: string) => {
    const input = page.element.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(
      new window.Event(
        input.tagName === "INPUT" ? "input" : "change",
      ) as unknown as Event,
    );
  };
  return {
    page,
    document,
    click,
    rows,
    change,
    close: async () => {
      page.dispose();
      await window.happyDOM.close();
    },
  };
}

test("four hardest charts retain original IDs; Edit and duplicate names map to standard slots", () => {
  const charts = [2, 9, 5, 15, 1, 12].map((meter, chart) => ({
    chart,
    meter,
    difficulty: "Edit",
  }));
  assert.deepEqual(
    chartSlots(charts).map(({ chart, slot }) => [chart, slot]),
    [
      [2, "Easy"],
      [1, "Medium"],
      [5, "Hard"],
      [3, "Challenge"],
    ],
  );
  assert.equal(charts.length, 6);
  assert.deepEqual(
    chartSlots([{ chart: 8, difficulty: "Edit", meter: 7 }]).map(
      ({ chart, slot }) => [chart, slot],
    ),
    [[8, "Challenge"]],
  );
  assert.deepEqual(
    chartSlots(songs[0]!.charts).map((chart) => chart.slot),
    ["Easy", "Hard"],
  );
});

test("one global table sorts scores, packs and popularity; zero scores count and missing values stay last", async () => {
  const s = setup();
  await flush();
  assert.equal(s.page.element.querySelectorAll("tbody").length, 1);
  assert.equal(s.page.element.querySelectorAll("thead th").length, 7);
  assert.deepEqual(s.rows(), ["other", "empty", "grid"]);
  s.click('[aria-label="Sort by Easy top score"]');
  assert.deepEqual(s.rows(), ["grid", "other", "empty"]);
  s.click('[aria-label="Sort by Easy top score"]');
  assert.deepEqual(s.rows(), ["other", "grid", "empty"]);
  s.change(".fm-score-sort-select", "plays:desc");
  assert.deepEqual(s.rows(), ["other", "grid", "empty"]);
  s.change(".fm-score-sort-select", "pack:asc");
  assert.deepEqual(s.rows(), ["empty", "grid", "other"]);
  s.change(".fm-score-pack-filter", "SECOND PACK");
  assert.deepEqual(s.rows(), ["other"]);
  s.change(".fm-score-pack-filter", "");
  s.change("input", "first pack");
  assert.deepEqual(s.rows(), ["empty", "grid"]);
  s.change("input", "not a song");
  assert.match(s.page.element.textContent!, /No songs match/);
  await s.close();
});

test("song opens its leaderboard above the fold; Back preserves filters, sorting and focus", async () => {
  const requested: number[] = [];
  const s = setup(
    {
      catalog: async () => songs,
      leaderboard: async (_, chart) => {
        requested.push(chart);
        return [];
      },
    },
    { playHref: (song, chart) => `/play?song=${song}&chart=${chart}` },
  );
  await flush();
  s.change("input", "Grid");
  const trigger = s.page.element.querySelector<HTMLButtonElement>(
    ".fm-score-song-link",
  )!;
  trigger.focus();
  trigger.click();
  await flush();
  assert.deepEqual(requested, [1]);
  assert.equal(
    s.page.element.querySelector<HTMLElement>(".fm-score-browse")!.hidden,
    true,
  );
  assert.equal(
    s.document.activeElement,
    s.page.element.querySelector(".fm-score-detail h1"),
  );
  assert.equal(s.page.element.querySelectorAll(".fm-score-tab").length, 4);
  assert.match(
    s.page.element.querySelector(".fm-score-play")!.getAttribute("href")!,
    /song=grid&chart=1/,
  );
  assert.match(
    s.page.element.querySelector(".fm-score-board-state")!.textContent!,
    /No scores yet/,
  );
  assert.ok(s.page.back());
  assert.deepEqual(s.rows(), ["grid"]);
  assert.equal(s.document.activeElement, trigger);
  assert.equal(s.page.back(), false);
  await s.close();
});

test("Edit-only songs have real score actions and exactly four tabs, never More charts", async () => {
  const song: SongBoard = {
    song: "edits",
    title: "Edits",
    plays: 0,
    charts: [2, 9, 5, 15, 1, 12].map((meter, chart) => ({
      chart,
      meter,
      difficulty: "Edit",
      version: "v1",
    })),
  };
  const requested: number[] = [];
  const s = setup({
    catalog: async () => [song],
    leaderboard: async (_, chart) => {
      requested.push(chart);
      return [];
    },
  });
  await flush();
  assert.equal(s.page.element.querySelectorAll(".fm-score-pick").length, 4);
  assert.ok(!s.page.element.textContent!.includes("More charts"));
  s.click(".fm-score-song-link");
  await flush();
  assert.deepEqual(requested, [3]);
  s.click('.fm-score-tab[data-level="easy"]');
  await flush();
  assert.deepEqual(requested, [3, 2]);
  await s.close();
});

test("catalog and leaderboard failures retry; out-of-order responses and Back cannot replace current content", async () => {
  let failCatalog = true,
    failBoard = true;
  let resolveOld!: (players: ScoreEntry[]) => void;
  const s = setup({
    catalog: async () => {
      if (failCatalog) throw Error();
      return songs;
    },
    leaderboard: async (_, chart) => {
      if (failBoard) throw Error();
      if (chart === 0)
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      return [{ name: "Bo", rating: 500_000, endedAt: 10 }];
    },
  });
  await flush();
  assert.match(s.page.element.textContent!, /Could not load song scores/);
  failCatalog = false;
  s.click(".fm-score-browse .fm-score-retry");
  await flush();
  s.click('[data-song="grid"] .fm-score-song-link');
  await flush();
  assert.match(s.page.element.textContent!, /Could not load this leaderboard/);
  failBoard = false;
  s.click(".fm-score-ranking .fm-score-retry");
  await flush();
  assert.match(
    s.page.element.querySelector(".fm-score-ranking")!.textContent!,
    /Bo50.00%/,
  );
  s.click('[data-level="easy"].fm-score-tab');
  s.click('[data-level="hard"].fm-score-tab');
  await flush();
  resolveOld([{ name: "Stale", rating: 1_000_000, endedAt: 10 }]);
  await flush();
  assert.ok(!s.page.element.textContent!.includes("Stale"));
  s.click('[data-level="easy"].fm-score-tab');
  s.page.back();
  resolveOld([{ name: "After back", rating: 0, endedAt: 10 }]);
  await flush();
  assert.ok(!s.page.element.textContent!.includes("After back"));
  await s.close();
});

test("named leaders open player activity independently; scores never round up", async () => {
  let opened = "";
  const s = setup(undefined, {
    openPlayer: (id) => {
      opened = id;
    },
  });
  await flush();
  s.click(".fm-score-player-link");
  assert.equal(opened, "a".repeat(20));
  assert.equal(
    s.page.element.querySelector<HTMLElement>(".fm-score-detail")!.hidden,
    true,
  );
  assert.match(s.page.element.textContent!, /99.99%/);
  assert.deepEqual(
    sortScoreSongs(songs, { column: "Easy", direction: "asc" }).map(
      (song) => song.song,
    ),
    ["other", "grid", "empty"],
  );
  await s.close();
});

test("disposing during catalog load does not render a late response", async () => {
  let resolve!: (songs: SongBoard[]) => void;
  const s = setup({
    catalog: () =>
      new Promise((done) => {
        resolve = done;
      }),
    leaderboard: async () => [],
  });
  s.page.dispose();
  resolve(songs);
  await flush();
  assert.equal(s.rows().length, 0);
  await s.close();
});
