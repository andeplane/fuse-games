import assert from "node:assert/strict";
import { test } from "node:test";
import { DRAW } from "../src/engine/index.js";
import type { SlotView } from "../src/app/model.js";
import {
  matchResult,
  resultBar,
  resultReport,
  type MatchResult,
  type ResultFacts,
  type ResultRow,
} from "../src/app/result-report.js";
import type { Score, ScoreRow } from "../src/app/scoreboard.js";

const COLORS = ["#d8402a", "#3a6ae0"];
const parts = {
  color: (team: number) => COLORS[team]!,
  friend: (id: string) =>
    ({ textContent: `+ ADD FRIEND ${id}` }) as HTMLElement,
};

const slot = (fields: Partial<SlotView>): SlotView => ({
  slot: 0,
  team: 0,
  name: "Ada",
  bot: false,
  difficulty: "normal",
  self: false,
  hero: "brick",
  picked: false,
  ...fields,
});
const scoreRow = (fields: Partial<ScoreRow>): ScoreRow => ({
  seat: 0,
  team: 0,
  name: "Ada",
  kind: "brick",
  level: 1,
  gold: 0,
  items: [],
  self: false,
  respawn: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  ...fields,
});
const SLOTS = [
  slot({ self: true }),
  slot({ slot: 1, team: 1, name: "Bo" }),
  slot({ slot: 2, name: "AI · hard", bot: true, difficulty: "hard" }),
  slot({ slot: 3, team: 1, name: "Cy" }),
];
const SCORE: Score = {
  rows: [
    scoreRow({ name: "You", self: true, kills: 1, deaths: 4 }),
    scoreRow({ seat: 1, team: 1, name: "Bo", kills: 2, assists: 3 }),
    scoreRow({ seat: 2, name: "AI hard", kills: 3, deaths: 2 }),
    scoreRow({ seat: 3, team: 1, name: "Cy", kills: 5, deaths: 1, assists: 3 }),
  ],
  towers: [1, 4],
  jungle: [0, 2],
};
const facts = (fields: Partial<ResultFacts> = {}): ResultFacts => ({
  winner: 1,
  seat: 0,
  time: "12:05",
  sectors: { red: 1, neutral: 2, blue: 4 },
  seats: [
    { id: "ada", slot: 0, bot: false },
    { id: "bo", slot: 1, bot: false },
    { id: "cy", slot: 3, bot: false },
  ],
  host: true,
  ...fields,
});
const row = (fields: Partial<ResultRow>): ResultRow => ({
  id: "ada",
  slot: 0,
  team: 0,
  name: "Ada",
  hero: "brick",
  you: false,
  bot: false,
  place: 1,
  kills: 0,
  deaths: 0,
  assists: 0,
  ...fields,
});

test("a decided match lists the winning army first, each army by kills, with the riders' ids and the bots named by difficulty", () => {
  const result = matchResult(SCORE, SLOTS, facts());
  assert.equal(result.title, "DEFEAT");
  assert.deepEqual(
    result.rows.map((r) => [r.id, r.name, r.place, r.you, r.bot, r.kills]),
    [
      ["cy", "Cy", 1, false, false, 5],
      ["bo", "Bo", 1, false, false, 2],
      ["bot:2", "Hard", 2, false, true, 3],
      ["ada", "Ada", 2, true, false, 1],
    ],
  );
  assert.deepEqual(
    [result.towers, result.jungle],
    [SCORE.towers, SCORE.jungle],
  );
  assert.equal(result.waiting, "");
});

test("a draw shares first place, and a watcher reads which army won", () => {
  const draw = matchResult(SCORE, SLOTS, facts({ winner: DRAW }));
  assert.equal(draw.title, "DRAW");
  assert.ok(draw.rows.every((r) => r.place === 1));
  const watched = matchResult(SCORE, SLOTS, facts({ seat: -1, host: false }));
  assert.equal(watched.title, "BLUE WINS");
  assert.equal(watched.waiting, "Waiting for the host…");
});

test("the report: the winning army's colour, each hero's kills, deaths and assists, and a friend button per other human", () => {
  const report = resultReport(matchResult(SCORE, SLOTS, facts()), parts);
  assert.equal(report.game, "FUSE FRONT");
  assert.equal(report.context, "12:05 · 2v2");
  assert.equal(report.headline, "DEFEAT");
  assert.equal(report.summary, "Sectors: 1 red · 2 neutral · 4 blue");
  assert.equal(report.accent, COLORS[1]);
  const standings = report.standings!;
  assert.deepEqual(standings.columns, ["HERO", "KILLS", "DEATHS", "ASSISTS"]);
  assert.equal(
    standings.note,
    "Towers razed: RED 1 · BLUE 4. Jungle held: RED 0 · BLUE 2.",
  );
  assert.deepEqual(
    standings.rows.map((r) => [r.placement, r.name, r.color, r.tag, r.values]),
    [
      [1, "Cy", COLORS[1], undefined, ["BRICK", "5", "1", "3"]],
      [1, "Bo", COLORS[1], undefined, ["BRICK", "2", "0", "3"]],
      [2, "Hard", COLORS[0], "AI", ["BRICK", "3", "2", "0"]],
      [2, "Ada", COLORS[0], undefined, ["BRICK", "1", "4", "0"]],
    ],
  );
  assert.deepEqual(
    standings.rows.map((r) => r.friend?.textContent),
    ["+ ADD FRIEND cy", "+ ADD FRIEND bo", undefined, undefined],
  );
  assert.equal(standings.rows[3]!.you, true);
});

test("highlights go to whoever earned them, shared between equals, and are left out when nobody did", () => {
  const report = resultReport(matchResult(SCORE, SLOTS, facts()), parts);
  assert.deepEqual(
    report.highlights!.cards.map((c) => [
      c.icon,
      c.title,
      c.winners.map((w) => w.name),
      c.detail,
    ]),
    [
      ["◎", "Hero slayer", ["Cy"], "5 hero kills."],
      ["✦", "Wingman", ["Cy", "Bo"], "3 assists."],
      ["✕", "Fell the most", ["Ada"], "4 deaths."],
    ],
  );
  const quiet: MatchResult = {
    title: "DRAW",
    winner: DRAW,
    time: "0:30",
    sectors: { red: 1, neutral: 0, blue: 1 },
    towers: [0, 0],
    jungle: [0, 0],
    rows: [
      row({ you: true }),
      row({ id: "bot:1", slot: 1, team: 1, bot: true }),
    ],
    host: true,
    waiting: "",
  };
  const none = resultReport(quiet, parts);
  assert.deepEqual(none.highlights!.cards, []);
  assert.equal(none.accent, undefined, "a draw has no winner's colour");
  assert.equal(none.context, "0:30 · 1v1");
});

test("the bar gives the host the rematch and the lobby, and everybody else a line to wait on", () => {
  const result = matchResult(SCORE, SLOTS, facts());
  assert.deepEqual(resultBar(result), {
    actions: [
      { id: "lobby", label: "Back to lobby" },
      { id: "rematch", label: "REMATCH", primary: true },
    ],
  });
  assert.deepEqual(
    resultBar({ ...result, host: false, waiting: "Waiting for the host…" }),
    { status: "Waiting for the host…", actions: [] },
  );
});
