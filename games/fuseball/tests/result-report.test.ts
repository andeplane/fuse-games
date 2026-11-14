import assert from "node:assert/strict";
import { test } from "node:test";
import type { Model, ResultRow } from "../src/app/presenter.js";
import { resultBar, resultReport } from "../src/app/result-report.js";

type Result = NonNullable<Model["result"]>;
const COLORS = ["#16e7ff", "#ff2e9d"];
const row = (fields: Partial<ResultRow>): ResultRow => ({
  id: "a",
  slot: 0,
  teamName: "",
  name: "Ada",
  you: false,
  bot: false,
  place: 1,
  goals: 0,
  ownGoals: 0,
  bubbles: 0,
  ...fields,
});
const result = (fields: Partial<Result> = {}): Result => ({
  title: "YOU WIN!",
  score: "Ada 3 – 1 Bo",
  rows: [
    row({ you: true, goals: 2, bubbles: 7 }),
    row({
      id: "b",
      slot: 1,
      name: "Bo",
      place: 2,
      goals: 1,
      ownGoals: 1,
      bubbles: 1,
    }),
  ],
  host: true,
  waiting: "",
  ...fields,
});
const parts = {
  color: (slot: number) => COLORS[slot]!,
  friend: (id: string) =>
    ({ textContent: `+ ADD FRIEND ${id}` }) as HTMLElement,
};

test("a duel's result: the winner in their colour, each rider's goals, own goals and bubbles, and a friend button for the other rider", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "FUSEBALL");
  assert.equal(report.context, "2 riders");
  assert.equal(report.headline, "YOU WIN!");
  assert.equal(report.summary, "Ada 3 – 1 Bo");
  assert.equal(report.accent, COLORS[0]);
  assert.deepEqual(report.standings!.columns, [
    "GOALS",
    "OWN GOALS",
    "BUBBLES",
  ]);
  assert.deepEqual(
    report.standings!.rows.map((entry) => [
      entry.placement,
      entry.name,
      entry.color,
      entry.you,
      entry.tag,
      entry.friend?.textContent,
      entry.values,
    ]),
    [
      [1, "Ada", COLORS[0], true, undefined, undefined, ["2", "0", "7"]],
      [2, "Bo", COLORS[1], false, undefined, "+ ADD FRIEND b", ["1", "1", "1"]],
    ],
  );
  assert.deepEqual(
    report.highlights!.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["Top scorer", ["Ada"], "2 goals."],
      ["Bubble machine", ["Ada"], "7 bubbles blown."],
      ["Wrong way", ["Bo"], "One ball into the other side's goal."],
    ],
  );
});

test("a team match tags each rider with their side, a bot with AI and no friend button, and shares a card between equals", () => {
  const report = resultReport(
    result({
      title: "MAGENTA WINS",
      score: "Cyan 2 – 3 Magenta",
      rows: [
        row({ id: "c", slot: 1, teamName: "Magenta", name: "Cy", goals: 2 }),
        row({
          id: "d",
          slot: 1,
          teamName: "Magenta",
          name: "Bot",
          bot: true,
          goals: 1,
        }),
        row({ teamName: "Cyan", you: true, place: 2, goals: 2 }),
        row({ id: "b", teamName: "Cyan", name: "Bo", place: 2 }),
      ],
    }),
    parts,
  );
  assert.equal(report.accent, COLORS[1]);
  assert.deepEqual(
    report.standings!.rows.map((entry) => [
      entry.placement,
      entry.tag,
      entry.friend?.textContent,
    ]),
    [
      [1, "Magenta", "+ ADD FRIEND c"],
      [1, "Magenta · AI", undefined],
      [2, "Cyan", undefined],
      [2, "Cyan", "+ ADD FRIEND b"],
    ],
  );
  // Nobody blew a bubble or scored the wrong way: only the scorers' card.
  assert.deepEqual(
    report.highlights!.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
    ]),
    [["Top scorer", ["Cy", "Ada"]]],
  );
});

test("a match nobody won has no winner's colour and no cards", () => {
  const report = resultReport(
    result({
      title: "MATCH OVER",
      rows: [row({}), row({ id: "b", slot: 1, name: "Bo" })],
    }),
    parts,
  );
  assert.equal(report.accent, undefined);
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
