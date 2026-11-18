import assert from "node:assert/strict";
import { test } from "node:test";
import { createMatch, getView } from "../src/engine/index.js";
import type { WorldView } from "../src/engine/view.js";
import {
  matchResult,
  resultBar,
  resultReport,
  type Result,
  type ResultRow,
} from "../src/app/result-report.js";

const COLORS = ["#6df4ed", "#ff6ec7", "#bded76"];
const row = (fields: Partial<ResultRow>): ResultRow => ({
  id: "a",
  slot: 0,
  name: "Ada",
  you: false,
  bot: false,
  place: 2,
  health: 0,
  turns: 0,
  bombs: 0,
  ...fields,
});
const result = (fields: Partial<Result> = {}): Result => ({
  title: "BO WINS!",
  turns: 9,
  rows: [
    row({ id: "b", slot: 1, name: "Bo", place: 1, health: 41, turns: 4 }),
    row({ you: true, turns: 4, bombs: 2 }),
    row({ id: "bot:1", slot: 2, name: "Rex", bot: true, turns: 1, bombs: 2 }),
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
/** A three-bird battle as the engine made it, then ended by hand. */
const over = (fields: Partial<WorldView>): WorldView => {
  const view = getView(
    createMatch("match", 42, [
      { id: "a", name: "Ada" },
      { id: "b", name: "Bo" },
      { id: "c", name: "Cy" },
    ]),
  );
  return { ...view, phase: "over", turn: 9, ...fields };
};

test("a battle still being played has no result", () => {
  assert.equal(
    matchResult(over({ phase: "aiming" }), { me: "a", host: true }),
    null,
  );
});

test("a finished battle: the survivor first, the fallen sharing second, each bird's health, turns and bombs", () => {
  const view = over({ winner: "b" });
  const players = view.players.map((p) =>
    p.id === "b"
      ? { ...p, hp: 41, ordinal: 4, ammo: 0 }
      : { ...p, hp: 0, ordinal: 3, ammo: 2 },
  );
  const made = matchResult(
    { ...view, players },
    { me: "c", host: false, bots: new Set(["a"]) },
  );
  assert.ok(made);
  assert.equal(made.title, "BO WINS!");
  assert.equal(made.turns, 9);
  assert.equal(made.winnerSlot, players.find((p) => p.id === "b")!.slot);
  assert.equal(made.host, false);
  assert.equal(made.waiting, "Waiting for the host…");
  assert.deepEqual(
    made.rows.map((r) => [r.id, r.place, r.health, r.turns, r.bombs]),
    [
      ["b", 1, 41, 4, 0],
      ["a", 2, 0, 3, 2],
      ["c", 2, 0, 3, 2],
    ],
  );
  assert.deepEqual(
    made.rows.map((r) => [r.you, r.bot]),
    [
      [false, false],
      [false, true],
      [true, false],
    ],
  );
});

test("a draw is shared by every bird", () => {
  const view = over({ winner: null });
  const made = matchResult(
    { ...view, players: view.players.map((p) => ({ ...p, hp: 0 })) },
    { me: "a", host: true },
  );
  assert.ok(made);
  assert.equal(made.title, "DRAW!");
  assert.equal(made.winnerSlot, -1);
  assert.equal(made.waiting, "");
  assert.deepEqual(
    made.rows.map((r) => r.place),
    [1, 1, 1],
  );
});

test("the report: the winner in their colour, the stat columns, and a friend button per other human", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "FUSE BIRDS");
  assert.equal(report.context, "9 turns · 3 birds");
  assert.equal(report.headline, "BO WINS!");
  assert.equal(report.summary, "41 health left after 4 turns");
  assert.equal(report.accent, COLORS[1]);
  assert.equal(report.standings!.nameLabel, "BIRD");
  assert.deepEqual(report.standings!.columns, [
    "HEALTH",
    "TURNS",
    "BOMBS LEFT",
  ]);
  const rows = report.standings!.rows;
  assert.deepEqual(
    rows.map((r) => [r.placement, r.name, r.color, r.tag, ...r.values]),
    [
      [1, "Bo", COLORS[1], undefined, "41", "4", "0"],
      [2, "Ada", COLORS[0], undefined, "OUT", "4", "2"],
      [2, "Rex", COLORS[2], "AI", "OUT", "1", "2"],
    ],
  );
  assert.equal(rows[0]!.friend?.textContent, "+ ADD FRIEND b");
  assert.equal(rows[1]!.friend, undefined);
  assert.equal(rows[1]!.you, true);
  assert.equal(rows[2]!.friend, undefined);
});

test("highlights go to whoever earned them, shared between equals", () => {
  const cards = resultReport(result(), parts).highlights!.cards;
  assert.deepEqual(
    cards.map((c) => [c.title, c.winners.map((w) => w.name), c.detail]),
    [
      ["Last bird standing", ["Bo"], "Finished with 41 health."],
      ["Busiest beak", ["Bo", "Ada"], "Played 4 turns."],
      ["Bomb hoarder", ["Ada", "Rex"], "2 Scatter Bombs never thrown."],
    ],
  );
  assert.equal(cards[1]!.winners[1]!.color, COLORS[0]);
});

test("a draw has no accent, and nothing earned means no cards", () => {
  const report = resultReport(
    result({
      title: "DRAW!",
      winnerSlot: -1,
      rows: [
        row({ place: 1 }),
        row({ id: "b", slot: 1, name: "Bo", place: 1 }),
      ],
    }),
    { color: parts.color },
  );
  assert.equal(report.accent, undefined);
  assert.equal(report.summary, "Nobody survived the last blast.");
  assert.deepEqual(report.highlights!.cards, []);
  assert.equal(report.standings!.rows[1]!.friend, undefined);
});

test("the bar: the host plays again or returns to the lobby, everybody else waits", () => {
  assert.deepEqual(resultBar(result()), {
    actions: [
      { id: "lobby", label: "Back to room" },
      { id: "rematch", label: "Rematch", primary: true },
    ],
  });
  assert.deepEqual(
    resultBar(result({ host: false, waiting: "Waiting for the host…" })),
    { status: "Waiting for the host…", actions: [] },
  );
});
