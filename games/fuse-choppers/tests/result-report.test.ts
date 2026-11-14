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
  crowns: 0,
  escapes: 0,
  crashes: 0,
  airTime: 0,
  ...fields,
});
const result = (fields: Partial<Result> = {}): Result => ({
  title: "BO RULES THE CAVE!",
  rounds: 4,
  rows: [
    row({ id: "b", slot: 1, name: "Bo", crowns: 3, escapes: 2, airTime: 95 }),
    row({ you: true, place: 2, crowns: 1, crashes: 3, airTime: 61 }),
    row({
      id: "bot:1",
      slot: 2,
      name: "Rotor Rex",
      bot: true,
      place: 3,
      crashes: 3,
      airTime: 12,
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

test("a match's result: the winner in their colour, each pilot's crowns, escapes, crashes and air time, and a friend button per other human", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "FUSE CHOPPERS");
  assert.equal(report.context, "4 rounds · 3 pilots");
  assert.equal(report.headline, "BO RULES THE CAVE!");
  assert.equal(report.summary, "3 crowns · 2 escapes");
  assert.equal(report.accent, COLORS[1]);
  assert.deepEqual(report.standings!.columns, [
    "CROWNS",
    "ESCAPES",
    "CRASHES",
    "AIR TIME",
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
      [1, "Bo", false, undefined, "+ ADD FRIEND b", ["3", "2", "0", "1:35"]],
      [2, "Ada", true, undefined, undefined, ["1", "0", "3", "1:01"]],
      [3, "Rotor Rex", false, "AI", undefined, ["0", "0", "3", "0:12"]],
    ],
  );
  assert.deepEqual(
    report.highlights!.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["Escape artist", ["Bo"], "Flew out of the cave 2 times."],
      ["Longest in the air", ["Bo"], "1:35 of flying over the match."],
      ["Crash magnet", ["Ada", "Rotor Rex"], "3 crashes."],
    ],
  );
});

test("when the cave wins there is no winner's colour or summary", () => {
  const report = resultReport(
    result({ title: "THE CAVE WINS", winnerSlot: -1, rows: [row({})] }),
    parts,
  );
  assert.equal(report.accent, undefined);
  assert.equal(report.summary, undefined);
  assert.equal(report.context, "4 rounds · 1 pilot");
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
