import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseHTML } from "linkedom";
import { createCommands } from "../src/app/commands.js";
import { mapPoint, turnFor } from "../src/app/map-turn.js";
import {
  actBattle,
  createBattle,
  tickBattle,
  type BattleAction,
  type BattleState,
} from "../src/game/simulation.js";

function panel(battle: BattleState, seat = 0) {
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  const canvas = document.createElement("canvas");
  const sent: BattleAction[] = [];
  let pointer: { x: number; y: number } | undefined;
  const commands = createCommands(
    (action) => {
      sent.push(action);
      return actBattle(battle, seat, action);
    },
    { canvas, locate: () => pointer },
    document,
  );
  document.body.append(canvas, commands.element);
  commands.update(battle, seat, "match-1");
  const refresh = () => commands.update(battle, seat, "match-1");
  const actions = () => [
    ...commands.element.querySelectorAll<HTMLButtonElement>(".fp-command"),
  ];
  const tab = (name: string) =>
    [
      ...commands.element.querySelectorAll<HTMLButtonElement>(
        ".fp-command-bar button",
      ),
    ].find((button) => button.textContent === name)!;
  return {
    document,
    canvas,
    commands,
    sent,
    refresh,
    actions,
    tab,
    point: (next: { x: number; y: number }) => (pointer = next),
  };
}

test("buying an upgrade changes the words in its button and moves nothing", () => {
  const battle = createBattle(7, "random", [false, true]);
  battle.cores[0]!.gold = 500;
  const view = panel(battle);
  const before = view.actions();
  assert.equal(before.length, 8, "the eight upgrades are on screen");
  const bar = view.commands.element.querySelector(".fp-command-bar")!;
  const order = [...view.commands.element.children];
  assert.equal(
    order.at(-1),
    bar,
    "the categories are the fixed bottom row; commands grow upwards from it",
  );
  const detail = before[0]!.querySelector(".fp-command-detail")!;
  const first = detail.textContent;
  assert.equal(first, "Lv 0 · 5g");
  before[0]!.click();
  view.refresh();
  assert.deepEqual(view.sent, [{ type: "upgrade", upgrade: "health" }]);
  assert.equal(
    before[0]!.getAttribute("aria-disabled"),
    "true",
    "the upgrade is under way",
  );
  for (let tick = 0; tick < 2000 && !battle.cores[0]!.upgrades.health; tick++)
    tickBattle(battle);
  view.refresh();
  assert.match(detail.textContent ?? "", /^Lv 1 · \d+g$/);
  const after = view.actions();
  assert.equal(after.length, before.length);
  after.forEach((button, index) =>
    assert.equal(button, before[index], "the same button, in the same place"),
  );
  assert.deepEqual([...view.commands.element.children], order);
  assert.equal(
    view.commands.element.querySelector(".fp-command-note")!.textContent,
    "",
  );
});

test("a refused command says so in the note laid over the map, not in the grid", () => {
  const battle = createBattle(7, "random", [false, true]);
  battle.cores[0]!.gold = 0;
  const view = panel(battle);
  const before = view.actions();
  before[0]!.click();
  view.refresh();
  const note = view.commands.element.querySelector(".fp-command-note")!;
  assert.match(note.textContent ?? "", /unavailable/i);
  assert.equal(note.parentElement, view.commands.element);
  assert.equal(
    note.closest(".fp-command-body"),
    null,
    "the note is outside the grid of buttons",
  );
  assert.deepEqual(view.actions(), before);
});

test("the player's own gold is on the panel, and the open category folds away", () => {
  const battle = createBattle(7, "random", [false, true]);
  battle.cores[0]!.gold = 42.9;
  battle.cores[1]!.gold = 7;
  const view = panel(battle);
  assert.equal(
    view.commands.element.querySelector(".fp-command-gold")!.textContent,
    "42 gold",
  );
  const body =
    view.commands.element.querySelector<HTMLElement>(".fp-command-body")!;
  const upgrades = view.tab("Upgrades");
  assert.equal(upgrades.getAttribute("aria-pressed"), "true");
  assert.equal(body.hidden, false);
  upgrades.click();
  assert.equal(body.hidden, true, "pressing the open category folds it");
  assert.equal(upgrades.getAttribute("aria-pressed"), "false");
  assert.equal(view.commands.key("3"), false, "a folded panel buys nothing");
  assert.deepEqual(view.sent, []);
  assert.equal(view.commands.key("e"), true);
  assert.equal(body.hidden, false, "and its key opens it again");
  view.tab("Build").click();
  assert.equal(body.hidden, false, "another category opens straight away");
});

test("a spectator and the shared screen have no commands over the map", () => {
  const battle = createBattle(7, "random", [false, true]);
  const view = panel(battle, -1);
  assert.equal(view.commands.element.hidden, true);
  assert.equal(view.commands.key("1"), false);
});

test("a click on the map picks the tower site under it, whichever way the map is turned", () => {
  const battle = createBattle(7, "random", [false, true]);
  const view = panel(battle);
  view.tab("Build").click();
  const target = battle.sites[3]!;
  view.point({ x: target.x + 0.4, y: target.y - 0.3 });
  view.canvas.dispatchEvent(
    new view.document.defaultView!.Event("click", { bubbles: true }),
  );
  const pressed = [
    ...view.commands.element.querySelectorAll(".fp-command-sites button"),
  ].map((button) => button.getAttribute("aria-pressed"));
  assert.equal(pressed.indexOf("true"), 3);
});

test("a wide map turns on a tall screen with the viewer's own base at the bottom", () => {
  assert.equal(turnFor(64, 32, 1440, 852, 0), "none", "a desktop keeps it");
  assert.equal(turnFor(64, 32, 844, 342, 1), "none", "a phone on its side too");
  assert.equal(turnFor(48, 48, 360, 700, 0), "none", "a square map never");
  assert.equal(turnFor(64, 32, 0, 0, 0), "none", "nor an unmeasured one");
  assert.equal(turnFor(64, 32, 360, 752, 0), "left");
  assert.equal(turnFor(64, 32, 360, 752, 1), "right");
  assert.equal(turnFor(64, 32, 360, 752, -1), "left", "a watcher");
  // Seat 0's core is at the map's left edge, seat 1's at its right: each sees its own at the screen's bottom.
  const bottomCentre = [0.5, 1] as const;
  assert.deepEqual(mapPoint(...bottomCentre, 64, 32, "left"), { x: 0, y: 16 });
  assert.deepEqual(mapPoint(...bottomCentre, 64, 32, "right"), {
    x: 64,
    y: 16,
  });
});

test("a point of the screen maps to one map cell and back, in every turn", () => {
  for (const turn of ["none", "left", "right"] as const)
    for (const [x, y] of [
      [0, 0],
      [63.5, 0.5],
      [10.25, 30],
      [64, 32],
    ] as const) {
      // Where the renderer draws map point (x, y), as fractions of the canvas.
      const [u, v] =
        turn === "left"
          ? [y / 32, 1 - x / 64]
          : turn === "right"
            ? [1 - y / 32, x / 64]
            : [x / 64, y / 32];
      const point = mapPoint(u, v, 64, 32, turn);
      assert.ok(Math.abs(point.x - x) < 1e-9 && Math.abs(point.y - y) < 1e-9);
    }
});

test("the match is the whole screen: fixed, unscrollable, commands laid over it", () => {
  const css = readFileSync(
    new URL("../src/app/fuseParticles.css", import.meta.url),
    "utf8",
  );
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `${selector} has a rule`);
    return css.slice(start, css.indexOf("}", start));
  };
  const match = rule(".fp-match:not([hidden])");
  assert.match(match, /position: fixed/);
  assert.match(match, /inset: 0/);
  assert.match(match, /overflow: hidden/);
  assert.match(rule(".fp-commands"), /position: absolute/);
  assert.match(rule(".fp-command-note"), /position: absolute/);
  assert.match(rule(".fp-command"), /height: 44px/);
  assert.match(
    css,
    /body:has\(\.fuseParticles-room\[data-phase="running"\]\) \{[^}]*overflow: hidden/,
  );
  assert.match(
    css,
    /\.fui-top-bar-left, \.fui-top-bar-account, \.fui-top-bar-sound\)[\s\S]*?display: none !important/,
    "in a match the top bar is its menu button alone",
  );
});
