import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import type { ResultModel, ResultRow } from "../src/app/presenter.js";
import { resultBar, resultReport } from "../src/app/result-report.js";

const document = parseHTML("<!doctype html><html><body></body></html>")
  .document as unknown as Document;
const COLORS = ["#2ee6f6", "#ff5fa2"];
const row = (fields: Partial<ResultRow>): ResultRow => ({
  id: "a",
  slot: 0,
  team: 0,
  seat: "Cyan Queen",
  name: "Ada",
  you: false,
  place: 1,
  kills: 0,
  deaths: 0,
  berries: 0,
  ...fields,
});
const result = (fields: Partial<ResultModel> = {}): ResultModel => ({
  title: "YOUR TEAM WINS!",
  team: 1,
  score: "CYAN 1 – 2 PINK",
  games: [
    "Game 1, Hive: CYAN rode the snail home in 80 s",
    "Game 2, Hive: PINK filled the hive with berries in 95 s",
    "Game 3, Hive: PINK killed the enemy Queen three times in 60 s",
  ],
  rows: [
    row({
      id: "b",
      slot: 1,
      team: 1,
      seat: "Pink Queen",
      name: "Bo",
      you: true,
      kills: 4,
    }),
    row({
      id: "c",
      slot: 3,
      team: 1,
      seat: "Pink Worker",
      name: "Cy",
      deaths: 2,
      berries: 6,
    }),
    row({ place: 2, kills: 4, deaths: 3 }),
  ],
  host: true,
  waiting: "",
  ...fields,
});
const parts = {
  color: (team: number) => COLORS[team]!,
  friend: (id: string) => {
    const button = document.createElement("button");
    button.textContent = `+ ADD FRIEND ${id}`;
    return button;
  },
  document,
};

test("a set's result: the winning team's colour, each player's seat, kills, deaths and berries, and the games under the standings", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "KILLER FUSE");
  assert.equal(report.kicker, "SET COMPLETE");
  assert.equal(report.context, "3 games · 3 players");
  assert.equal(report.headline, "YOUR TEAM WINS!");
  assert.equal(report.summary, "CYAN 1 – 2 PINK");
  assert.equal(report.accent, COLORS[1]);
  assert.deepEqual(report.standings!.columns, ["KILLS", "DEATHS", "BERRIES"]);
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
      [1, "Bo", COLORS[1], true, "Pink Queen", undefined, ["4", "0", "0"]],
      [
        1,
        "Cy",
        COLORS[1],
        false,
        "Pink Worker",
        "+ ADD FRIEND c",
        ["0", "2", "6"],
      ],
      [
        2,
        "Ada",
        COLORS[0],
        false,
        "Cyan Queen",
        "+ ADD FRIEND a",
        ["4", "3", "0"],
      ],
    ],
  );
  assert.deepEqual(
    report.highlights!.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["Deadliest", ["Bo", "Ada"], "4 kills."],
      ["Berry runner", ["Cy"], "6 berries carried home."],
      ["Untouchable", ["Bo"], "Not one death in the whole set."],
    ],
  );
  const [games] = report.sections!;
  assert.equal(games!.title, "GAME BY GAME");
  assert.deepEqual(
    [...(games!.content[0] as HTMLElement).children].map(
      (line) => line.textContent,
    ),
    result().games,
  );
});

test("a set where nobody did anything has no cards, and one where nobody died has no Untouchable", () => {
  const quiet = resultReport(
    result({ rows: [row({ you: true }), row({ id: "b", place: 2 })] }),
    parts,
  );
  assert.deepEqual(quiet.highlights!.cards, []);
  assert.equal(quiet.standings!.rows[0]!.friend, undefined);
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
