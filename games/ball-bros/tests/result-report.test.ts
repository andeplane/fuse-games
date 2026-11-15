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
  place: 2,
  alive: false,
  saves: 0,
  broken: 0,
  armor: 0,
  ...fields,
});
const result = (fields: Partial<Result> = {}): Result => ({
  title: "BO WINS",
  map: "CLASSIC CIRCUIT",
  rows: [
    row({
      id: "b",
      slot: 1,
      name: "Bo",
      place: 1,
      alive: true,
      saves: 9,
      broken: 14,
      armor: 31,
    }),
    row({ you: true, saves: 9, broken: 6, armor: 12 }),
    row({ id: "bot-1", slot: 2, name: "Sparks", bot: true, broken: 14 }),
  ],
  winnerSlot: 1,
  solo: false,
  host: true,
  waiting: "",
  ...fields,
});
const parts = {
  color: (slot: number) => COLORS[slot]!,
  friend: (id: string) =>
    ({ textContent: `+ ADD FRIEND ${id}` }) as HTMLElement,
};

test("a round's result: the winner in their colour, each player's saves, breaks and armor, and a friend button per other human", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "BALL BROS");
  assert.equal(report.context, "CLASSIC CIRCUIT · 3 players");
  assert.equal(report.headline, "BO WINS");
  assert.equal(report.summary, "9 saves · 14 blocks broken");
  assert.equal(report.accent, COLORS[1]);
  assert.deepEqual(report.standings!.columns, ["SAVES", "BREAKS", "ARMOR"]);
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
      [
        1,
        "Bo",
        COLORS[1],
        false,
        undefined,
        "+ ADD FRIEND b",
        ["9", "14", "31"],
      ],
      [2, "Ada", COLORS[0], true, undefined, undefined, ["9", "6", "LOST"]],
      [2, "Sparks", COLORS[2], false, "AI", undefined, ["0", "14", "LOST"]],
    ],
  );
});

test("highlights go to whoever earned them, shared between equals, and only a core still standing has armor to show", () => {
  const cards = resultReport(result(), parts).highlights!.cards;
  assert.deepEqual(
    cards.map((card) => [
      card.icon,
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["◎", "Goalkeeper", ["Bo", "Ada"], "9 saves off the paddle."],
      ["✕", "Wrecking ball", ["Bo", "Sparks"], "Broke 14 enemy blocks."],
      ["▣", "Iron wall", ["Bo"], "31 armor blocks still standing."],
    ],
  );
  assert.equal(cards[0]!.winners[1]!.color, COLORS[0]);
  const quiet = resultReport(
    result({ rows: [row({ place: 1 }), row({ id: "b", slot: 1, place: 1 })] }),
    parts,
  );
  assert.deepEqual(quiet.highlights!.cards, []);
});

test("a draw has no winner's colour, and a solo run no friend buttons", () => {
  const draw = resultReport(
    result({ title: "ROUND DRAW", winnerSlot: -1 }),
    parts,
  );
  assert.equal(draw.headline, "ROUND DRAW");
  assert.equal(draw.accent, undefined);
  assert.equal(draw.summary, "Nobody was the last core standing");
  const solo = resultReport(result({ solo: true }), parts);
  assert.ok(solo.standings!.rows.every((entry) => !entry.friend));
  const bare = resultReport(result(), { color: parts.color });
  assert.ok(bare.standings!.rows.every((entry) => !entry.friend));
});

test("the bar: the host's next steps, a line for whoever waits, and a solo run's retry", () => {
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
  assert.deepEqual(resultBar(result({ solo: true })), {
    actions: [{ id: "rematch", label: "PLAY AGAIN", primary: true }],
  });
});
