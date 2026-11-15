import assert from "node:assert/strict";
import { test } from "node:test";
import type { Result, ResultRow } from "../src/app/presenter.js";
import { resultBar, resultReport } from "../src/app/result-report.js";

const COLORS = ["#4da6ff", "#ff6a3d", "#ffc23d"];
const row = (fields: Partial<ResultRow>): ResultRow => ({
  id: "a",
  slot: 0,
  name: "Ada",
  you: false,
  bot: false,
  place: 1,
  hero: "brakka",
  damage: 0,
  knockdowns: 0,
  ...fields,
});
const result = (fields: Partial<Result> = {}): Result => ({
  kind: "victory",
  title: "VICTORY",
  line: "Vorhal has fallen.",
  stages: 4,
  rows: [
    row({ id: "b", slot: 1, name: "Bo", hero: "rhea", damage: 90 }),
    row({ you: true, place: 2, damage: 60, knockdowns: 5 }),
    row({
      id: "bot:1",
      slot: 2,
      name: "Gorm",
      bot: true,
      place: 3,
      hero: "gorm",
      damage: 20,
      knockdowns: 5,
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

test("a run's result: the outcome, each hero's damage and knockouts, and a friend button per other human", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "FUSE AXE");
  assert.equal(report.context, "4 stages · 3 heroes");
  assert.equal(report.headline, "VICTORY");
  assert.equal(report.summary, "Vorhal has fallen.");
  assert.equal(report.accent, undefined, "the party wins together");
  assert.deepEqual(report.standings!.columns, ["HERO", "DAMAGE", "KO"]);
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
        ["RHEA", "90", "0"],
      ],
      [2, "Ada", COLORS[0], true, undefined, undefined, ["BRAKKA", "60", "5"]],
      [3, "Gorm", COLORS[2], false, "AI", undefined, ["GORM", "20", "5"]],
    ],
  );
  assert.deepEqual(
    report.highlights!.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["Heaviest hitter", ["Bo"], "90 damage dealt over the run."],
      ["Knockout artist", ["Ada", "Gorm"], "5 foes knocked out."],
    ],
  );
});

test("a run nobody landed a blow in has no highlight cards, and a solo run no friend buttons", () => {
  const report = resultReport(
    result({
      kind: "defeat",
      title: "GAME OVER",
      line: "STAGE 1 OF 1 · ASHEN VILLAGE",
      stages: 1,
      rows: [row({ you: true })],
    }),
    { color: parts.color },
  );
  assert.equal(report.context, "1 stage · 1 hero");
  assert.equal(report.headline, "GAME OVER");
  assert.deepEqual(report.highlights!.cards, []);
  assert.equal(report.standings!.rows[0]!.friend, undefined);
});

test("the bar: REMATCH and the lobby for the host, what they wait for for everyone else", () => {
  assert.deepEqual(resultBar(result()), {
    actions: [
      { id: "lobby", label: "Back to lobby" },
      { id: "rematch", label: "REMATCH", primary: true },
    ],
  });
  assert.deepEqual(
    resultBar(result({ host: false, waiting: "The host sets out again" })),
    { status: "The host sets out again", actions: [] },
  );
});
