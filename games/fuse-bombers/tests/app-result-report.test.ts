import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchResult,
  resultBar,
  resultReport,
  type Entrant,
  type Result,
} from "../src/app/result-report.js";
import type { CastleStats } from "../src/engine/index.js";

const COLORS = ["#ff4d5e", "#4d8dff", "#5eff8a", "#ffd84d"];
const stats = (fields: Partial<CastleStats> = {}): CastleStats => ({
  volleys: 0,
  rocketsFired: 0,
  damageDealt: 0,
  kills: 0,
  gateSplits: 0,
  crates: 0,
  ghostBombs: 0,
  ghostDamage: 0,
  ...fields,
});
const entrant = (fields: Partial<Entrant>): Entrant => ({
  id: "a",
  slot: 0,
  name: "Ada",
  tag: "",
  you: false,
  bot: false,
  wins: 0,
  stats: stats(),
  ...fields,
});
const entrants = [
  entrant({ you: true, wins: 1, stats: stats({ damageDealt: 61.4 }) }),
  entrant({
    id: "b",
    slot: 1,
    name: "Bo",
    wins: 3,
    stats: stats({ damageDealt: 120.6, kills: 2 }),
  }),
  entrant({
    id: "bot:1",
    slot: 2,
    name: "Baron",
    bot: true,
    wins: 1,
    stats: stats({ damageDealt: 61.4, kills: 1, ghostBombs: 4 }),
  }),
  entrant({ id: "z", slot: 3, name: "Zed", stats: undefined }),
];
const match = { rounds: 5, target: 3, host: true };
const result = (fields: Partial<Result> = {}): Result => ({
  ...matchResult(entrants, "b", match),
  ...fields,
});
const parts = {
  color: (slot: number) => COLORS[slot]!,
  friend: (id: string) =>
    ({ textContent: `+ ADD FRIEND ${id}` }) as HTMLElement,
};

test("the result places the winner first and pilots level on round wins together", () => {
  const made = result();
  assert.equal(made.title, "BO WINS");
  assert.equal(made.winnerSlot, 1);
  assert.deepEqual(
    made.rows.map((row) => [row.id, row.place, row.wins, row.damage]),
    [
      ["b", 1, 3, 121],
      ["a", 2, 1, 61],
      ["bot:1", 2, 1, 61],
      ["z", 4, 0, 0],
    ],
  );
  // Past the round limit the room names a leader among equals: only they are first.
  const level = entrants.map((each) => ({ ...each, wins: 2 }));
  assert.deepEqual(
    matchResult(level, "bot:1", match).rows.map((row) => [row.id, row.place]),
    [
      ["bot:1", 1],
      ["a", 2],
      ["b", 2],
      ["z", 2],
    ],
  );
  const nobody = matchResult(level, null, { ...match, host: false });
  assert.deepEqual(
    [nobody.title, nobody.winnerSlot, nobody.waiting],
    ["NO WINNER", -1, "WAITING FOR THE HOST"],
  );
  assert.ok(nobody.rows.every((row) => row.place === 1));
});

test("a match's report: the winner in their colour, each pilot's wins, damage and KOs, and a friend button per other human", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "FUSE BOMBERS");
  assert.equal(report.context, "5 rounds · 4 gunships");
  assert.equal(report.headline, "BO WINS");
  assert.equal(report.summary, "3 round wins · first to 3");
  assert.equal(report.accent, COLORS[1]);
  assert.deepEqual(report.standings!.columns, ["WINS", "DAMAGE", "KOS"]);
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
        ["3", "121", "2"],
      ],
      [2, "Ada", COLORS[0], true, undefined, undefined, ["1", "61", "0"]],
      [2, "Baron", COLORS[2], false, "AI", undefined, ["1", "61", "1"]],
      [
        4,
        "Zed",
        COLORS[3],
        false,
        undefined,
        "+ ADD FRIEND z",
        ["0", "0", "0"],
      ],
    ],
  );
});

test("highlights go to whoever earned them, shared between equals, and to nobody when nobody did", () => {
  const cards = resultReport(result(), parts).highlights!.cards;
  assert.deepEqual(
    cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["Heavy hitter", ["Bo"], "121 damage dealt in the final round."],
      ["Knockout artist", ["Bo"], "2 gunships shot down in the final round."],
      [
        "Restless ghost",
        ["Baron"],
        "4 bombs dropped as a ghost in the final round.",
      ],
    ],
  );
  assert.equal(cards[2]!.winners[0]!.color, COLORS[2]);
  const quiet = entrants.map((each) => ({
    ...each,
    stats: stats({ kills: each.bot || each.you ? 1 : 0 }),
  }));
  const shared = resultReport(matchResult(quiet, "b", match), parts);
  assert.deepEqual(
    shared.highlights!.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      [
        "Knockout artist",
        ["Ada", "Baron"],
        "1 gunship shot down in the final round.",
      ],
    ],
  );
});

test("nobody won: no accent and no summary; a local seat shows what it flies with and no friend button without accounts", () => {
  const local = matchResult(
    [
      entrant({ id: "seat:0", name: "RED", tag: "WASD" }),
      entrant({ id: "seat:1", slot: 1, name: "BLUE", tag: "BOT", bot: true }),
    ],
    null,
    match,
  );
  const report = resultReport(local, { color: parts.color });
  assert.equal(report.headline, "NO WINNER");
  assert.equal(report.accent, undefined);
  assert.equal(report.summary, undefined);
  assert.deepEqual(
    report.standings!.rows.map((entry) => [entry.tag, entry.friend]),
    [
      ["WASD", undefined],
      ["AI", undefined],
    ],
  );
  assert.deepEqual(report.highlights!.cards, []);
});

test("the bar: the host's REMATCH and Back to lobby, and a wait for everybody else", () => {
  assert.deepEqual(resultBar(result()), {
    actions: [
      { id: "lobby", label: "Back to lobby" },
      { id: "rematch", label: "REMATCH", primary: true },
    ],
  });
  assert.deepEqual(
    resultBar(result({ host: false, waiting: "WAITING FOR THE HOST" })),
    { status: "WAITING FOR THE HOST", actions: [] },
  );
});
