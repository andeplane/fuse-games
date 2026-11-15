import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createInviteCard,
  createRoomLayout,
  createRoster,
  roomLayoutMarkup,
  requestedRoomSlot,
} from "fuse-ui";
import { page } from "./dom-fixture.js";

test("configuration rooms keep seats below invites and authored round choices on the right; compact stays intact", () => {
  for (const compact of [false, true]) {
    const { document } = page();
    const root = document.createElement("section");
    const invite = document.createElement("div");
    const choices = document.createElement("button");
    choices.textContent = "Choose round";
    const layout = createRoomLayout({
      element: root,
      invite,
      roster: createRoster({ document }),
      capacity: 3,
      compact,
      layout: "configuration",
      configuration: [choices],
    });
    layout.update(1);
    assert.equal(root.classList.contains("fui-room-configuration"), !compact);
    const slots = root.querySelector(".fui-room-open-slots")!;
    assert.equal(slots.closest(".fui-room-invitation") !== null, !compact);
    assert.ok(choices.closest(".fui-room-players"));
    assert.ok(choices.closest(".fui-room-configuration-content"));
    assert.equal(root.querySelectorAll(".fui-room-open-slot").length, 3);
    layout.dispose();
  }
});

test("markup configuration mode has the same invitation, seats and round-choice grouping", () => {
  const { document } = page();
  const root = document.createElement("div");
  for (const layout of ["players", "configuration"] as const) {
    root.innerHTML = roomLayoutMarkup({
      layout,
      invite: '<div id="invite">QR</div>',
      players: '<ul class="fui-roster"></ul>',
      join: "",
      settings: "",
      configuration: '<button id="round-choice">Choose round</button>',
      actions: "",
      occupied: 0,
      capacity: 2,
      canJoin: true,
    });
    const slots = root.querySelector(".fui-room-open-slots")!;
    assert.equal(
      slots.closest(".fui-room-invitation") !== null,
      layout === "configuration",
    );
    assert.equal(root.querySelectorAll(".fui-room-open-slot").length, 2);
    assert.ok(
      root
        .querySelector("#round-choice")!
        .closest(".fui-room-configuration-content"),
    );
    assert.ok(
      root.querySelector("#round-choice")!.closest(".fui-room-players"),
    );
  }
});

test("Back is the room's first control, top left, and can reuse the game's leave handler", () => {
  const { document } = page(),
    root = document.createElement("section"),
    leave = document.createElement("button");
  document.body.append(root);
  leave.textContent = "Back";
  let left = 0;
  leave.onclick = () => left++;
  const layout = createRoomLayout({
    element: root,
    roster: createRoster({ document }),
    capacity: 2,
    mainMenuAction: leave,
  });
  const head = root.firstElementChild!;
  assert.equal(head.className, "fui-page-head fui-room-head");
  assert.equal(head.firstElementChild === leave, true);
  assert.equal(leave.classList.contains("fui-back"), true);
  leave.click();
  assert.equal(left, 1);
  const configure = root.querySelector<HTMLElement>(".fui-room-settings")!,
    column = configure.parentElement!;
  assert.equal(column.lastElementChild === configure, true);
  column.append(document.createElement("p"));
  layout.update(0);
  assert.equal(
    column.lastElementChild === configure,
    true,
    "Room settings closes the invitation's column whatever a game adds to it",
  );
  const other = document.createElement("section");
  document.body.append(other);
  createRoomLayout({
    element: other,
    roster: createRoster({ document }),
    capacity: 2,
    mainMenuHref: "/fuse-volley/?mute",
  });
  assert.equal(
    other
      .querySelector<HTMLAnchorElement>(".fui-room-main-menu")
      ?.getAttribute("href"),
    "/fuse-volley/?mute",
  );
});

test("the main room action stays above Room settings without changing its handler or disabled state", () => {
  const { document } = page(),
    root = document.createElement("section"),
    start = document.createElement("button");
  document.body.append(root);
  start.textContent = "Play";
  start.disabled = true;
  let starts = 0;
  start.onclick = () => starts++;
  createRoomLayout({
    element: root,
    roster: createRoster({ document }),
    capacity: 6,
    primaryAction: start,
    actions: [start],
  });
  const configure = root.querySelector(".fui-room-settings")!;
  assert.equal(configure.previousElementSibling, start.parentElement);
  assert.equal(start.parentElement?.className, "fui-room-primary-action");
  assert.ok(start.closest(".fui-room-invitation"));
  assert.equal(start.disabled, true);
  start.disabled = false;
  start.click();
  assert.equal(starts, 1);
  assert.ok(!root.querySelector(".fui-room-actions")!.contains(start));
});

test("HTML room markup puts its primary action before settings in the invitation column", () => {
  const { document } = page(),
    root = document.createElement("div");
  root.innerHTML = roomLayoutMarkup({
    invite: "<p>Scan to join</p>",
    primaryAction: "<button disabled data-start>Play</button>",
    players: "",
    join: "",
    settings: "",
    actions: "",
    occupied: 0,
    capacity: 6,
  });
  const primary = root.querySelector(".fui-room-primary-action")!;
  assert.equal(
    primary.nextElementSibling?.getAttribute("data-action"),
    "open-room-settings",
  );
  assert.equal(primary.parentElement?.className, "fui-room-invitation");
  assert.equal(
    root.querySelector<HTMLButtonElement>("[data-start]")?.disabled,
    true,
  );
});

test("HTML room markup can put Settings and its primary action in the header, with the status at the foot", () => {
  const { document } = page(),
    root = document.createElement("div");
  root.innerHTML = roomLayoutMarkup({
    invite: "<p>Scan to join</p>",
    primaryAction: "<button data-start>Start</button>",
    players: "",
    join: "",
    settings: "",
    actions: "",
    occupied: 0,
    capacity: 2,
    actionsInHeader: true,
    heading: "Room",
    status: "<p>Connected</p>",
  });
  const head = root.querySelector(".fui-room-head")!;
  assert.deepEqual(
    [...head.children].map((node) => node.className),
    ["fui-back fui-room-main-menu", "fui-page-title", "fui-page-actions"],
  );
  assert.equal(head.querySelector(".fui-page-title")?.textContent, "Room");
  const configure = head.querySelector(".fui-room-configure")!;
  assert.equal(configure.textContent, "Room settings");
  assert.equal(configure.getAttribute("aria-label"), "Room settings");
  assert.equal(
    configure.nextElementSibling?.className,
    "fui-room-primary-action",
    "the main action is last, as in a dialog's bar",
  );
  assert.equal(
    root.querySelector(".fui-room-invitation")?.querySelector("button"),
    null,
    "nothing of the header's is left under the invitation",
  );
  assert.ok(
    root
      .querySelector(".fui-room-layout")
      ?.classList.contains("fui-room-actions-top"),
  );
  assert.equal(
    root.querySelector(".fui-room-layout > .fui-room-status")?.textContent,
    "Connected",
  );
});

test("switching teams moves the existing row to its new slot without losing its controls", () => {
  const { document } = page(),
    root = document.createElement("section"),
    roster = createRoster({ document });
  document.body.append(root);
  createRoomLayout({ element: root, roster, capacity: 2 });
  roster.update([{ id: "one", name: "Ada", slot: 0 }]);
  const row = roster.row("one")!;
  roster.update([{ id: "one", name: "Ada", slot: 1 }]);
  assert.equal(
    root.querySelector('[data-slot="1"] .fui-slot-occupant')?.firstElementChild,
    row,
  );
  assert.equal(
    root.querySelector('[data-slot="0"] .fui-slot-occupant')?.childElementCount,
    0,
  );
});

test("capacity changes keep occupied overflow slots visible and removable", () => {
  const { document } = page(),
    root = document.createElement("section"),
    roster = createRoster({ document });
  document.body.append(root);
  const layout = createRoomLayout({ element: root, roster, capacity: 2 });
  roster.update([
    { id: "host", name: "Ada", slot: 0 },
    { id: "bot", name: "AI", slot: 3 },
  ]);
  const remove = document.createElement("button");
  remove.textContent = "Remove AI";
  roster.row("bot")!.append(remove);
  layout.update(2, 2);
  const overflow = root.querySelector<HTMLElement>(
    '.fui-room-open-slot[data-slot="3"]',
  )!;
  assert.equal(overflow.hidden, false);
  assert.ok(overflow.contains(remove));
  assert.equal(root.querySelector(".fui-room-count")?.textContent, "2 / 2");
  assert.equal(
    root.querySelector<HTMLElement>('.fui-room-open-slot[data-slot="2"]')!
      .hidden,
    true,
  );
});

test("slot buttons prompt only for missing names, use the signed-in name and preserve AI slot choice", () => {
  const { document } = page(),
    root = document.createElement("section"),
    form = document.createElement("form"),
    input = document.createElement("input"),
    submit = document.createElement("button"),
    ai = document.createElement("button");
  submit.type = "submit";
  input.value = "";
  form.append(input, submit);
  document.body.append(root);
  let account: string | undefined,
    joined: number | undefined,
    bot: number | undefined;
  form.requestSubmit = () => {
    joined = requestedRoomSlot(form);
  };
  ai.onclick = () => {
    bot = requestedRoomSlot(ai);
  };
  createRoomLayout({
    element: root,
    roster: createRoster({ document }),
    capacity: 3,
    join: form,
    addAI: ai,
    playerName: () => account,
    slotColor: () => "#16e7ff",
  });
  const dialog = root.querySelector<HTMLDialogElement>(".fui-slot-admission")!;
  dialog.showModal = () => {
    dialog.open = true;
  };
  root
    .querySelector<HTMLButtonElement>('[data-slot="2"] .fui-slot-join')!
    .click();
  assert.equal(dialog.open, true);
  assert.equal(joined, undefined);
  dialog.open = false;
  account = "Anders";
  root
    .querySelector<HTMLButtonElement>('[data-slot="1"] .fui-slot-join')!
    .click();
  assert.equal(joined, 1);
  assert.equal(input.value, "Anders");
  assert.equal(dialog.open, false);
  root
    .querySelector<HTMLButtonElement>('[data-slot="0"] .fui-slot-ai')!
    .click();
  assert.equal(bot, 0);
});

test("room layout: stable occupied slots, explicit admission and game-owned AI actions", () => {
  const { document } = page();
  const root = document.createElement("section"),
    form = document.createElement("form");
  const submit = document.createElement("button");
  submit.type = "submit";
  form.append(submit);
  document.body.append(form, root);
  const roster = createRoster({ document });
  const invite = document.createElement("div");
  invite.className = "fui-invite";
  invite.append(
    document.createElement("img"),
    document.createElement("strong"),
  );
  root.append(invite);
  const ai = document.createElement("button"),
    start = document.createElement("button");
  let bots = 0;
  ai.onclick = () => bots++;
  const map = document.createElement("select");
  map.disabled = true;
  const layout = createRoomLayout({
    element: root,
    roster,
    capacity: 3,
    join: form,
    addAI: ai,
    settings: [map],
    actions: [start],
  });
  assert.equal(invite.parentElement?.className, "fui-room-invitation");
  assert.equal(form.parentElement?.className, "fui-dialog-body");
  assert.equal(submit.textContent, "Join");
  assert.equal(ai.textContent, "Add AI");
  ai.click();
  assert.equal(bots, 1);
  assert.equal(map.disabled, true, "layout cannot grant settings authority");
  roster.update([{ id: "one", name: "Ada" }]);
  const ada = roster.row("one");
  roster.update([
    { id: "one", name: "Ada" },
    { id: "two", name: "AI" },
  ]);
  assert.equal(roster.row("one"), ada);
  assert.equal(root.querySelector(".fui-room-count")?.textContent, "2 / 3");
  assert.equal(
    [...root.querySelectorAll<HTMLElement>(".fui-room-open-slot")].filter(
      (n) => !n.hidden && !n.classList.contains("fui-slot-occupied"),
    ).length,
    1,
  );
  root.hidden = true;
  roster.update([]);
  assert.equal(
    form.parentElement,
    document.body,
    "late admission remains outside a hidden room",
  );
  root.hidden = false;
  roster.update([]);
  assert.equal(form.parentElement?.className, "fui-dialog-body");
  layout.settings.showModal = () => {
    layout.settings.open = true;
  };
  layout.settings.close = () => {
    layout.settings.open = false;
  };
  root.querySelector<HTMLButtonElement>(".fui-room-settings")!.click();
  assert.equal(layout.settings.open, true);
  root.hidden = true;
  roster.update([]);
  assert.equal(layout.settings.open, false);
});

test("room layout: custom rosters can attach admission after mounting and omit settings", () => {
  const { document } = page();
  const root = document.createElement("section"),
    roster = document.createElement("ul");
  document.body.append(root);
  const form = document.createElement("form");
  root.append(form);
  const layout = createRoomLayout({
    element: root,
    roster,
    capacity: 2,
    join: form,
  });
  assert.match(layout.settings.textContent, /fixed match rules/);
  root.hidden = true;
  layout.update(1);
  assert.equal(form.parentElement, document.body);
  const second = document.createElement("form");
  document.body.append(second);
  layout.attachJoin(second);
  root.hidden = false;
  layout.update(2);
  assert.equal(second.parentElement?.className, "fui-dialog-body");
  assert.equal(root.querySelector(".fui-room-count")?.textContent, "2 / 2");
  layout.update(2, 4);
  assert.equal(root.querySelector(".fui-room-count")?.textContent, "2 / 4");
  assert.equal(
    [...root.querySelectorAll<HTMLElement>(".fui-room-open-slot")].filter(
      (slot) => !slot.hidden && !slot.classList.contains("fui-slot-occupied"),
    ).length,
    2,
  );
  layout.update(2, 2);
  assert.ok(
    [...root.querySelectorAll<HTMLElement>(".fui-room-open-slot")].every(
      (slot) => slot.hidden || slot.classList.contains("fui-slot-occupied"),
    ),
  );
});

test("HTML room renderer shares the layout and respects map-dependent capacity", () => {
  const { document } = page();
  const root = document.createElement("div");
  root.innerHTML = roomLayoutMarkup({
    invite: "<strong>AB42AA</strong>",
    players: "<ul></ul>",
    join: "<button>Join</button>",
    settings: "<select disabled></select>",
    actions: "<button>Start</button>",
    occupied: 1,
    capacity: 4,
  });
  assert.equal(root.querySelectorAll(".fui-room-open-slot").length, 4);
  assert.equal(root.querySelector(".fui-room-count")?.textContent, "1 / 4");
  assert.equal(
    root.querySelector("[data-room-settings]")?.getAttribute("aria-label"),
    "Room settings",
  );
  assert.equal(root.querySelector("select")?.disabled, true);
  assert.ok(
    !roomLayoutMarkup({
      invite: "",
      players: "",
      join: "",
      settings: "",
      actions: "",
      occupied: 5,
      capacity: 2,
    }).includes('fui-room-open-slot"'),
  );
});

test("an existing settings action is the shared room's single trigger", () => {
  const { document } = page();
  const root = document.createElement("section"),
    trigger = document.createElement("button");
  let opened = 0;
  const layout = createRoomLayout({
    element: root,
    roster: document.createElement("div"),
    capacity: 2,
    settingsTrigger: trigger,
    onSettings: () => {
      opened++;
    },
  });
  trigger.click();
  assert.equal(opened, 1);
  assert.equal(
    [...root.querySelectorAll("button")].filter(
      (node) => node.textContent === "Room settings",
    ).length,
    1,
  );
  layout.settings.open = true;
  layout.settings.close = () => {
    layout.settings.open = false;
  };
  layout.setActive(false);
  assert.equal(layout.settings.open, false);
});

test("a seat says what it is: its number on a chip, Open seat while empty, a game's own label when it has one", () => {
  const { document } = page(),
    plain = document.createElement("section"),
    roles = document.createElement("section");
  document.body.append(plain, roles);
  const layout = createRoomLayout({
    element: plain,
    roster: createRoster({ document }),
    capacity: 3,
  });
  layout.update(1, 3, [0]);
  const seats = [...plain.querySelectorAll<HTMLElement>(".fui-room-open-slot")];
  assert.deepEqual(
    seats.map((seat) => seat.querySelector(".fui-slot-chip")!.textContent),
    ["1", "2", "3"],
  );
  assert.deepEqual(
    seats.map((seat) => seat.querySelector(".fui-slot-label")!.textContent),
    ["Seat 1", "Open seat", "Open seat"],
  );
  assert.equal(
    seats.every((seat) => seat.classList.contains("fui-slot-plain")),
    true,
    "a seat with only a number gives its rows to whoever sits there",
  );
  assert.equal(seats[0]!.classList.contains("fui-slot-occupied"), true);
  assert.deepEqual(
    seats.map((seat) => seat.classList.contains("fui-slot-idle")),
    [false, true, true],
    "an open seat with no Join and no Add AI for this viewer is marked idle, so it can fold to a line",
  );

  createRoomLayout({
    element: roles,
    roster: createRoster({ document }),
    capacity: 2,
    slotLabel: (slot) => (slot === 0 ? "Queen" : "Worker"),
  }).update(1, 2, [1]);
  assert.deepEqual(
    [...roles.querySelectorAll(".fui-slot-label")].map(
      (label) => label.textContent,
    ),
    ["Queen · Open", "Worker"],
  );
  assert.equal(roles.querySelector(".fui-slot-plain"), null);

  // A label that only describes the open seats: a taken one shows the player alone, as a seat without a label does.
  const teams = document.createElement("section");
  document.body.append(teams);
  const teamRoom = createRoomLayout({
    element: teams,
    roster: createRoster({ document }),
    capacity: 2,
    slotLabel: (slot) => (slot === 0 ? "Cyan" : "Pink"),
    slotLabelOpenOnly: true,
  });
  teamRoom.update(1, 2, [0]);
  const teamSeats = [
    ...teams.querySelectorAll<HTMLElement>(".fui-room-open-slot"),
  ];
  assert.deepEqual(
    teamSeats.map((seat) => seat.classList.contains("fui-slot-plain")),
    [true, false],
  );
  assert.equal(
    teamSeats[1]!.querySelector(".fui-slot-label")!.textContent,
    "Pink · Open",
  );
  teamRoom.update(0, 2, []);
  assert.equal(
    teams.querySelector(".fui-slot-plain"),
    null,
    "a seat that empties gets its label back",
  );
});

test("header actions put a game's own actions, Settings and the main action across the room's top, primary last", () => {
  const { document } = page(),
    root = document.createElement("section"),
    start = document.createElement("button"),
    optionsButton = document.createElement("button"),
    extra = document.createElement("label"),
    status = document.createElement("p");
  document.body.append(root);
  start.textContent = "Start";
  optionsButton.textContent = "Options";
  status.textContent = "Connected";
  createRoomLayout({
    element: root,
    invite: document.createElement("div"),
    roster: createRoster({ document }),
    capacity: 4,
    primaryAction: start,
    headerActions: [optionsButton],
    heading: "Room",
    extras: [extra],
    status,
  });
  const head = root.firstElementChild!;
  assert.equal(head.classList.contains("fui-room-head"), true);
  assert.equal(root.classList.contains("fui-room-actions-top"), true);
  assert.equal(root.classList.contains("fui-room-compact"), false);
  assert.equal(head.querySelector(".fui-page-title")!.textContent, "Room");
  assert.deepEqual(
    [...head.querySelectorAll("button")].map((button) => button.textContent),
    ["Options", "Room settings", "Start"],
  );
  assert.equal(
    head.querySelector(".fui-room-configure")!.getAttribute("aria-label"),
    "Room settings",
  );
  const column = root.querySelector(".fui-room-invitation")!;
  assert.equal(column.querySelector("button"), null);
  assert.equal(column.lastElementChild === extra, true);
  // The header comes before the players and everything a game puts under them.
  const order = [...root.children].map((child) => child.className);
  assert.equal(order[0], "fui-page-head fui-room-head");
  assert.equal(
    order.indexOf("fui-room-status") > order.indexOf("fui-room-players"),
    true,
  );
  assert.equal(
    root.querySelector(".fui-room-status")!.textContent,
    "Connected",
  );
});

test("a compact room whose seats are roles is marked to show every open seat, and only when compact", () => {
  const { document } = page();
  const build = (compact: boolean) => {
    const root = document.createElement("section");
    document.body.append(root);
    createRoomLayout({
      element: root,
      roster: createRoster({ document }),
      capacity: 6,
      compactShowsEverySeat: true,
      ...(compact ? { compact: true } : {}),
    });
    return root;
  };
  assert.equal(build(true).classList.contains("fui-room-every-seat"), true);
  assert.equal(build(false).classList.contains("fui-room-every-seat"), false);
});

test("a compact room is one column: no invitation, the heading beside Back, and the same header actions", () => {
  const { document } = page(),
    root = document.createElement("section"),
    start = document.createElement("button");
  document.body.append(root);
  start.textContent = "Start";
  createRoomLayout({
    element: root,
    roster: createRoster({ document }),
    capacity: 5,
    primaryAction: start,
    compact: true,
    heading: "Single player",
  });
  assert.equal(root.classList.contains("fui-room-compact"), true);
  assert.equal(root.classList.contains("fui-room-actions-top"), true);
  assert.equal(root.querySelector(".fui-room-invitation"), null);
  assert.equal(root.textContent!.includes("Your room"), false);
  const head = root.firstElementChild!;
  assert.equal(
    head.querySelector(".fui-page-title")!.textContent,
    "Single player",
  );
  assert.deepEqual(
    [...head.querySelectorAll("button")].map((button) => button.textContent),
    ["Room settings", "Start"],
  );
  assert.equal(head.querySelector(".fui-back")!.textContent, "Back");
});

test("a seated viewer is offered every open seat as a move, and a viewer without a seat is offered a join", () => {
  const { document } = page(),
    root = document.createElement("section"),
    form = document.createElement("form");
  document.body.append(root, form);
  let own: number | undefined;
  const moves: number[] = [];
  const layout = createRoomLayout({
    element: root,
    roster: createRoster({ document }),
    capacity: 4,
    join: form,
    ownSlot: () => own,
    onMove: (slot) => moves.push(slot),
  });
  const joins = () => [
    ...root.querySelectorAll<HTMLButtonElement>(".fui-slot-join"),
  ];
  layout.update(0, 4, []);
  assert.deepEqual(
    joins().map((join) => [join.textContent, join.hidden]),
    Array.from({ length: 4 }, () => ["Join", false]),
  );
  // Seated, with the admission form gone as games hide it: the open seats stay actionable.
  own = 1;
  form.hidden = true;
  layout.update(1, 4, [1]);
  const seats = [...root.querySelectorAll<HTMLElement>(".fui-room-open-slot")];
  assert.deepEqual(
    seats.map((seat) => [
      seat.classList.contains("fui-slot-occupied"),
      seat.classList.contains("fui-slot-idle"),
      seat.querySelector(".fui-slot-join")!.textContent,
      seat.querySelector<HTMLElement>(".fui-slot-controls")!.hidden,
    ]),
    [
      [false, false, "Sit here", false],
      [true, false, "Sit here", true],
      [false, false, "Sit here", false],
      [false, false, "Sit here", false],
    ],
  );
  joins()[3]!.click();
  joins()[0]!.click();
  assert.deepEqual(moves, [3, 0], "the seat clicked is the seat asked for");
  assert.equal(
    requestedRoomSlot(form),
    undefined,
    "a move is not an admission: the join form is left alone",
  );
});

test("a viewer with a name is seated on arriving, once, in whichever seat is free; one without a name is asked", () => {
  const build = (name: string, autoSeat?: boolean) => {
    const { document } = page(),
      root = document.createElement("section"),
      form = document.createElement("form"),
      input = document.createElement("input"),
      submit = document.createElement("button");
    submit.type = "submit";
    input.value = name;
    form.append(input, submit);
    document.body.append(root, form);
    const joins: (number | undefined)[] = [];
    form.requestSubmit = () => {
      joins.push(requestedRoomSlot(form));
    };
    form.hidden = true;
    root.hidden = true;
    const layout = createRoomLayout({
      element: root,
      roster: createRoster({ document }),
      capacity: 4,
      join: form,
      ...(autoSeat === undefined ? {} : { autoSeat }),
    });
    return { root, form, layout, joins };
  };
  const named = build("Anders");
  named.layout.update(0);
  assert.deepEqual(named.joins, [], "not before the room is on screen");
  named.root.hidden = false;
  named.layout.update(0);
  assert.deepEqual(named.joins, [], "not before the room offers a seat");
  named.form.hidden = false;
  named.layout.update(1, 4, [0]);
  assert.deepEqual(named.joins, [undefined], "the room picks the free seat");
  named.layout.update(1, 4, [0]);
  named.layout.update(0, 4, []);
  assert.equal(named.joins.length, 1, "once: a seat given up is not retaken");

  const nameless = build("");
  nameless.root.hidden = false;
  nameless.form.hidden = false;
  nameless.layout.update(0);
  assert.deepEqual(nameless.joins, []);

  const typing = build("");
  typing.root.hidden = false;
  typing.form.hidden = false;
  typing.layout.update(0);
  const field = typing.form.querySelector("input")!;
  field.value = "A";
  field.dispatchEvent(
    new typing.root.ownerDocument.defaultView!.Event("input", {
      bubbles: true,
    }),
  );
  typing.layout.update(0);
  field.value = "Anders";
  typing.layout.update(0);
  assert.deepEqual(
    typing.joins,
    [],
    "a name being typed is the player's to submit, not seated under its first letter",
  );

  // A form the game attaches later (Fuse Lane) is held to the same rule.
  const late = build("");
  const lateForm = late.root.ownerDocument.createElement("form"),
    lateField = late.root.ownerDocument.createElement("input"),
    lateSubmit = late.root.ownerDocument.createElement("button");
  lateSubmit.type = "submit";
  lateForm.append(lateField, lateSubmit);
  late.root.ownerDocument.body.append(lateForm);
  let lateJoins = 0;
  lateForm.requestSubmit = () => {
    lateJoins++;
  };
  late.root.hidden = false;
  late.layout.attachJoin(lateForm);
  lateField.value = "A";
  lateField.dispatchEvent(
    new late.root.ownerDocument.defaultView!.Event("input", { bubbles: true }),
  );
  late.layout.update(0);
  assert.equal(lateJoins, 0, "nor in a join form attached after the room");

  const optedOut = build("Anders", false);
  optedOut.root.hidden = false;
  optedOut.form.hidden = false;
  optedOut.layout.update(0);
  assert.deepEqual(optedOut.joins, []);
});

test("the friends system is the same in every room: ADD FRIEND on a matched player's row, INVITE FRIENDS under Copy link", () => {
  const { document } = page(),
    root = document.createElement("section");
  document.body.append(root);
  const accounts = new Map<string, string>();
  let opened = 0;
  const friends = {
    friendButton(publicId: string) {
      const add = document.createElement("button");
      add.textContent = "+ ADD FRIEND";
      add.dataset.publicId = publicId;
      return add;
    },
    publicIdOfMember: (memberId: string) => accounts.get(memberId),
    open: () => opened++,
  };
  const roster = createRoster({ document }),
    invite = createInviteCard({
      code: "XD47AA",
      link: "https://example.test/?room=XD47AA",
      document,
    });
  createRoomLayout({
    element: root,
    invite: invite.element,
    roster,
    capacity: 3,
    friends,
  });
  const members = [
    { id: "peer-a", slot: 0, name: "Sindre", host: true },
    { id: "peer-b", slot: 1, name: "Anders" },
  ];
  const friendOf = (id: string) =>
    roster.row(id)!.querySelector<HTMLElement>(".fui-roster-friend");
  roster.update(members);
  assert.equal(friendOf("peer-a"), null, "no account, no button");
  assert.equal(friendOf("peer-b"), null);

  // The service matches a seat to an account some time after it is taken; the next update shows the button.
  accounts.set("peer-b", "pub-anders");
  const remove = document.createElement("button");
  remove.textContent = "×";
  roster.row("peer-b")!.append(remove);
  roster.update(members);
  const first = friendOf("peer-b")!;
  assert.equal(first.dataset.publicId, "pub-anders");
  assert.equal(
    first.previousElementSibling!.contains(
      roster.row("peer-b")!.querySelector("strong"),
    ),
    true,
    "after the name",
  );
  assert.equal(
    roster.row("peer-b")!.lastElementChild === remove,
    true,
    "a game's own control stays last on the row",
  );
  roster.update(members);
  assert.equal(friendOf("peer-b") === first, true, "kept across updates");
  assert.equal(friendOf("peer-a"), null);

  // The seat changes hands: the button is the new account's, and there is one of them.
  accounts.set("peer-b", "pub-other");
  roster.update(members);
  assert.equal(friendOf("peer-b")!.dataset.publicId, "pub-other");
  assert.equal(
    roster.row("peer-b")!.querySelectorAll(".fui-roster-friend").length,
    1,
  );
  accounts.delete("peer-b");
  roster.update(members);
  assert.equal(friendOf("peer-b"), null, "the account left the seat");

  const inviteFriends = invite.element.lastElementChild as HTMLButtonElement;
  assert.equal(inviteFriends.textContent, "INVITE FRIENDS");
  assert.equal(inviteFriends.className, "fui-room-invite-friends");
  assert.equal(
    inviteFriends.previousElementSibling!.contains(invite.copy),
    true,
    "under Copy link",
  );
  inviteFriends.click();
  assert.equal(opened, 1);

  accounts.set("peer-a", "pub-sindre");
  roster.update(members);
  assert.equal(friendOf("peer-a")!.dataset.publicId, "pub-sindre");
  roster.befriend(undefined);
  assert.equal(friendOf("peer-a"), null, "no friends system, no buttons");
});

test("a room without the friends system has neither button", () => {
  const { document } = page(),
    root = document.createElement("section");
  document.body.append(root);
  const roster = createRoster({ document }),
    invite = createInviteCard({
      code: "XD47AA",
      link: "https://example.test/?room=XD47AA",
      document,
    });
  createRoomLayout({
    element: root,
    invite: invite.element,
    roster,
    capacity: 2,
  });
  roster.update([{ id: "peer-a", slot: 0, name: "Sindre" }]);
  assert.equal(root.querySelector(".fui-room-invite-friends"), null);
  assert.equal(root.querySelector(".fui-roster-friend"), null);
});

test("ADD FRIEND follows the room: a player who leaves and comes back, a room on one device, two seats of one account", () => {
  const { document } = page(),
    root = document.createElement("section");
  document.body.append(root);
  let made = 0;
  const friends = {
    friendButton(publicId: string) {
      const add = document.createElement("button");
      add.dataset.publicId = publicId;
      made++;
      return add;
    },
    publicIdOfMember: (memberId: string) =>
      memberId === "bot" ? undefined : "pub-anders",
    open: () => {},
  };
  const roster = createRoster({ document });
  // No invitation (a room on one device): nowhere for INVITE FRIENDS, and the rows still have ADD FRIEND.
  createRoomLayout({ element: root, roster, capacity: 3, friends });
  assert.equal(root.querySelector(".fui-room-invite-friends"), null);
  const friendsOf = (id: string) =>
    roster.row(id)!.querySelectorAll<HTMLElement>(".fui-roster-friend");
  const both = [
    { id: "phone", slot: 0, name: "Anders" },
    { id: "laptop", slot: 1, name: "Anders" },
    { id: "bot", slot: 2, name: "AI Turing" },
  ];
  roster.update(both);
  assert.equal(friendsOf("phone").length, 1);
  assert.equal(friendsOf("laptop").length, 1, "one account in two seats");
  assert.equal(friendsOf("bot").length, 0);
  assert.equal(made, 2);
  // The roster runs every frame: an unchanged room asks for no new button and moves none.
  const phone = friendsOf("phone")[0]!,
    laptop = friendsOf("laptop")[0]!;
  for (let frame = 0; frame < 3; frame++) roster.update(both);
  assert.equal(made, 2);
  assert.equal(friendsOf("phone")[0] === phone, true);
  assert.equal(friendsOf("laptop")[0] === laptop, true);

  roster.update(both.slice(1));
  assert.equal(roster.row("phone"), undefined);
  roster.update(both);
  assert.equal(friendsOf("phone").length, 1, "back in the room, one button");
  assert.equal(made, 3);

  // The friends system can arrive after the players, and leave again.
  roster.befriend(undefined);
  roster.update(both);
  assert.equal(root.querySelector(".fui-roster-friend"), null);
  roster.befriend(friends);
  roster.update(both);
  assert.equal(friendsOf("phone").length, 1);
  assert.equal(friendsOf("laptop").length, 1);
});
