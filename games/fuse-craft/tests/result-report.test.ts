import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMatch, loadMap, type World } from "../src/engine/index.ts";
import { reportPlayers } from "../src/app/match-report.ts";
import {
  matchResult,
  resultBar,
  resultReport,
  type MatchResult,
  type ResultContext,
  type ResultRow,
} from "../src/app/result-report.ts";

const map = loadMap(
  JSON.parse(
    readFileSync(
      new URL("../maps/cortex-crossing.json", import.meta.url),
      "utf8",
    ),
  ),
);
/** A finished three-way match: a won, b fell first, c fell last. */
function world(): World {
  const w = createMatch(map, { matchId: "result" }, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
    { id: "c", slot: 2 },
  ]);
  w.tick = 20 * 90;
  w.finished = true;
  w.winnerId = "a";
  w.victory = "elimination";
  const [a, b, c] = w.players;
  a!.territory = 40;
  a!.statistics.built = 12;
  a!.statistics.damage = 900;
  a!.research = ["growth"];
  b!.alive = c!.alive = false;
  b!.territory = c!.territory = 0;
  b!.statistics.built = 12;
  b!.statistics.lost = 9;
  c!.statistics.damage = 300;
  w.events = [
    { tick: 600, playerId: "b", type: "eliminated" },
    { tick: 1800, playerId: "c", type: "eliminated" },
  ];
  return w;
}
const context = (fields: Partial<ResultContext> = {}): ResultContext => ({
  self: "a",
  bot: (id) => id !== "a",
  openings: new Map(),
  room: null,
  ...fields,
});
const model = (w: World, fields: Partial<ResultContext> = {}) => {
  const use = context(fields);
  return matchResult(w, reportPlayers(w, use.self), use);
};

test("the winner is first and the fallen rank by how long they lasted", () => {
  const result = model(world());
  assert.equal(result.title, "Victory");
  assert.equal(result.how, "The last rival brain has been destroyed.");
  assert.equal(result.elapsed, "1:30");
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.place, row.you, row.bot]),
    [
      ["a", 1, true, false],
      ["c", 2, false, true],
      ["b", 3, false, true],
    ],
  );
  const first = result.rows[0]!;
  assert.deepEqual(
    [first.peak, first.built, first.damage, first.lost, first.research],
    [40, 12, 900, 0, 1],
  );
  assert.equal(result.accent, first.color);
  assert.equal(result.solo, true);
  assert.equal(result.again, "PLAY AGAIN");
});

test("the loser reads a defeat, a watcher a neutral win, and a draw shares first place", () => {
  assert.equal(model(world(), { self: "b" }).title, "Defeat");
  assert.equal(
    model(world(), { self: "b" }).how,
    "Your brain has been destroyed.",
  );
  const watched = model(world(), { self: null, bot: () => true });
  assert.equal(watched.title, "Blue wins");
  assert.equal(watched.again, "WATCH AGAIN");
  assert.ok(watched.rows.every((row) => !row.you && row.bot));

  const w = world();
  w.winnerId = null;
  w.victory = null;
  w.players[0]!.alive = false;
  w.events.push({ tick: 1800, playerId: "a", type: "eliminated" });
  const draw = model(w);
  assert.equal(draw.title, "Draw");
  assert.equal(draw.accent, null);
  assert.deepEqual(
    draw.rows.map((row) => [row.id, row.place]),
    [
      ["a", 1],
      ["c", 1],
      ["b", 3],
    ],
  );
});

test("a dominance win keeps the standing rivals ahead of the fallen", () => {
  const w = world();
  w.victory = "dominance";
  w.players[2]!.alive = true;
  w.events = [{ tick: 600, playerId: "b", type: "eliminated" }];
  const result = model(w, { self: null });
  assert.equal(
    result.how,
    "Blue held a dominant share of the cortex for a minute.",
  );
  assert.deepEqual(
    result.rows.map((row) => row.place),
    [1, 2, 3],
  );
});

test("the room's names, bots and host reach the result, with each AI's opening", () => {
  const w = world();
  const use = context({
    self: "c",
    bot: (id) => id === "b",
    openings: new Map([["b", "Swarm"]]),
    room: { host: false },
  });
  const names = new Map([
    ["a", "Ada"],
    ["b", "Bot"],
    ["c", "Cy"],
  ]);
  const result = matchResult(
    w,
    reportPlayers(w, "c", (id) => names.get(id)),
    use,
  );
  assert.deepEqual(
    result.rows.map((row) => [row.name, row.bot, row.you]),
    [
      ["Ada", false, false],
      ["Cy", false, true],
      ["Bot", true, false],
    ],
  );
  assert.equal(result.note, "Bot played Swarm");
  assert.equal(result.solo, false);
  assert.equal(result.host, false);
  assert.equal(result.waiting, "Waiting for the host…");
});

const row = (fields: Partial<ResultRow>): ResultRow => ({
  id: "a",
  slot: 0,
  name: "Ada",
  color: "#16e7ff",
  you: false,
  bot: false,
  place: 1,
  peak: 0,
  built: 0,
  damage: 0,
  lost: 0,
  research: 0,
  ...fields,
});
const result = (fields: Partial<MatchResult> = {}): MatchResult => ({
  title: "Defeat",
  how: "Your brain has been destroyed.",
  elapsed: "4:05",
  accent: "#16e7ff",
  rows: [
    row({ peak: 60, built: 14, damage: 800, research: 2 }),
    row({
      id: "b",
      slot: 1,
      name: "Bo",
      color: "#ff2e9d",
      you: true,
      place: 2,
      peak: 31,
      built: 14,
      damage: 200,
      lost: 9,
    }),
    row({
      id: "bot",
      slot: 2,
      name: "Green",
      color: "#b6ff4d",
      bot: true,
      place: 3,
      peak: 12,
      built: 3,
      lost: 5,
    }),
  ],
  note: "Green played Swarm",
  solo: false,
  again: "PLAY AGAIN",
  host: true,
  waiting: "",
  ...fields,
});
const node = (text: string) => ({ textContent: text }) as Node;
const parts = {
  friend: (id: string) =>
    ({ textContent: `+ ADD FRIEND ${id}` }) as HTMLElement,
  findings: [node("findings")],
  chart: [node("chart")],
  breakdown: [node("breakdown")],
};

test("a match's report: the banner in the winner's colour, each network's numbers and a friend button per other human", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "FUSE CRAFT");
  assert.equal(report.context, "4:05 elapsed · 3 networks");
  assert.equal(report.headline, "Defeat");
  assert.equal(report.summary, "Your brain has been destroyed.");
  assert.equal(report.accent, "#16e7ff");
  const standings = report.standings!;
  assert.deepEqual(standings.columns, [
    "PEAK CELLS",
    "BUILT",
    "DAMAGE",
    "LOST",
  ]);
  assert.equal(standings.note, "Green played Swarm");
  assert.deepEqual(
    standings.rows.map((r) => [r.placement, r.name, r.tag, r.values]),
    [
      [1, "Ada", undefined, ["60", "14", "800", "0"]],
      [2, "Bo", undefined, ["31", "14", "200", "9"]],
      [3, "Green", "AI", ["12", "3", "0", "5"]],
    ],
  );
  assert.deepEqual(
    standings.rows.map((r) => r.friend?.textContent),
    ["+ ADD FRIEND a", undefined, undefined],
    "not for this device's own network, nor for a bot",
  );
});

test("highlights go to whoever earned them, shared between equals", () => {
  const cards = resultReport(result(), parts).highlights!.cards;
  assert.deepEqual(
    cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
    ]),
    [
      ["Heaviest hitter", ["Ada"]],
      ["Master builder", ["Ada", "Bo"]],
      ["Deep thinker", ["Ada"]],
    ],
  );
  assert.equal(cards[1]!.detail, "14 structures grown.");
  const quiet = resultReport(
    result({ rows: [row({}), row({ id: "b", name: "Bo", place: 1 })] }),
    parts,
  );
  assert.deepEqual(quiet.highlights!.cards, []);
});

test("the chart is always showing and the breakdown waits behind the full stats", () => {
  const report = resultReport(result(), parts);
  assert.deepEqual(
    report.sections!.map((section) => [
      section.title,
      section.content[0]!.textContent,
    ]),
    [
      ["WHAT DECIDED IT", "findings"],
      ["HOW THE MATCH WENT", "chart"],
    ],
  );
  assert.equal(report.details!.content[0]!.textContent, "breakdown");
  assert.equal(report.details!.expanded, undefined);
});

test("a draw has no accent, and a local match no friend buttons", () => {
  const report = resultReport(
    result({ title: "Draw", accent: null, note: "", solo: true }),
    parts,
  );
  assert.equal(report.accent, undefined);
  assert.equal(report.standings!.note, undefined);
  assert.ok(report.standings!.rows.every((r) => r.friend === undefined));
});

test("the bar: the host's next steps, a wait for everybody else, and a local match's own way out", () => {
  assert.deepEqual(resultBar(result()), {
    actions: [
      { id: "lobby", label: "Back to lobby" },
      { id: "rematch", label: "REMATCH", primary: true },
    ],
  });
  assert.deepEqual(
    resultBar(result({ host: false, waiting: "Waiting for the host…" })),
    { status: "Waiting for the host…", actions: [] },
  );
  assert.deepEqual(
    resultBar(result({ solo: true, host: false, again: "WATCH AGAIN" })),
    {
      back: false,
      actions: [
        { id: "menu", label: "Menu" },
        { id: "rematch", label: "WATCH AGAIN", primary: true },
      ],
    },
  );
});
