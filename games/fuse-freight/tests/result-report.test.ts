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
  wins: 0,
  delivered: 0,
  stolen: 0,
  stranded: 0,
  ...fields,
});
const result = (fields: Partial<Result> = {}): Result => ({
  title: "BO RUNS THE DEPOT!",
  rounds: 3,
  rows: [
    row({ id: "b", slot: 1, name: "Bo", wins: 2, delivered: 14, stolen: 1 }),
    row({ you: true, place: 2, wins: 1, delivered: 9, stolen: 4, stranded: 2 }),
    row({
      id: "bot:1",
      slot: 2,
      name: "Loco Lola",
      bot: true,
      place: 3,
      delivered: 3,
      stranded: 2,
    }),
  ],
  winnerSlot: 1,
  host: true,
  waiting: "",
  ...fields,
});
const parts = {
  color: (slot: number) => COLORS[slot]!,
  friend: (id: string) =>
    ({ textContent: `+ ADD FRIEND ${id}` }) as HTMLElement,
};

test("a match's result: the winner in their colour, each driver's wins, wagons delivered, stolen and stranded, and a friend button per other human", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "FUSE FREIGHT");
  assert.equal(report.context, "3 rounds · 3 drivers");
  assert.equal(report.headline, "BO RUNS THE DEPOT!");
  assert.equal(report.summary, "2 wins · 14 wagons delivered");
  assert.equal(report.accent, COLORS[1]);
  assert.deepEqual(report.standings!.columns, [
    "WINS",
    "DELIVERED",
    "STOLEN",
    "STRANDED",
  ]);
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
      [1, "Bo", false, undefined, "+ ADD FRIEND b", ["2", "14", "1", "0"]],
      [2, "Ada", true, undefined, undefined, ["1", "9", "4", "2"]],
      [3, "Loco Lola", false, "AI", undefined, ["0", "3", "0", "2"]],
    ],
  );
  assert.deepEqual(
    report.highlights!.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["Freight baron", ["Bo"], "14 wagons delivered over the match."],
      ["Wagon thief", ["Ada"], "Cut 4 rival wagons loose."],
      [
        "Left on the track",
        ["Ada", "Loco Lola"],
        "2 wagons still in tow at the whistle.",
      ],
    ],
  );
});

test("a shared victory or the depot's win has no winner's colour or summary", () => {
  const report = resultReport(
    result({ title: "THE DEPOT WINS", winnerSlot: -1, rows: [row({})] }),
    parts,
  );
  assert.equal(report.accent, undefined);
  assert.equal(report.summary, undefined);
  assert.equal(report.context, "3 rounds · 1 driver");
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
