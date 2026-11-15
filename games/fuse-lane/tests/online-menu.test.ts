import test from "node:test";
import assert from "node:assert/strict";
import { validRoomCode } from "fuse-network-fe";
import { createArt } from "../src/app/art.js";
import { createMenu, type MenuChoice } from "../src/app/menu.js";
import {
  createOnlineSheet,
  lastRoom,
  nextFace,
  storedFace,
} from "../src/app/online-menu.js";
import { createRoomLobby, presetOf } from "../src/app/room-lobby.js";
import { colorOf, type LobbyModel } from "../src/app/presenter.js";
import { keys, type Store } from "../src/app/session.js";
import { FakeImages, installDom } from "./fixtures/dom.js";

const dom = installDom();
const art = createArt("/", new FakeImages().make);
const names = keys("fuse-lane");

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const store: Store = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  return { store, map };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

function sheet(store: Store, create: () => Promise<void> = async () => {}) {
  let created = 0;
  const joined: string[] = [];
  const root = createOnlineSheet({
    store,
    keys: names,
    valid: validRoomCode,
    onCreate: () => {
      created += 1;
      return create();
    },
    onJoin: (code) => joined.push(code),
  });
  dom.document.body.replaceChildren(root);
  const byText = (text: string) =>
    dom
      .$$<HTMLButtonElement>("button", root)
      .find((button) => button.textContent === text)!;
  return { root, created: () => created, joined, byText };
}

test("PLAY ONLINE: CREATE ROOM and a code, and nothing about how the room is played; the room asks that", async () => {
  const { store } = memory({ [names.name]: "Ada" });
  const s = sheet(store);
  assert.deepEqual(
    dom.$$("button", s.root).map((button) => button.textContent),
    ["CREATE ROOM", "JOIN"],
    "no device or Shared TV choice, no name or face: those are the room's",
  );
  assert.equal(s.root.querySelector("input.fl-person-name"), null);
  s.byText("CREATE ROOM").click();
  await settle();
  assert.equal(s.created(), 1);
});

test("the room's face: the remembered one, the first when none or a stale one is stored, and the next in order", () => {
  const { store } = memory({ [names.avatar]: "cat" });
  assert.equal(storedFace(store, names.avatar), "cat");
  assert.equal(storedFace(memory().store, names.avatar), "fox");
  assert.equal(
    storedFace(memory({ [names.avatar]: "dragon?" }).store, names.avatar),
    "fox",
  );
  assert.equal(nextFace("fox"), "alien");
  assert.equal(nextFace("no such face"), "robot", "a stale face starts over");
});

test("CREATE ROOM says what went wrong and comes back; JOIN takes a code in any case, or says what a code looks like", async () => {
  const { store } = memory();
  const s = sheet(store, () =>
    Promise.reject(new Error("Online rooms are not open yet for this game.")),
  );
  const create = s.byText("CREATE ROOM");
  create.click();
  assert.equal(create.disabled, true, "one room per tap");
  await settle();
  const error = dom.$(".fl-online-error", s.root);
  assert.equal(error.hidden, false);
  assert.equal(
    error.textContent,
    "Online rooms are not open yet for this game.",
  );
  assert.equal(s.byText("CREATE ROOM").disabled, false);

  const code = dom.$<HTMLInputElement>(".fl-join input", s.root);
  code.value = "??";
  s.byText("JOIN").click();
  assert.equal(error.textContent, "Type the room's code, for example AB42AA");
  code.value = " ab42 ";
  s.byText("JOIN").click();
  assert.deepEqual(s.joined, ["AB42AA"]);
});

test("REJOIN goes back to the last room this device was in", () => {
  const { store } = memory({ [names.last]: "qx74" });
  assert.equal(lastRoom(store, names.last, validRoomCode), "QX74AA");
  const s = sheet(store);
  s.byText("REJOIN QX74AA").click();
  assert.deepEqual(s.joined, ["QX74AA"]);
  assert.equal(lastRoom(memory().store, names.last, validRoomCode), undefined);
  assert.equal(
    lastRoom(memory({ [names.last]: "!!" }).store, names.last, validRoomCode),
    undefined,
  );
});

test("Play separates local setup and joining without losing their controls, and has no hosting options", () => {
  const { store } = memory({ [names.name]: "Ada" });
  const online = sheet(store);
  const started: MenuChoice[] = [];
  const root = createMenu({
    art,
    store,
    onStart: (choice) => started.push(choice),
    onResume: () => {},
    onDiscard: () => {},
    online: { sheet: online.root, mode: "online", onMode: () => {} },
  });
  dom.document.body.replaceChildren(root);
  const press = (text: string) =>
    dom
      .$$<HTMLButtonElement>("button", root)
      .find((button) => button.textContent === text)!
      .click();
  const dialog = dom.$<HTMLDialogElement>("dialog", root);
  // Linkedom supplies the element; this fixture supplies its native open/close surface.
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
    dialog.dispatchEvent(new dom.window.Event("close"));
  };
  assert.equal(root.querySelector('[role="tab"]'), null);
  const choices = dom.$(".fui-play-menu", root);
  assert.equal(choices.hidden, true);
  press("Play");
  assert.equal(choices.hidden, false);
  assert.deepEqual(
    dom
      .$$<HTMLButtonElement>("button", choices)
      .map((button) => button.textContent),
    ["Single player", "Host room", "Join room"],
  );
  // Back is the page's own control, top left: not a fourth choice under the three.
  assert.equal(
    dom.$<HTMLButtonElement>(".fui-page-head .fui-back", root).textContent,
    "Back",
  );
  assert.equal(
    dom.$<HTMLButtonElement>("button:nth-child(2)", choices).disabled,
    false,
  );
  assert.equal(
    dom.$(".fui-play-hosting", root).hidden,
    true,
    "no Hosting options on the menu: Shared TV is ticked in the room",
  );
  assert.equal(
    dom
      .$$<HTMLButtonElement>("button", root)
      .some((button) => button.textContent === "SHARED TV"),
    false,
  );

  press("Single player");
  assert.equal(dialog.open, true);
  assert.ok(dialog.contains(dom.$(".fl-setup", root)));
  press("Hard");
  press("Quick · 30");
  dom.$<HTMLButtonElement>(".fl-start-game", dialog).click();
  assert.equal(started.length, 1);
  assert.equal(started[0]!.level, 2);
  assert.equal(started[0]!.goal, 30);
  dialog.close();

  press("Join room");
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector(".fl-setup"), null);
  const code = dom.$<HTMLInputElement>(".fl-join input", dialog);
  code.value = " ab42 ";
  press("JOIN");
  assert.deepEqual(online.joined, ["AB42AA"]);
  dialog.close();
  press("Back");
  assert.equal(choices.hidden, true);
});

const LOBBY: LobbyModel = {
  members: [
    {
      id: "a",
      name: "Ada (you)",
      status: "READY",
      avatar: "fox",
      color: colorOf(0),
    },
    { id: "b", name: "Bo", status: "AWAY", avatar: "cat", color: colorOf(1) },
    {
      id: "bot:1",
      name: "Riley",
      status: "BOT",
      avatar: "robot",
      color: colorOf(2),
    },
  ],
  canStart: true,
  showStart: true,
  note: "",
  canAddBot: true,
  removable: ["bot:1"],
  goals: [30, 30, 30, 30],
  canPickGoals: true,
  weekSeconds: 60,
  canSetWeek: true,
  level: 1,
  canSetLevel: true,
  shared: false,
  canShare: true,
};

test("the room's lobby: the shared room with faces, names and HOST, START on top, Shared TV in the room, and every host choice back as an action", () => {
  const calls: unknown[][] = [];
  let takes = true;
  const status = dom.document.createElement("p");
  status.textContent = "Connected";
  const lobby = createRoomLobby({
    art,
    code: "AB42AA",
    link: "https://example.test/fuse-lane/?room=AB42AA",
    qr: async () => "data:image/png;base64,",
    tv: false,
    status,
    actions: {
      addBot: () => calls.push(["addBot"]),
      removeBot: (id) => calls.push(["removeBot", id]),
      start: () => calls.push(["start"]),
      goal: (goal) => calls.push(["goal", goal]),
      level: (level) => calls.push(["level", level]),
      weekSeconds: (seconds) => calls.push(["week", seconds]),
      shared: (display) => {
        calls.push(["shared", display]);
        return takes;
      },
      openTv: () => calls.push(["openTv"]),
    },
  });
  dom.document.body.replaceChildren(lobby.element);
  lobby.render(LOBBY, "a");
  const rows = dom.$$(".fui-roster-row", lobby.element);
  assert.deepEqual(
    rows.map(
      (row) =>
        `${dom.$(".fui-roster-name", row).textContent}/${dom.$(".fui-roster-status", row).textContent}`,
    ),
    ["Ada (you)/Ready", "Bo/Away", "Riley/AI · Normal"],
  );
  const hosts = () =>
    dom.$$(".fui-roster-row", lobby.element).map((row) => {
      const badge = row.querySelector<HTMLElement>(".fui-roster-host");
      return badge !== null && !badge.hidden;
    });
  assert.deepEqual(hosts(), [true, false, false], "HOST marks who holds START");
  assert.ok(rows[1]!.classList.contains("away"));
  assert.equal(
    rows.every((row) => row.querySelector(".fl-art") !== null),
    true,
    "every row has its face",
  );
  const removes = dom.$$<HTMLButtonElement>(".fl-remove", lobby.element);
  assert.deepEqual(
    removes.map((remove) => remove.hidden),
    [true, true, false],
    "only an AI can be removed",
  );
  removes[2]!.click();
  // START sits in the room's header beside Back and Settings, never under the invitation.
  const head = dom.$(".fui-room-head", lobby.element);
  assert.ok(head.contains(dom.$(".fl-start", lobby.element)));
  assert.ok(dom.$(".fui-room-status", lobby.element).contains(status));
  const press = (text: string) =>
    dom
      .$$<HTMLButtonElement>("button", lobby.element)
      .find((button) => button.textContent === text)!
      .click();
  press("Long · 80");
  press("Hard");
  press("90s");
  press("Add AI");
  press("START MATCH");
  // Shared TV is the room's tick; OPEN TV SCREEN comes with it.
  const tv = dom.$(".fl-shared-tv", lobby.element),
    box = dom.$<HTMLInputElement>("input", tv),
    open = dom.$<HTMLButtonElement>(".fui-room-tv-screen", tv);
  assert.equal(tv.hidden, false);
  assert.equal(box.checked, false);
  box.checked = true;
  box.dispatchEvent(new dom.window.Event("change"));
  lobby.render({ ...LOBBY, shared: true }, "a");
  assert.equal(box.checked, true);
  assert.equal(open.hidden, false);
  open.click();
  // A room that did not take the tick puts the box back.
  takes = false;
  box.checked = false;
  box.dispatchEvent(new dom.window.Event("change"));
  assert.equal(box.checked, true);
  assert.deepEqual(calls, [
    ["removeBot", "bot:1"],
    ["goal", 80],
    ["level", 2],
    ["week", 90],
    ["addBot"],
    ["start"],
    ["shared", true],
    ["openTv"],
    ["shared", false],
  ]);
  // A guest: no START, no bots, no Shared TV tick, a note; and nobody's level to set without an AI.
  lobby.render(
    {
      ...LOBBY,
      members: LOBBY.members.slice(0, 2),
      canStart: false,
      showStart: false,
      canAddBot: false,
      removable: [],
      canSetWeek: false,
      canSetLevel: false,
      canShare: false,
      note: "Waiting for the host to start",
    },
    "b",
  );
  assert.equal(dom.$$(".fui-roster-row", lobby.element).length, 2);
  assert.equal(dom.$(".fl-lobby-note", lobby.element).hidden, false);
  assert.equal(
    dom.$<HTMLButtonElement>(".fl-start", lobby.element).hidden,
    true,
  );
  assert.equal(tv.hidden, true);
  assert.deepEqual(hosts(), [false, true]);
});

test("a goal preset is read back only when all four goals match one", () => {
  assert.equal(presetOf([50, 50, 50, 50]), 50);
  assert.equal(presetOf([30, 40, 50, 60]), 0);
  assert.equal(presetOf([70, 70, 70, 70]), 0);
});
