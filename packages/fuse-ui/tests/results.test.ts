import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLiveResults,
  createResultsScreen,
  renderResults,
  type ResultsReport,
  type ResultsScreen,
} from "fuse-ui";
import { HOSTILE, page } from "./dom-fixture.js";

test("live results rebuild for report changes and update the action bar every frame", () => {
  const { document } = page();
  const screen = createResultsScreen({ document, onAction() {} });
  const live = createLiveResults(screen);
  const memberIds = new Map<string, string>();
  let redraws = 0;
  const result = { host: false, waiting: "Wait", rows: [{ id: "guest" }] };
  const render = (next: typeof result, revision = "match", dismissed = false) =>
    live.render(next, {
      revision,
      friends: {
        publicIdOfMember: (id) => memberIds.get(id),
        friendButton: (id) => {
          const button = document.createElement("button");
          button.textContent = id;
          return button;
        },
      },
      report(_result, friend) {
        redraws++;
        const button = friend?.("guest");
        return {
          game: "Demo",
          headline: "Complete",
          sections: button ? [{ title: "Players", content: [button] }] : [],
        };
      },
      bar: ({ host, waiting }) => ({
        status: waiting,
        actions: host ? [{ id: "again", label: "Again", primary: true }] : [],
      }),
      afterShow() {
        if (dismissed) screen.hide();
      },
    });

  render(result);
  const reportElement = screen.body.firstElementChild;
  assert.equal(screen.open, true);
  render({ ...result, host: true, waiting: "Ready" });
  assert.equal(screen.body.firstElementChild, reportElement);
  assert.equal(screen.actions.textContent, "ReadyAgain");
  assert.equal(redraws, 1);

  memberIds.set("guest", "Friend");
  render(result);
  assert.match(screen.body.textContent ?? "", /Friend/);
  assert.equal(redraws, 2);

  render(result, "rematch", true);
  assert.equal(screen.open, false);
  assert.equal(redraws, 3);
  render(result, "rematch");
  assert.equal(screen.open, false);
  live.clear();
  render(result, "rematch");
  assert.equal(screen.open, true);
  assert.equal(redraws, 4);
});

test("only a first show with focus enabled focuses the primary action", () => {
  for (const focusPrimary of [true, false]) {
    const { document } = page();
    const calls: string[] = [];
    const actions = document.createElement("div");
    const primary = Object.assign(document.createElement("button"), {
      className: "is-primary",
      focus: () => void calls.push("focus"),
    });
    actions.append(primary);
    const screen: ResultsScreen = {
      actions,
      element: document.createElement("section"),
      body: document.createElement("div"),
      open: false,
      show: () => void calls.push("show"),
      update: () => void calls.push("bar"),
      hide() {},
    };
    const live = createLiveResults(screen, { focusPrimary });
    const result = { host: true, waiting: "", rows: [] };
    const frame = {
      report: () => ({ game: "Demo", headline: "Complete" }),
      bar: () => ({ actions: [] }),
    };
    live.render(result, frame);
    live.render(result, frame);
    assert.deepEqual(
      calls,
      focusPrimary ? ["show", "bar", "focus", "bar"] : ["show", "bar", "bar"],
    );
  }
});

const report = (document: Document): ResultsReport => {
  const friend = document.createElement("button");
  friend.textContent = "+ ADD FRIEND";
  const stats = document.createElement("p");
  stats.textContent = "Every stat";
  return {
    game: "FUSE RIDERS",
    context: "5 rounds / 2 riders",
    headline: "ADA WINS",
    summary: "11 points · 3 round wins",
    accent: "#ff2e9d",
    standings: {
      nameLabel: "RIDER",
      columns: ["POINTS", "WINS"],
      rows: [
        {
          id: "a",
          placement: 1,
          name: "Ada",
          color: "#ff2e9d",
          you: true,
          values: ["11", "3"],
        },
        {
          id: "b",
          placement: 2,
          name: HOSTILE,
          color: "#16e7ff",
          friend,
          values: ["7", "2"],
        },
      ],
      note: "Tied on points · decided by round wins",
    },
    highlights: {
      cards: [
        {
          icon: "◎",
          title: "Bullseye",
          winners: [{ name: "Ada", color: "#ff2e9d" }],
          detail: "Round 2",
        },
      ],
    },
    details: { content: [stats] },
  };
};

test("the report has the masthead, the winner, the standings with the game's columns and the highlights", () => {
  const { document } = page();
  const root = renderResults(report(document), document);
  assert.equal(
    root.querySelector(".fui-results-brand")!.textContent,
    "FUSE RIDERS",
  );
  assert.equal(
    root.querySelector(".fui-results-context")!.textContent,
    "MATCH COMPLETE5 rounds / 2 riders",
  );
  const hero = root.querySelector<HTMLElement>(".fui-results-victory")!;
  assert.equal(hero.querySelector("h2")!.textContent, "ADA WINS");
  assert.equal(hero.style.getPropertyValue("--winner-color"), "#ff2e9d");
  assert.ok(hero.querySelector(".fui-results-crown"));
  assert.deepEqual(
    [...root.querySelectorAll("thead th")].map((cell) => cell.textContent),
    ["#", "RIDER", "POINTS", "WINS"],
  );
  const rows = [...root.querySelectorAll("tbody tr")];
  assert.deepEqual(
    rows.map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    ),
    [
      ["01", "11", "3"],
      ["02", "7", "2"],
    ],
  );
  assert.equal(rows[0]!.className, "is-champion is-you");
  assert.equal(rows[0]!.querySelector("small")!.textContent, "YOU");
  // Another player keeps its friend button and has no YOU tag; its name is text, never markup.
  assert.equal(rows[1]!.querySelector("small"), null);
  assert.equal(rows[1]!.querySelector("button")!.textContent, "+ ADD FRIEND");
  assert.equal(rows[1]!.querySelector("img"), null);
  assert.equal(
    rows[1]!.querySelector(".fui-results-name > span")!.textContent,
    HOSTILE,
  );
  assert.equal(
    root.querySelector(".fui-results-feature h4")!.textContent,
    "Bullseye",
  );
  assert.equal(
    root.querySelector<HTMLElement>(".fui-results-details")!.hidden,
    true,
  );
});

test("a solo report shows an emblem for the crown, and a report with nothing to say says so", () => {
  const { document } = page();
  const solo = renderResults(
    { game: "FUSEMANIA", headline: "GRID", emblem: "AA" },
    document,
  );
  assert.equal(solo.querySelector(".fui-results-emblem")!.textContent, "AA");
  assert.equal(solo.querySelector(".fui-results-crown"), null);
  assert.equal(solo.querySelector(".fui-results-overview"), null);
  const empty = renderResults(
    { game: "FUSE RIDERS", headline: "", empty: "No rounds were played." },
    document,
  );
  assert.equal(
    empty.querySelector(".fui-results-empty")!.textContent,
    "No rounds were played.",
  );
  assert.equal(empty.querySelector(".fui-results-victory"), null);
  const none = renderResults(
    { game: "DICE", headline: "DRAW", highlights: { cards: [] } },
    document,
  );
  assert.equal(
    none.querySelector(".fui-results-note")!.textContent,
    "The standings tell the story this time.",
  );
});

test("the screen opens with the full stats closed, and its toggle opens and closes them", () => {
  const { document } = page();
  const screen = createResultsScreen({ document, onAction: () => {} });
  assert.equal(screen.open, false);
  screen.show(report(document));
  assert.equal(screen.open, true);
  const toggle = screen.element.querySelector<HTMLButtonElement>(
      ".fui-results-stats-toggle",
    )!,
    details = () =>
      screen.element.querySelector<HTMLElement>(".fui-results-details")!;
  assert.equal(toggle.hidden, false);
  toggle.click();
  assert.equal(details().hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(toggle.textContent, "Hide full stats ↗");
  toggle.click();
  assert.equal(details().hidden, true);
  // A report without full stats has no toggle.
  screen.show({ game: "DICE", headline: "ADA WINS" });
  assert.equal(toggle.hidden, true);
  screen.hide();
  assert.equal(screen.open, false);
});

test("the bar shows the ready count and the room's buttons, and reports the one pressed", () => {
  const { document } = page();
  const pressed: string[] = [];
  let backs = 0;
  const screen = createResultsScreen({
    document,
    onAction: (id) => pressed.push(id),
    onBack: () => backs++,
  });
  const buttons = () => [
    ...screen.actions.querySelectorAll<HTMLButtonElement>("button"),
  ];
  screen.update({
    status: "3/5 ready",
    actions: [
      { id: "lobby", label: "Back to lobby" },
      {
        id: "ready",
        label: "READY FOR REMATCH",
        primary: true,
        pressed: false,
      },
    ],
  });
  assert.equal(
    screen.element.querySelector(".fui-results-status")!.textContent,
    "3/5 ready",
  );
  assert.deepEqual(
    buttons().map((button) => [
      button.dataset.action,
      button.textContent,
      button.className,
      button.getAttribute("aria-pressed"),
    ]),
    [
      ["lobby", "Back to lobby", "", null],
      ["ready", "READY FOR REMATCH", "is-primary", "false"],
    ],
  );
  const ready = buttons()[1]!;
  ready.click();
  assert.deepEqual(pressed, ["ready"]);
  // The next frame keeps the same button and writes only what changed.
  screen.update({
    status: "4/5 ready",
    actions: [{ id: "ready", label: "READY ✓", primary: true, pressed: true }],
  });
  assert.equal(buttons().length, 1);
  assert.equal(buttons()[0] === ready, true);
  assert.equal(ready.getAttribute("aria-pressed"), "true");
  assert.equal(ready.textContent, "READY ✓");
  // A solo run has no status line.
  screen.update({ actions: [{ id: "retry", label: "RETRY", primary: true }] });
  assert.equal(
    screen.element.querySelector<HTMLElement>(".fui-results-status")!.hidden,
    true,
  );
  const back =
    screen.element.querySelector<HTMLButtonElement>(".fui-results-back")!;
  assert.equal(back.hidden, false);
  back.click();
  assert.equal(backs, 1);
  // Without a way back there is no Back.
  const closed = createResultsScreen({ document, onAction: () => {} });
  assert.equal(
    closed.element.querySelector<HTMLButtonElement>(".fui-results-back")!
      .hidden,
    true,
  );
});

test("an action that is gone loses its button, and hidden and disabled reach the page", () => {
  const { document } = page();
  const screen = createResultsScreen({ document, onAction: () => {} });
  const ids = () =>
    [...screen.actions.querySelectorAll<HTMLButtonElement>("button")].map(
      (button) => [button.dataset.action, button.hidden, button.disabled],
    );
  screen.update({
    actions: [
      { id: "menu", label: "Menu" },
      { id: "lobby", label: "Song select", hidden: true },
      { id: "again", label: "PLAY AGAIN", primary: true, disabled: true },
    ],
  });
  assert.deepEqual(ids(), [
    ["menu", false, false],
    ["lobby", true, false],
    ["again", false, true],
  ]);
  screen.update({
    actions: [{ id: "again", label: "PLAY AGAIN", primary: true }],
  });
  assert.deepEqual(ids(), [["again", false, false]]);
  // Shown again after being hidden, the report is the new one.
  screen.show({ game: "DICE", headline: "ADA WINS" });
  screen.hide();
  screen.show({ game: "DICE", headline: "BO WINS" });
  assert.equal(screen.open, true);
  assert.equal(screen.body.querySelector("h2")!.textContent, "BO WINS");
});

test("Back can be hidden for a frame, and Escape then does nothing", () => {
  const { document, window } = page();
  let backs = 0;
  const screen = createResultsScreen({
    document,
    onAction: () => {},
    onBack: () => backs++,
    backText: "Leave",
  });
  const back =
    screen.element.querySelector<HTMLButtonElement>(".fui-results-back")!;
  assert.equal(back.textContent, "Leave");
  const escape = () => {
    const event = new window.Event("keydown", { bubbles: true });
    Object.defineProperty(event, "key", { value: "Escape" });
    screen.element.dispatchEvent(event);
  };
  screen.update({ actions: [] });
  escape();
  assert.equal(backs, 1);
  screen.update({ actions: [], back: false });
  assert.equal(back.hidden, true);
  escape();
  assert.equal(backs, 1);
});
