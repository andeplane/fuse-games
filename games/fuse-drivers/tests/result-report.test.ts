import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResultModel, ResultRow } from "../src/app/presenter.js";
import { resultBar, resultReport } from "../src/app/result-report.js";
import { defined } from "./fixtures/defined.js";

const COLORS = ["#16e7ff", "#ff2e9d", "#b6ff4d"];
const row = (fields: Partial<ResultRow>): ResultRow => ({
  id: "a",
  truck: 0,
  name: "Ada",
  you: false,
  bot: false,
  place: 1,
  time: 0,
  laps: 0,
  lapsLed: 0,
  nitros: 0,
  ...fields,
});
const result = (fields: Partial<ResultModel> = {}): ResultModel => ({
  title: "Bo WINS",
  track: "canyon",
  laps: 4,
  rows: [
    row({
      id: "b",
      truck: 1,
      name: "Bo",
      time: 83.43,
      laps: 4,
      lapsLed: 3,
      nitros: 2,
    }),
    row({
      you: true,
      place: 2,
      time: 90,
      laps: 4,
      lapsLed: 1,
    }),
    row({
      id: "bot:1",
      truck: 2,
      name: "Diesel",
      bot: true,
      place: 3,
      laps: 2,
      nitros: 2,
    }),
  ],
  winnerTruck: 1,
  host: true,
  waiting: "",
  ...fields,
});
const parts = {
  color: (truck: number) => defined(COLORS[truck], "colour"),
  friend: (id: string) =>
    ({ textContent: `+ ADD FRIEND ${id}` }) as HTMLElement,
};

test("the results show finish times, laps led, nitro spent and the other human drivers", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "FUSE DRIVERS");
  assert.equal(report.context, "canyon · 4 laps · 3 drivers");
  assert.equal(report.headline, "Bo WINS");
  assert.equal(report.summary, "1:23.4 over 4 laps");
  assert.equal(report.accent, COLORS[1]);
  const standings = defined(report.standings, "standings");
  assert.deepEqual(standings.columns, [
    "TIME",
    "LAPS",
    "LAPS LED",
    "NITROS USED",
  ]);
  assert.deepEqual(
    standings.rows.map((entry) => [
      entry.placement,
      entry.name,
      entry.you,
      entry.tag,
      entry.friend?.textContent,
      entry.values,
    ]),
    [
      [
        1,
        "Bo",
        false,
        undefined,
        "+ ADD FRIEND b",
        ["1:23.4", "4/4", "3", "2"],
      ],
      [2, "Ada", true, undefined, undefined, ["1:30.0", "4/4", "1", "0"]],
      [3, "Diesel", false, "AI", undefined, ["—", "2/4", "0", "2"]],
    ],
  );
  assert.deepEqual(
    defined(report.highlights, "highlights").cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["Front runner", ["Bo"], "Led 3 laps."],
      ["Nitro junkie", ["Bo", "Diesel"], "Fired 2 nitros."],
    ],
  );
});

test("a dead heat has no winner's colour or summary, and a quiet race no highlight", () => {
  const report = resultReport(
    result({
      title: "DEAD HEAT",
      winnerTruck: -1,
      rows: [row({ time: 80, laps: 4 }), row({ id: "b", truck: 1, time: 80 })],
    }),
    parts,
  );
  assert.equal(report.accent, undefined);
  assert.equal(report.summary, undefined);
  assert.equal(report.context, "canyon · 4 laps · 2 drivers");
  assert.deepEqual(defined(report.highlights, "highlights").cards, []);
});

test("the bar: the host races again or returns to the lobby, and a guest sees what the room waits for", () => {
  assert.deepEqual(resultBar(result()), {
    actions: [
      { id: "lobby", label: "Back to lobby" },
      { id: "rematch", label: "NEXT RACE", primary: true },
    ],
  });
  assert.deepEqual(
    resultBar(result({ host: false, waiting: "Waiting for the host" })),
    { status: "Waiting for the host", actions: [] },
  );
});
