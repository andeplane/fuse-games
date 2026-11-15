import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchResult,
  resultBar,
  resultReport,
  type Result,
  type ResultRow,
  type RoundFacts,
} from "../src/app/result-report.js";

const COLORS = ["#ffb35c", "#6fd3ff", "#b6ff4d", "#ff7ad9"];
type Tally = RoundFacts["keepers"][number]["tally"];
const tally = (fields: Partial<Tally> = {}): Tally => ({
  thrown: 0,
  knockouts: 0,
  selfKnockouts: 0,
  bombed: 0,
  zapped: 0,
  falls: 0,
  fate: "",
  by: "",
  powerUps: 0,
  ...fields,
});
const facts = (fields: Partial<RoundFacts> = {}): RoundFacts => ({
  map: "spire",
  bombMode: "fuse",
  powers: ["shield"],
  contest: {
    phase: "over",
    elapsed: 3600,
    seconds: 0,
    rules: "score",
    entries: [
      { id: "a", slot: 0, score: 2, out: false },
      { id: "b", slot: 1, score: 5, out: false },
      { id: "bot:1", slot: 2, score: 2, out: false },
      { id: "gone", slot: 3, score: 4, out: true },
    ],
    winners: ["b"],
  },
  keepers: [
    { id: "a", name: "Ada", bot: false, tally: tally({ falls: 2 }) },
    {
      id: "b",
      name: "Bo",
      bot: false,
      tally: tally({ knockouts: 3, thrown: 7, powerUps: 1 }),
    },
    {
      id: "bot:1",
      name: "Wick",
      bot: true,
      tally: tally({ selfKnockouts: 1, thrown: 4, falls: 2 }),
    },
  ],
  ...fields,
});
const parts = {
  color: (slot: number) => COLORS[slot]!,
  friend: (id: string) =>
    ({ textContent: `+ ADD FRIEND ${id}` }) as HTMLElement,
};
const some = (result: Result | null): Result => {
  assert.ok(result);
  return result;
};

test("there is a result only once a competitive round is over", () => {
  const view = facts();
  assert.equal(
    matchResult(
      { ...view, contest: { ...view.contest, phase: "active" } },
      "a",
      true,
    ),
    null,
  );
  assert.equal(
    matchResult(
      { ...view, contest: { ...view.contest, rules: "free" } },
      "a",
      true,
    ),
    null,
  );
});

test("a score round: ranked by score with ties sharing a place, and a keeper who left last", () => {
  const result = some(matchResult(facts(), "a", false));
  assert.deepEqual(
    result.rows.map((row) => [row.place, row.name, row.you, row.bot]),
    [
      [1, "Bo", false, false],
      [2, "Ada", true, false],
      [2, "Wick", false, true],
      [4, "Keeper", false, false],
    ],
  );
  assert.equal(result.winnerSlot, 1);
  const report = resultReport(result, parts);
  assert.equal(report.game, "HOOK HAVOK");
  assert.equal(report.context, "Hook score · Neon Spire · 4 keepers");
  assert.equal(report.headline, "BO WINS");
  assert.equal(report.summary, "5 points");
  assert.equal(report.accent, COLORS[1]);
  assert.deepEqual(report.standings!.columns, [
    "SCORE",
    "KOS",
    "FALLS",
    "BOMBS",
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
      [1, "Bo", false, undefined, "+ ADD FRIEND b", ["5", "3", "0", "7"]],
      [2, "Ada", true, undefined, undefined, ["2", "0", "2", "0"]],
      [2, "Wick", false, "AI", undefined, ["2", "0", "2", "4"]],
      [
        4,
        "Keeper",
        false,
        undefined,
        "+ ADD FRIEND gone",
        ["4", "0", "0", "0"],
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
      ["Demolisher", ["Bo"], "3 knockouts by bomb."],
      ["Pad collector", ["Bo"], "Took 1 power-up."],
      ["Own worst enemy", ["Wick"], "Caught in their own blast 1 time."],
    ],
  );
});

test("an elimination round shows how each keeper went down, and only the columns the room had on", () => {
  const view = facts({
    bombMode: "off",
    powers: [],
    contest: {
      phase: "over",
      elapsed: 900,
      seconds: 0,
      rules: "elimination",
      entries: [
        { id: "a", slot: 0, score: 0, out: true },
        { id: "b", slot: 1, score: 0, out: false },
        { id: "bot:1", slot: 2, score: 0, out: true },
      ],
      winners: ["b"],
    },
    keepers: [
      {
        id: "a",
        name: "Ada",
        bot: false,
        tally: tally({ falls: 1, fate: "fall" }),
      },
      { id: "b", name: "Bo", bot: false, tally: tally() },
      {
        id: "bot:1",
        name: "Wick",
        bot: true,
        tally: tally({ zapped: 1, fate: "hazard", by: "b" }),
      },
    ],
  });
  const report = resultReport(some(matchResult(view, "b", true)), parts);
  assert.equal(report.summary, "The last keeper standing");
  assert.deepEqual(report.standings!.columns, ["FATE"]);
  assert.deepEqual(
    report.standings!.rows.map((entry) => [
      entry.placement,
      entry.name,
      entry.values,
    ]),
    [
      [1, "Bo", ["STANDING"]],
      [2, "Ada", ["FELL"]],
      [2, "Wick", ["PUSHED"]],
    ],
  );
  assert.deepEqual(
    report.highlights!.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
    ]),
    [["Long way down", ["Ada"]]],
  );
});

test("a shared win and a draw have no winner's colour", () => {
  const view = facts();
  const shared = resultReport(
    some(
      matchResult(
        { ...view, contest: { ...view.contest, winners: ["a", "b"] } },
        "a",
        true,
      ),
    ),
    parts,
  );
  assert.equal(shared.headline, "SHARED VICTORY");
  assert.equal(shared.accent, undefined);
  assert.equal(shared.summary, undefined);
  assert.deepEqual(
    shared.standings!.rows.map((entry) => entry.placement),
    [1, 1, 3, 4],
  );
  const draw = resultReport(
    some(
      matchResult(
        { ...view, contest: { ...view.contest, winners: [] } },
        "a",
        true,
      ),
    ),
    parts,
  );
  assert.equal(draw.headline, "NO KEEPER LEFT STANDING");
  assert.equal(draw.accent, undefined);
  assert.equal(draw.summary, "The round ends in a draw.");
});

test("no highlight card when nobody earned one", () => {
  const row: ResultRow = {
    id: "a",
    slot: 0,
    name: "Ada",
    you: true,
    bot: false,
    place: 1,
    score: 0,
    fate: "STANDING",
    knockouts: 0,
    selfKnockouts: 0,
    thrown: 0,
    falls: 0,
    powerUps: 0,
  };
  const report = resultReport(
    { ...some(matchResult(facts(), "a", true)), rows: [row] },
    parts,
  );
  assert.deepEqual(report.highlights!.cards, []);
});

test("the bar: a look at the arena for everybody, the manager's next steps, and what a guest waits for", () => {
  assert.deepEqual(resultBar(some(matchResult(facts(), "a", true))), {
    actions: [
      { id: "arena", label: "View arena" },
      { id: "free", label: "Free play" },
      { id: "rematch", label: "REMATCH", primary: true },
    ],
  });
  assert.deepEqual(resultBar(some(matchResult(facts(), "a", false))), {
    status: "Waiting for the room manager to start the next round",
    actions: [{ id: "arena", label: "View arena" }],
  });
});
