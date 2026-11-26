import assert from "node:assert/strict";
import { test } from "node:test";
import type { Model, ResultRow } from "../src/app/presenter.js";
import { resultBar, resultReport } from "../src/app/result-report.js";

type Result = NonNullable<Model["result"]>;
const COLORS = ["#16e7ff", "#ff2e9d", "#b6ff4d"];
const row = (fields: Partial<ResultRow>): ResultRow => ({
  id: "a",
  slot: 0,
  name: "Ada",
  you: false,
  bot: false,
  place: 1,
  time: null,
  points: 0,
  wins: 0,
  maps: 0,
  crashes: 0,
  ...fields,
});
const result = (fields: Partial<Result> = {}): Result => ({
  title: "BO WINS",
  level: "ROLLERS",
  rounds: 1,
  rows: [
    row({ id: "b", slot: 1, name: "Bo", time: 4210, maps: 1, wins: 1 }),
    row({ you: true, place: 2, time: 4500, maps: 1, crashes: 3 }),
    row({ id: "bot:1", slot: 2, name: "Volt", bot: true, place: 3 }),
  ],
  winnerSlot: 1,
  best: null,
  host: true,
  waiting: "",
  solo: null,
  ...fields,
});
const parts = {
  color: (slot: number) => COLORS[slot]!,
  friend: (id: string) =>
    ({ textContent: `+ ADD FRIEND ${id}` }) as HTMLElement,
};
const cardsOf = (report: ReturnType<typeof resultReport>) =>
  report.highlights!.cards.map((card) => [
    card.title,
    card.winners.map((winner) => winner.name),
    card.detail,
  ]);

test("a race's result: the winner in their colour, each rider's time, gap and crashes, and a friend button per other human", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "ELASTO FUSE");
  assert.equal(report.context, "ROLLERS · 3 riders");
  assert.equal(report.headline, "BO WINS");
  assert.equal(report.summary, "Home in 0:42.10");
  assert.equal(report.accent, COLORS[1]);
  assert.deepEqual(report.standings!.columns, ["TIME", "GAP", "CRASHES"]);
  assert.deepEqual(
    report.standings!.rows.map((entry) => [
      entry.placement,
      entry.name,
      entry.you,
      entry.tag,
      entry.friend?.textContent,
      entry.values,
    ]),
    [
      [1, "Bo", false, undefined, "+ ADD FRIEND b", ["0:42.10", "—", "0"]],
      [2, "Ada", true, undefined, undefined, ["0:45.00", "+0:02.90", "3"]],
      [3, "Volt", false, "AI", undefined, ["DNF", "—", "0"]],
    ],
  );
  // Volt never got home: no crashes there is not a clean ride.
  assert.deepEqual(cardsOf(report), [
    ["Clean ride", ["Bo"], "Home without a single crash."],
    ["Crash magnet", ["Ada"], "3 crashes."],
  ]);
});

test("a tour's result: points, maps, the whole clock for whoever rode every map, and shared cards", () => {
  const report = resultReport(
    result({
      rounds: 3,
      rows: [
        row({
          id: "b",
          slot: 1,
          name: "Bo",
          points: 24,
          wins: 1,
          maps: 3,
          time: 12000,
          crashes: 1,
        }),
        row({ place: 2, points: 18, wins: 1, maps: 2, crashes: 1 }),
      ],
    }),
    parts,
  );
  assert.equal(report.context, "3 maps · 2 riders");
  assert.equal(report.summary, "24 points · 3 / 3 maps");
  assert.deepEqual(report.standings!.columns, [
    "POINTS",
    "MAPS",
    "TIME",
    "CRASHES",
  ]);
  assert.deepEqual(
    report.standings!.rows.map((entry) => entry.values),
    [
      ["24", "3 / 3", "2:00.00", "1"],
      ["18", "2 / 3", "—", "1"],
    ],
  );
  assert.deepEqual(cardsOf(report), [
    ["Map winner", ["Bo", "Ada"], "First home on 1 map."],
    ["Crash magnet", ["Bo", "Ada"], "1 crash."],
  ]);
});

test("when nobody reaches a flower there is no winner's colour, summary or card", () => {
  const report = resultReport(
    result({ title: "RACE OVER", winnerSlot: -1, rows: [row({})] }),
    parts,
  );
  assert.equal(report.accent, undefined);
  assert.equal(report.summary, undefined);
  assert.equal(report.context, "ROLLERS · 1 rider");
  assert.deepEqual(report.highlights!.cards, []);
});

const solo = (fields: Partial<Result> = {}, mine: Partial<ResultRow> = {}) =>
  result({
    title: "ROLLERS",
    rows: [row({ you: true, time: 1110, maps: 1, ...mine })],
    winnerSlot: 0,
    solo: { level: 0, next: 1, finished: true },
    ...fields,
  });

test("a solo ride: the time against the best for the map, and no friend button", () => {
  const first = resultReport(solo(), parts);
  assert.equal(first.kicker, "MAP COMPLETE");
  assert.equal(first.context, "ROLLERS · solo ride");
  assert.equal(first.summary, "0:11.10 · NEW BEST!");
  assert.equal(first.accent, COLORS[0]);
  assert.deepEqual(first.standings!.columns, ["TIME", "BEST", "CRASHES"]);
  assert.deepEqual(first.standings!.rows[0]!.values, [
    "0:11.10",
    "0:11.10",
    "0",
  ]);
  assert.equal(first.standings!.rows[0]!.friend, undefined);
  assert.deepEqual(cardsOf(first), [
    ["New best", ["Ada"], "Your first time home on this map."],
    ["Clean ride", ["Ada"], "Home without a single crash."],
  ]);
  // Faster than the best before.
  assert.deepEqual(cardsOf(resultReport(solo({ best: 1210 }), parts))[0], [
    "New best",
    ["Ada"],
    "0:01.00 faster than your best before.",
  ]);
  // Slower, or equal, is not a new best; crashes cost the clean ride.
  for (const best of [1010, 1110]) {
    const slower = resultReport(solo({ best }, { crashes: 2 }), parts);
    assert.equal(
      slower.summary,
      `0:11.10 · best ${best === 1010 ? "0:10.10" : "0:11.10"}`,
    );
    assert.deepEqual(slower.standings!.rows[0]!.values.slice(1), [
      best === 1010 ? "0:10.10" : "0:11.10",
      "2",
    ]);
    assert.deepEqual(slower.highlights!.cards, []);
  }
});

test("a solo ride that ran out of time says so and keeps the best", () => {
  const report = resultReport(
    solo(
      {
        title: "TIME IS UP",
        winnerSlot: -1,
        best: 1010,
        solo: { level: 0, next: 1, finished: false },
      },
      { time: null, maps: 0, crashes: 4 },
    ),
    parts,
  );
  assert.equal(report.kicker, "RIDE OVER");
  assert.equal(report.headline, "TIME IS UP");
  assert.match(report.summary!, /before you reached the flower/);
  assert.equal(report.accent, undefined);
  assert.deepEqual(report.standings!.rows[0]!.values, ["DNF", "0:10.10", "4"]);
  assert.deepEqual(report.highlights!.cards, []);
});

test("the bar: the host's next steps, and for a guest what the room waits for", () => {
  assert.deepEqual(resultBar(result()), {
    actions: [
      { id: "lobby", label: "Back to lobby" },
      { id: "rematch", label: "REMATCH", primary: true },
    ],
  });
  assert.deepEqual(
    resultBar(
      result({
        host: false,
        waiting: "Waiting for the host to start a rematch",
      }),
    ),
    { status: "Waiting for the host to start a rematch", actions: [] },
  );
});

test("a solo ride's bar leads out by itself: MENU, RETRY and NEXT MAP, the main one by whether the map was ridden home", () => {
  assert.deepEqual(resultBar(solo()), {
    back: false,
    actions: [
      { id: "menu", label: "Menu" },
      { id: "rematch", label: "Retry" },
      { id: "next", label: "NEXT MAP", primary: true },
    ],
  });
  assert.deepEqual(
    resultBar(solo({ solo: { level: 0, next: 1, finished: false } })),
    {
      back: false,
      actions: [
        { id: "menu", label: "Menu" },
        { id: "rematch", label: "RETRY", primary: true },
      ],
    },
  );
  assert.deepEqual(
    resultBar(
      solo({ solo: { level: 100, next: 101, finished: true, random: true } }),
    ).actions,
    [
      { id: "menu", label: "Menu" },
      { id: "rematch", label: "Play random again", primary: true },
    ],
  );
});
