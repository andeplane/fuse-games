import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResultModel, ResultRow } from "../src/app/presenter.js";
import { resultBar, resultReport } from "../src/app/result-report.js";

const COLORS = ["#16e7ff", "#ff2e9d", "#b6ff4d"];
const row = (fields: Partial<ResultRow>): ResultRow => ({
  id: "a",
  slot: 0,
  name: "Ada",
  you: false,
  bot: false,
  place: 1,
  roundWins: 0,
  rolls: 0,
  bestTurn: 0,
  busts: 0,
  ...fields,
});
const result = (fields: Partial<ResultModel> = {}): ResultModel => ({
  title: "BO WINS",
  rounds: 3,
  rows: [
    row({
      id: "b",
      slot: 1,
      name: "Bo",
      roundWins: 2,
      rolls: 31,
      bestTurn: 24,
    }),
    row({
      you: true,
      place: 2,
      roundWins: 1,
      rolls: 40,
      bestTurn: 18,
      busts: 5,
    }),
    row({
      id: "bot:1",
      slot: 2,
      name: "Bot 1",
      bot: true,
      place: 3,
      rolls: 22,
      bestTurn: 12,
      busts: 5,
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

test("a match's result: the winner in their colour, each player's rounds, rolls, best turn and busts, and a friend button per other human", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "PIG");
  assert.equal(report.context, "3 rounds · 3 players");
  assert.equal(report.headline, "BO WINS");
  assert.equal(report.summary, "2 round wins in 3 rounds");
  assert.equal(report.accent, COLORS[1]);
  assert.deepEqual(report.standings!.columns, [
    "ROUNDS",
    "ROLLS",
    "BEST TURN",
    "BUSTS",
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
      [1, "Bo", false, undefined, "+ ADD FRIEND b", ["2", "31", "24", "0"]],
      [2, "Ada", true, undefined, undefined, ["1", "40", "18", "5"]],
      [3, "Bot 1", false, "AI", undefined, ["0", "22", "12", "5"]],
    ],
  );
  assert.deepEqual(
    report.highlights!.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["Biggest turn", ["Bo"], "Banked 24 in one turn."],
      ["Kept rolling", ["Ada"], "40 rolls over the match."],
      ["Pushed their luck", ["Ada", "Bot 1"], "5 busts."],
    ],
  );
});

test("a winner who left their seat leaves no colour or summary, and nobody earns a card for nothing", () => {
  const report = resultReport(
    result({ title: "SOMEONE WINS", winnerSlot: -1, rows: [row({})] }),
    parts,
  );
  assert.equal(report.accent, undefined);
  assert.equal(report.summary, undefined);
  assert.equal(report.context, "3 rounds · 1 player");
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
