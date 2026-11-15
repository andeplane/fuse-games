import test from "node:test";
import assert from "node:assert/strict";
import type { Model } from "../src/app/presenter.js";
import { resultBar, resultReport } from "../src/app/result-report.js";

type Result = NonNullable<Model["result"]>;
const row = (
  slot: number,
  place: number,
  wins: number,
  dodges: number,
  hits: number,
  more: Partial<Result["rows"][number]> = {},
): Result["rows"][number] => ({
  id: `r${slot}`,
  slot,
  name: `Rider ${slot + 1}`,
  you: false,
  bot: false,
  place,
  wins,
  dodges,
  hits,
  ...more,
});
const result = (rows: Result["rows"], more: Partial<Result> = {}): Result => ({
  title: "YOU WIN!",
  lines: [],
  rows,
  target: 3,
  host: false,
  waiting: "",
  ...more,
});
const parts = {
  color: (slot: number) => `#00000${slot}`,
  friend: (id: string) => ({ id }) as unknown as HTMLElement,
};

test("a finished match becomes the shared results report: standings, highlights and the winner's colour", () => {
  const report = resultReport(
    result([
      row(1, 1, 3, 80, 0, { you: true }),
      row(0, 2, 1, 95, 4),
      row(2, 3, 0, 40, 6, { bot: true }),
    ]),
    parts,
  );
  assert.equal(report.game, "FUSE SURGE");
  assert.equal(report.headline, "YOU WIN!");
  assert.equal(report.context, "3 riders · first to 3");
  assert.equal(report.summary, "3 round wins");
  assert.equal(report.accent, "#000001", "the winner's lane");
  assert.deepEqual(report.standings?.columns, ["ROUNDS", "DODGED", "HITS"]);
  assert.deepEqual(
    report.standings?.rows.map((each) => [
      each.placement,
      each.name,
      each.color,
      each.you,
      each.tag,
      each.values,
    ]),
    [
      [1, "Rider 2", "#000001", true, undefined, ["3", "80", "0"]],
      [2, "Rider 1", "#000000", false, undefined, ["1", "95", "4"]],
      [3, "Rider 3", "#000002", false, "AI", ["0", "40", "6"]],
    ],
  );
  // A friend button only for another human: not for this device's own rider, not for a bot.
  assert.deepEqual(
    report.standings?.rows.map((each) => each.friend !== undefined),
    [false, true, false],
  );
  assert.deepEqual(
    report.highlights?.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["Quickest feet", ["Rider 1"], "95 surges dodged."],
      ["Untouched", ["Rider 2"], "Not struck once."],
    ],
  );
});

test("a shared victory takes no one rider's colour, and the highlights say only what sets riders apart", () => {
  const shared = resultReport(
    result([row(0, 1, 1, 30, 2), row(1, 1, 1, 30, 1), row(2, 3, 0, 12, 3)], {
      title: "A DRAW: YOU SHARE IT!",
      target: 1,
    }),
    parts,
  );
  assert.equal(shared.accent, undefined);
  assert.equal(shared.summary, "1 round win");
  assert.deepEqual(
    shared.highlights?.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
      card.detail,
    ]),
    [
      ["Quickest feet", ["Rider 1", "Rider 2"], "30 surges dodged."],
      ["Hardest to hit", ["Rider 2"], "Struck once."],
    ],
  );
  // Everyone untouched, or everyone struck alike, is not a highlight; nor is a match nobody dodged in.
  const level = resultReport(
    result([row(0, 1, 1, 0, 0), row(1, 2, 0, 0, 0)]),
    parts,
  );
  assert.deepEqual(level.highlights?.cards, []);
  const tied = resultReport(
    result([row(0, 1, 1, 9, 1), row(1, 1, 1, 9, 1)]),
    parts,
  );
  assert.deepEqual(tied.highlights?.cards, [], "level on everything");
  const struck = resultReport(
    result([row(0, 1, 1, 5, 2), row(1, 2, 0, 3, 2)]),
    parts,
  );
  assert.deepEqual(
    struck.highlights?.cards.map((card) => card.title),
    ["Quickest feet"],
  );
});

test("the bar under the report: the host's next steps, and what everybody else waits for", () => {
  assert.deepEqual(resultBar(result([], { host: true })), {
    actions: [
      { id: "lobby", label: "Back to lobby" },
      { id: "rematch", label: "REMATCH", primary: true },
    ],
  });
  assert.deepEqual(
    resultBar(
      result([], { waiting: "Waiting for the host to start a rematch" }),
    ),
    { status: "Waiting for the host to start a rematch", actions: [] },
  );
});
