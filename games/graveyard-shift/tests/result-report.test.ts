import assert from "node:assert/strict";
import { test } from "node:test";
import { toView } from "../src/engine/view.js";
import { createWorld } from "../src/engine/world.js";
import type { View } from "../src/online/game.js";
import {
  resultBar,
  resultReport,
  shiftResult,
  type Result,
  type ResultRow,
} from "../src/app/result-report.js";

const COLORS = ["#64e4ef", "#ff927c", "#edc75b"];
const seat = (
  id: string,
  slot: number,
  name: string,
  fields: Partial<View["seats"][number]> = {},
): View["seats"][number] => ({
  id,
  slot,
  name,
  avatarId: "",
  connected: true,
  bot: false,
  ...fields,
});
/** A finished shift: Ada banked 9, Bo 9 with a wraith and a wisp still in the tank, the bot 2. */
function frame(fields: Partial<View> = {}): View {
  const world = createWorld(7, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
    { id: "bot:1", slot: 2 },
  ]);
  world.ghosts = [
    {
      id: 1,
      kind: 4,
      x: 0,
      y: 0,
      resistance: 0,
      emerge: 0,
      tug: 0,
      claim: [],
      carrier: "b",
    },
    {
      id: 2,
      kind: 1,
      x: 0,
      y: 0,
      resistance: 0,
      emerge: 0,
      tug: 0,
      claim: [],
      carrier: "b",
    },
  ];
  const [ada, bo, bot] = world.hunters;
  ada!.score = 9;
  bo!.score = 9;
  bo!.tank = [1, 2];
  bot!.score = 2;
  return {
    tick: 1800,
    matchId: "m",
    stage: "over",
    seats: [
      seat("a", 0, "Ada"),
      seat("b", 1, "Bo"),
      seat("bot:1", 2, "Mort", { bot: true }),
      seat("w", -1, "Wes", { watcher: true }),
    ],
    ready: { b: true },
    world: toView(world),
    ...fields,
  };
}
const me = { self: "a", host: true, solo: false };
const row = (fields: Partial<ResultRow>): ResultRow => ({
  id: "a",
  slot: 0,
  name: "Ada",
  you: false,
  bot: false,
  place: 1,
  banked: 0,
  ghosts: 0,
  unbanked: 0,
  ...fields,
});
const result = (fields: Partial<Result> = {}): Result => ({
  title: "BO WINS THE SHIFT",
  rows: [
    row({ id: "b", slot: 1, name: "Bo", banked: 12, ghosts: 1, unbanked: 4 }),
    row({ you: true, place: 2, banked: 7, ghosts: 2, unbanked: 5 }),
    row({ id: "bot:1", slot: 2, name: "Mort", bot: true, place: 3, ghosts: 2 }),
  ],
  winnerSlot: 1,
  solo: false,
  host: true,
  seated: true,
  ready: false,
  waiting: "1/2 ready",
  ...fields,
});
const parts = {
  color: (slot: number) => COLORS[slot]!,
  friend: (id: string) =>
    ({ textContent: `+ ADD FRIEND ${id}` }) as HTMLElement,
};

test("there is no result until the shift is over", () => {
  assert.equal(shiftResult(frame({ stage: "running" }), me), undefined);
  assert.equal(shiftResult(frame({ world: null }), me), undefined);
});

test("a finished shift: equal banked scores share first place, with what each hunter left in the tank and who is ready", () => {
  const shift = shiftResult(frame(), me)!;
  assert.equal(shift.title, "SHARED VICTORY");
  assert.equal(shift.winnerSlot, -1);
  assert.deepEqual(
    shift.rows.map((r) => [
      r.place,
      r.name,
      r.you,
      r.bot,
      r.banked,
      r.ghosts,
      r.unbanked,
    ]),
    [
      [1, "Ada", true, false, 9, 0, 0],
      [1, "Bo", false, false, 9, 2, 5],
      [3, "Mort", false, true, 2, 0, 0],
    ],
  );
  assert.equal(shift.waiting, "1/2 ready");
  assert.equal(shift.ready, false);
  assert.equal(shift.seated, true);
});

test("one winner is named; a hunter who left keeps their place, and a watcher has no ready button", () => {
  const view = frame();
  view.world!.hunters[1]!.score = 3;
  view.seats = view.seats.filter((s) => s.id !== "b");
  const shift = shiftResult(view, { self: "w", host: false, solo: false })!;
  assert.equal(shift.title, "ADA WINS THE SHIFT");
  assert.equal(shift.winnerSlot, 0);
  assert.deepEqual(
    shift.rows.map((r) => [r.place, r.name, r.slot]),
    [
      [1, "Ada", 0],
      [2, "Hunter", 1],
      [3, "Mort", 2],
    ],
  );
  assert.equal(shift.seated, false);
  assert.equal(shift.waiting, "0/1 ready");
});

test("nobody banked anything: the ghosts win and nobody is the winner", () => {
  const view = frame();
  for (const hunter of view.world!.hunters) hunter.score = 0;
  const shift = shiftResult(view, { ...me, solo: true })!;
  assert.equal(shift.title, "THE GHOSTS WIN");
  assert.equal(shift.winnerSlot, -1);
  assert.equal(shift.waiting, "");
});

test("the report: the winner in their colour, each hunter's banked, tank and unbanked energy, and a friend button per other human", () => {
  const report = resultReport(result(), parts);
  assert.equal(report.game, "GRAVEYARD SHIFT");
  assert.equal(report.context, "90 seconds · 3 hunters");
  assert.equal(report.headline, "BO WINS THE SHIFT");
  assert.equal(report.summary, "12 energy banked");
  assert.equal(report.accent, COLORS[1]);
  assert.deepEqual(report.standings!.columns, [
    "BANKED",
    "IN TANK",
    "UNBANKED",
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
      [1, "Bo", false, undefined, "+ ADD FRIEND b", ["12", "1", "4"]],
      [2, "Ada", true, undefined, undefined, ["7", "2", "5"]],
      [3, "Mort", false, "AI", undefined, ["0", "2", "0"]],
    ],
  );
  assert.deepEqual(
    report.highlights!.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["Shrine keeper", ["Bo"], "12 energy contained."],
      [
        "The ones that got away",
        ["Ada"],
        "5 energy still in the tank at dawn.",
      ],
      ["Heavy backpack", ["Ada", "Mort"], "2 ghosts carried to the end."],
    ],
  );
});

test("a shared or empty shift has no winner's colour, and no card nobody earned", () => {
  const report = resultReport(
    result({ title: "THE GHOSTS WIN", winnerSlot: -1, rows: [row({})] }),
    parts,
  );
  assert.equal(report.accent, undefined);
  assert.equal(report.summary, undefined);
  assert.equal(report.context, "90 seconds · 1 hunter");
  assert.deepEqual(report.highlights!.cards, []);
});

test("a solo shift offers no friend buttons", () => {
  const report = resultReport(result({ solo: true }), parts);
  assert.deepEqual(
    report.standings!.rows.map((entry) => entry.friend),
    [undefined, undefined, undefined],
  );
});

test("the bar: everybody's ready button with the count, the host's way back, and nothing to press for a watcher", () => {
  assert.deepEqual(resultBar(result()), {
    status: "1/2 ready",
    actions: [
      { id: "lobby", label: "Back to lobby" },
      {
        id: "rematch",
        label: "READY FOR REMATCH",
        primary: true,
        pressed: false,
      },
    ],
  });
  assert.deepEqual(
    resultBar(result({ host: false, ready: true, waiting: "2/3 ready" })),
    {
      status: "2/3 ready",
      actions: [
        { id: "rematch", label: "READY ✓", primary: true, pressed: true },
      ],
    },
  );
  assert.deepEqual(
    resultBar(result({ host: false, seated: false, waiting: "0/2 ready" })),
    { status: "0/2 ready", actions: [] },
  );
  assert.deepEqual(
    resultBar(result({ solo: true, waiting: "" })).actions.map((a) => a.label),
    ["Back to lobby", "PLAY AGAIN"],
  );
});
