import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResultModel, ResultRow } from "../src/app/presenter.js";
import { resultBar, resultReport } from "../src/app/result-report.js";

const COLORS = ["#4cc9f0", "#ff6b6b", "#3ddc84"];
const row = (fields: Partial<ResultRow>): ResultRow => ({
  id: "a",
  slot: 0,
  name: "Ada",
  you: false,
  bot: false,
  place: 1,
  goals: 0,
  finished: 0,
  netWorth: 0,
  degrees: 0,
  shifts: 0,
  ...fields,
});
const result = (fields: Partial<ResultModel> = {}): ResultModel => ({
  title: "BO WINS",
  weeks: 14,
  rows: [
    row({
      id: "b",
      slot: 1,
      name: "Bo",
      goals: 100,
      finished: 14,
      netWorth: 6400,
      degrees: 2,
      shifts: 31,
    }),
    row({ you: true, place: 2, goals: 72, netWorth: 1250, shifts: 31 }),
    row({
      id: "bot:1",
      slot: 2,
      name: "Bot 3",
      bot: true,
      place: 3,
      goals: 40,
      netWorth: -80,
    }),
  ],
  winnerSlot: 1,
  local: false,
  host: true,
  waiting: "",
  ...fields,
});
const parts = {
  color: (slot: number) => COLORS[slot]!,
  friend: (id: string) =>
    ({ textContent: `+ ADD FRIEND ${id}` }) as HTMLElement,
};

test("a match's result: the winner in their colour, each player's goals, net worth, degrees and shifts, and a friend button per other human", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "FUSETOWN");
  assert.equal(report.context, "14 weeks · 3 players");
  assert.equal(report.headline, "BO WINS");
  assert.equal(report.summary, "All goals met in week 14 · net worth $6,400");
  assert.equal(report.accent, COLORS[1]);
  assert.deepEqual(report.standings!.columns, [
    "GOALS",
    "NET WORTH",
    "DEGREES",
    "SHIFTS",
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
      [
        1,
        "Bo",
        false,
        undefined,
        "+ ADD FRIEND b",
        ["100%", "$6,400", "2", "31"],
      ],
      [2, "Ada", true, undefined, undefined, ["72%", "$1,250", "0", "31"]],
      [3, "Bot 3", false, "AI", undefined, ["40%", "-$80", "0", "0"]],
    ],
  );
  assert.deepEqual(
    report.highlights!.cards.map((card) => [
      card.icon,
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["◆", "Deepest pockets", ["Bo"], "$6,400 net worth."],
      ["▲", "Top of the class", ["Bo"], "2 degrees earned."],
      ["▣", "Hardest worker", ["Bo", "Ada"], "31 shifts worked."],
    ],
  );
  assert.equal(report.highlights!.cards[2]!.winners[1]!.color, COLORS[0]);
});

test("a shared win has no accent or summary, a leader after the last week says how far they got, and nobody gets a card for nothing", () => {
  const shared = resultReport(
    result({
      title: "ADA & BO WIN",
      winnerSlot: -1,
      rows: [row({ id: "b", slot: 1, name: "Bo" }), row({})],
    }),
    { color: parts.color },
  );
  assert.equal(shared.accent, undefined);
  assert.equal(shared.summary, undefined);
  assert.deepEqual(shared.highlights!.cards, []);
  assert.deepEqual(
    shared.standings!.rows.map((entry) => [entry.placement, entry.friend]),
    [
      [1, undefined],
      [1, undefined],
    ],
  );
  const leader = resultReport(
    result({
      weeks: 1,
      rows: [row({ goals: 64, netWorth: 300, degrees: 1 })],
      winnerSlot: 0,
    }),
    parts,
  );
  assert.equal(leader.context, "1 week · 1 player");
  assert.equal(leader.summary, "64% of goals · net worth $300");
  assert.deepEqual(
    leader.highlights!.cards.map((card) => card.detail),
    ["$300 net worth.", "1 degree earned."],
  );
});

test("the bar: the host's rematch and lobby, a guest's wait, and PLAY AGAIN and MENU with no Leave on one device", () => {
  assert.deepEqual(resultBar(result()), {
    actions: [
      { id: "lobby", label: "Back to lobby" },
      { id: "rematch", label: "REMATCH", primary: true },
    ],
  });
  assert.deepEqual(
    resultBar(result({ host: false, waiting: "Waiting for the host" })),
    { status: "Waiting for the host", actions: [] },
  );
  assert.deepEqual(resultBar(result({ local: true })), {
    actions: [
      { id: "lobby", label: "MENU" },
      { id: "rematch", label: "PLAY AGAIN", primary: true },
    ],
    back: false,
  });
});
