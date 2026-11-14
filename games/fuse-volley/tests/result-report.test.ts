import assert from "node:assert/strict";
import { test } from "node:test";
import type { Model, ResultRow } from "../src/app/presenter.js";
import { resultBar, resultReport } from "../src/app/result-report.js";

type Result = NonNullable<Model["result"]>;
const COLORS = ["#16e7ff", "#ff2e9d", "#b6ff4d"];
const row = (fields: Partial<ResultRow>): ResultRow => ({
  id: "a",
  slot: 0,
  team: 0,
  teamName: "",
  name: "Ada",
  you: false,
  bot: false,
  place: 1,
  points: 15,
  touches: 20,
  ...fields,
});
const result = (fields: Partial<Result> = {}): Result => ({
  title: "YOU WIN!",
  score: "Ada 15 – 14 Bo",
  rows: [
    row({ you: true }),
    row({ id: "b", slot: 1, team: 1, name: "Bo", place: 2, points: 14 }),
  ],
  lines: [],
  host: true,
  waiting: "",
  ...fields,
});
const parts = {
  color: (team: number) => COLORS[team]!,
  friend: (id: string) => ({ id }) as unknown as HTMLElement,
};

test("a duel: the winner, the score, points and touches per player, and a friend button for the other human", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "FUSE VOLLEY");
  assert.equal(report.headline, "YOU WIN!");
  assert.equal(report.summary, "Ada 15 – 14 Bo");
  assert.equal(report.accent, COLORS[0]);
  assert.deepEqual(report.standings!.columns, ["POINTS", "TOUCHES"]);
  assert.deepEqual(
    report.standings!.rows.map((entry) => [
      entry.placement,
      entry.name,
      entry.you,
      entry.tag,
      entry.friend,
      entry.values,
    ]),
    [
      [1, "Ada", true, undefined, undefined, ["15", "20"]],
      [2, "Bo", false, undefined, { id: "b" }, ["14", "20"]],
    ],
  );
  // Equal touches share the card; one point apart is down to the wire.
  assert.deepEqual(
    report.highlights!.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["Busiest hands", ["Ada", "Bo"], "20 touches on the ball."],
      ["Down to the wire", ["Ada"], "15 – 14: decided by one point."],
    ],
  );
});

test("teams: teammates share a place and a colour, are tagged with their team, and bots get no friend button", () => {
  const report = resultReport(
    result({
      title: "PINK WIN",
      rows: [
        row({ id: "c", slot: 1, team: 1, teamName: "PINK", name: "Cy" }),
        row({
          id: "d",
          slot: 3,
          team: 1,
          teamName: "PINK",
          name: "Bot",
          bot: true,
          touches: 31,
        }),
        row({ teamName: "CYAN", you: true, place: 2, points: 6 }),
        row({
          id: "b",
          slot: 2,
          teamName: "CYAN",
          name: "Bo",
          place: 2,
          points: 6,
        }),
      ],
    }),
    parts,
  );
  assert.equal(report.accent, COLORS[1]);
  assert.deepEqual(
    report.standings!.rows.map((entry) => [
      entry.placement,
      entry.tag,
      entry.color,
      !!entry.friend,
    ]),
    [
      [1, "PINK", COLORS[1], true],
      [1, "PINK · AI", COLORS[1], false],
      [2, "CYAN", COLORS[0], false],
      [2, "CYAN", COLORS[0], true],
    ],
  );
  assert.deepEqual(
    report.highlights!.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
    ]),
    [
      ["Busiest hands", ["Bot"]],
      ["Clear win", ["Cy", "Bot"]],
    ],
  );
});

test("the bar: the host's REMATCH and lobby, and for a guest what the room waits for", () => {
  assert.deepEqual(
    resultBar(result()).actions.map((action) => [action.id, !!action.primary]),
    [
      ["lobby", false],
      ["rematch", true],
    ],
  );
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

test("three teams: no margin card, and a middling two-team score has none either", () => {
  const kings = resultReport(
    result({
      rows: [
        row({ teamName: "CYAN", you: true }),
        row({ id: "b", team: 1, teamName: "PINK", place: 2, points: 9 }),
        row({ id: "c", team: 2, teamName: "LIME", place: 2, points: 9 }),
      ],
    }),
    parts,
  );
  assert.deepEqual(
    kings.highlights!.cards.map((card) => card.title),
    ["Busiest hands"],
  );
  assert.deepEqual(
    kings.standings!.rows.map((entry) => entry.placement),
    [1, 2, 2],
  );
  const middling = resultReport(
    result({
      rows: [
        row({ you: true }),
        row({ id: "b", team: 1, name: "Bo", place: 2, points: 10 }),
      ],
    }),
    parts,
  );
  assert.deepEqual(
    middling.highlights!.cards.map((card) => card.title),
    ["Busiest hands"],
  );
});
