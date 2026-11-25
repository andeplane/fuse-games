import assert from "node:assert/strict";
import { test } from "node:test";
import { createGameMenu, createTopBar, openTopBarRadio } from "fuse-ui";
import { event, page } from "./dom-fixture.js";
import { ALL_SONGS } from "fuse-music";
import type { MusicPlayer } from "../src/radio.js";

test("Radio and Player options are sibling views and Back returns to the game menu", () => {
  const { document, window } = page();
  const root = document.createElement("header");
  document.body.append(root);
  const controls = document.createElement("select");
  const transport = document.createElement("button");
  let closed = 0;
  createTopBar({
    element: root,
    music: false,
    radioControls: transport,
    playerOptions: () => controls,
    onPlayerOptionsClose: () => closed++,
  });
  const menu = root.querySelector("dialog")!;
  Object.defineProperty(menu, "open", { get: () => true });
  const actions = menu.querySelector<HTMLElement>(".fui-top-bar-actions")!;
  const radio = actions.querySelector<HTMLButtonElement>(".fui-top-bar-radio")!;
  const options = actions.querySelector<HTMLButtonElement>(
    ".fui-top-bar-player-options",
  )!;
  assert.equal(options.hidden || radio.hidden, false);
  options.click();
  assert.equal(menu.getAttribute("aria-label"), "Player options");
  assert.equal(actions.hidden, true);
  assert.equal(controls.closest("[hidden]"), null);
  createTopBar({ element: root });
  const escape = new window.Event("cancel", { cancelable: true });
  menu.dispatchEvent(escape);
  assert.ok(escape.defaultPrevented);
  assert.equal(actions.hidden, false);
  assert.equal(menu.getAttribute("aria-label"), "Game menu");
  assert.equal(closed, 1);
  radio.click();
  assert.equal(menu.getAttribute("aria-label"), "Radio");
  assert.equal(transport.closest("dialog"), menu);
  assert.equal(transport.closest("[hidden]"), null);
  assert.ok(controls.closest("[hidden]"));
  menu.querySelector<HTMLButtonElement>(".fui-dialog-back")!.click();
  assert.equal(menu.getAttribute("aria-label"), "Game menu");
  assert.equal(closed, 1);
});

test("the Radio shortcut opens the shared header and choosing Report dismisses its menu", () => {
  const { document, window } = page();
  const root = document.createElement("header");
  document.body.append(root);
  const changes: boolean[] = [];
  const radioControls = document.createElement("button");
  createTopBar({
    element: root,
    music: false,
    gameId: "test-game",
    radioControls,
    onOpenChange: (open) => changes.push(open),
  });
  const dialog = root.querySelector<HTMLDialogElement>(".fui-top-bar-menu")!;
  Object.defineProperty(dialog, "open", {
    get: () => dialog.hasAttribute("open"),
  });
  dialog.showModal = () => {
    dialog.setAttribute("open", "");
  };
  dialog.close = () => {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new window.Event("close"));
  };
  openTopBarRadio(root);
  assert.equal(dialog.open, true);
  assert.equal(dialog.getAttribute("aria-label"), "Radio");
  assert.equal(radioControls.closest("dialog"), dialog);
  dialog.querySelector<HTMLButtonElement>(".fui-dialog-back")!.click();
  assert.equal(dialog.getAttribute("aria-label"), "Game menu");
  dialog.querySelector<HTMLButtonElement>(".fui-playtest-trigger")!.click();
  assert.equal(dialog.open, false);
  assert.deepEqual(changes, [true, false]);
});

test("the default radio survives header replacement without constructing a second player", () => {
  const { document, window } = page();
  let creates = 0,
    plays = 0,
    paused = true;
  const media: MusicPlayer = {
    src: "",
    volume: 0,
    onended: null,
    onerror: null,
    get paused() {
      return paused;
    },
    play: async () => {
      plays++;
      paused = false;
    },
    pause() {
      paused = true;
    },
    load() {},
  };
  const first = document.createElement("header");
  document.body.append(first);
  const createMusicMedia = () => {
    creates++;
    return media;
  };
  createTopBar({ element: first, gameId: "test-game", createMusicMedia });
  assert.equal(creates, 0, "opening a game does not download music");
  assert.equal(
    first.querySelectorAll(".fui-radio option").length,
    ALL_SONGS.length,
  );
  document.dispatchEvent(event(window, "keydown"));
  assert.equal(creates, 1);
  assert.equal(plays, 1);
  const second = document.createElement("header");
  first.replaceWith(second);
  createTopBar({ element: second, gameId: "test-game", createMusicMedia });
  assert.equal(creates, 1);
  assert.equal(document.querySelectorAll(".fui-radio").length, 1);
  assert.equal(
    second.querySelector(".fui-radio button")?.textContent,
    "Pause radio",
  );
});

test("games can choose a smaller catalogue or retain their own radio controls", () => {
  const { document } = page();
  const root = document.createElement("header");
  const media: MusicPlayer = {
    src: "",
    volume: 0,
    onended: null,
    onerror: null,
    play: async () => {},
    pause() {},
    load() {},
  };
  createTopBar({
    element: root,
    gameId: "test-game",
    music: [ALL_SONGS[17]],
    createMusicMedia: () => media,
  });
  assert.equal(root.querySelectorAll(".fui-radio option").length, 1);
  const custom = document.createElement("header");
  createTopBar({
    element: custom,
    gameId: "custom-game",
    music: false,
    createMusicMedia: () => media,
  });
  assert.equal(custom.querySelector(".fui-radio"), null);
});

test("one master sound button controls both channels and survives header refreshes", () => {
  const { document } = page();
  const root = document.createElement("header");
  const state = { music: true, effects: true };
  createTopBar({
    element: root,
    sound: {
      enabled: () => state.music || state.effects,
      setEnabled(on) {
        state.music = state.effects = on;
      },
    },
  });
  const sound = root.querySelector<HTMLButtonElement>(".fui-top-bar-sound")!;
  const master = root.querySelector<HTMLButtonElement>(".fui-player-sound")!;
  master.click();
  assert.deepEqual(state, { music: false, effects: false });
  assert.equal(sound.getAttribute("aria-label"), "Sound off");
  createTopBar({ element: root });
  sound.click();
  assert.equal(master.getAttribute("aria-pressed"), "true");
  assert.deepEqual(state, { music: true, effects: true });
  assert.equal(root.querySelectorAll(".fui-top-bar-sound").length, 1);
});

test("preview mute disables the master switch and games without audio hide it", () => {
  const { document } = page();
  const root = document.createElement("header");
  createTopBar({ element: root });
  const sound = root.querySelector<HTMLButtonElement>(".fui-top-bar-sound")!;
  assert.equal(sound.hidden, true);
  let writes = 0;
  createTopBar({
    element: root,
    sound: {
      enabled: () => true,
      forcedMute: true,
      setEnabled() {
        writes++;
      },
    },
  });
  sound.click();
  assert.equal(sound.disabled, true);
  assert.equal(sound.hidden, false);
  assert.equal(sound.getAttribute("aria-label"), "Sound off");
  assert.equal(writes, 0);
});

test("initially empty room notices remain connected and visible outside the menu", () => {
  const { document } = page();
  const root = document.createElement("header");
  const notice = document.createElement("div");
  root.append(notice);
  document.body.append(root);
  createTopBar({ element: root });
  notice.textContent = "Connection lost. Retry.";
  assert.equal(notice.isConnected, true);
  assert.equal(notice.closest("dialog"), null);
  assert.equal(notice.parentElement?.className, "fui-top-bar-context");
  createTopBar({ element: root });
  assert.equal(
    root.querySelector(".fui-top-bar-context")?.textContent,
    "Connection lost. Retry.",
  );
});

test("the shared header retains account/menu handlers and reflects later per-game Elo updates", async () => {
  const { document } = page(),
    root = document.createElement("header"),
    brand = document.createElement("a"),
    nav = document.createElement("nav");
  nav.className = "fui-social";
  brand.textContent = "FUSE VOLLEY";
  const profile = document.createElement("button"),
    friends = document.createElement("button");
  profile.textContent = "Sign in";
  friends.textContent = "Friends";
  let opened = 0;
  profile.onclick = () => {
    opened++;
  };
  nav.append(profile, friends);
  root.append(brand, nav);
  document.body.append(root);
  createTopBar({ element: root, brand, gameId: "fuse-volley" });
  const account = root.querySelector<HTMLButtonElement>(
    ".fui-top-bar-account",
  )!;
  account.click();
  assert.equal(opened, 1);
  profile.textContent = "Andeplane\n1,000 ELO";
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(account.textContent, "Andeplane\n1,000 ELO");
  assert.equal(root.dataset.gameId, "fuse-volley");
  assert.ok(root.querySelector(".fui-top-bar-actions")!.contains(friends));
  const toggle = root.querySelector(".fui-top-bar-toggle");
  createTopBar({ element: root, gameId: "fuse-volley" });
  assert.equal(root.querySelectorAll(".fui-top-bar-toggle").length, 1);
  assert.equal(root.querySelector(".fui-top-bar-toggle"), toggle);
});

test("a reconciled header can be rebuilt without appending its old brand container to itself", () => {
  const { document } = page(),
    root = document.createElement("header");
  root.innerHTML = '<div class="brand">FUSE CRAFT</div>';
  document.body.append(root);
  createTopBar({ element: root, gameId: "fuse-craft" });
  const oldLeft = root.querySelector<HTMLElement>(".fui-top-bar-left")!;
  root.className = "nd-header";
  oldLeft.className = "brand";
  oldLeft.textContent = "FUSE CRAFT";
  createTopBar({ element: root, gameId: "fuse-craft" });
  assert.equal(root.querySelectorAll(".fui-top-bar-left").length, 1);
  assert.match(
    root.querySelector(".fui-top-bar-brand")!.textContent!,
    /FUSE CRAFT/,
  );
});

test("a key pressed in the bar's own controls stays there; one in the game's lent context reaches the game", () => {
  const { document, window } = page();
  const root = document.createElement("header");
  document.body.append(root);
  createTopBar({ element: root, music: false, gameId: "test-game" });
  const lent = document.createElement("button");
  root.querySelector(".fui-top-bar-context")!.append(lent);
  const heard: (EventTarget | null)[] = [];
  document.addEventListener("keydown", (event) => heard.push(event.target));
  const press = (target: Element) =>
    target.dispatchEvent(new window.Event("keydown", { bubbles: true }));
  press(root.querySelector(".fui-top-bar-toggle")!);
  assert.deepEqual(heard, [], "Space on ☰ opens the menu, not the bomb");
  press(lent);
  assert.deepEqual(
    heard,
    [lent],
    "focus left on the game's own button must not swallow its keys",
  );
});

test("a game menu the game keeps in the bar itself hears its keys; one taken into the bar's menu does not leak them", () => {
  const { document, window } = page();
  const heard: (EventTarget | null)[] = [];
  document.addEventListener("keydown", (event) => heard.push(event.target));
  const press = (target: Element) =>
    target.dispatchEvent(new window.Event("keydown", { bubbles: true }));
  const menu = () => {
    const element = document.createElement("div");
    element.className = "fui-game-menu";
    const resume = document.createElement("button");
    element.append(resume);
    return { element, resume };
  };
  const taken = menu();
  const root = document.createElement("header");
  root.append(taken.element);
  document.body.append(root);
  createTopBar({ element: root, music: false, gameId: "test-game" });
  const kept = menu();
  root.append(kept.element);
  press(taken.resume);
  assert.deepEqual(heard, [], "the dialog closes on Escape by itself");
  const key = (target: Element, name: string) =>
    target.dispatchEvent(
      Object.assign(new window.Event("keydown", { bubbles: true }), {
        key: name,
      }),
    );
  key(kept.resume, "Escape");
  key(kept.resume, "ArrowDown");
  assert.deepEqual(
    heard,
    [kept.resume, kept.resume],
    "Escape and the arrows reach the menu's document listeners",
  );
  key(kept.resume, " ");
  key(kept.resume, "Enter");
  assert.equal(
    heard.length,
    2,
    "Space and Enter press the focused button, and must not fire in the match too",
  );
});

test("a game's own menu in the header dialog closes that dialog when it resumes, and collapses when the dialog closes", () => {
  const { document, window } = page(),
    root = document.createElement("header"),
    log: string[] = [];
  const gameMenu = createGameMenu({
    document,
    controls: [],
    onLobby: () => log.push("lobby"),
    onOpenChange: (open) => log.push(open ? "menu open" : "menu closed"),
  });
  gameMenu.update({ canLobby: true });
  root.append(gameMenu.element);
  document.body.append(root);
  createTopBar({ element: root, gameId: "test-game", music: false });
  const dialog = root.querySelector<HTMLDialogElement>(".fui-top-bar-menu")!;
  // linkedom has no dialog methods: model the open flag and record the order of the close.
  let open = true;
  Object.defineProperty(dialog, "open", { get: () => open });
  Object.defineProperty(dialog, "close", {
    value: () => {
      open = false;
      log.push("dialog closed");
    },
  });
  const trigger = dialog.querySelector<HTMLButtonElement>(
    ".fui-game-menu-trigger",
  )!;
  assert.equal(trigger.textContent, "Game controls");
  const action = (name: string) =>
    [
      ...dialog.querySelectorAll<HTMLButtonElement>(".fui-game-menu-action"),
    ].find((button) => button.textContent === name)!;

  trigger.click();
  action("CONTROLS").click();
  const back = dialog.querySelector<HTMLButtonElement>(
    ".fui-game-menu .fui-back",
  )!;
  assert.equal(back.textContent, "Menu");
  back.click();
  assert.deepEqual(log, ["menu open"], "reading the controls keeps both open");
  action("BACK TO GAME").click();
  // linkedom runs capture listeners in bubble order, so only a browser shows the dialog closing first
  // (games/hook-havok/tests/browser-coverage-flow.ts asserts the arena regains focus).
  assert.deepEqual([...log].sort(), [
    "dialog closed",
    "menu closed",
    "menu open",
  ]);

  open = true;
  log.length = 0;
  trigger.click();
  action("BACK TO LOBBY").click();
  assert.deepEqual([...log].sort(), [
    "dialog closed",
    "lobby",
    "menu closed",
    "menu open",
  ]);

  // Escape or the dialog's own Close: the browser closes the dialog, and the menu must not stay open behind it.
  open = true;
  log.length = 0;
  trigger.click();
  open = false;
  dialog.dispatchEvent(new window.Event("close"));
  assert.deepEqual(log, ["menu open", "menu closed"]);
  assert.equal(gameMenu.isOpen(), false);
});

test("the bar's menu leads with Back to lobby and Main menu from the game menu, as the game allows them", () => {
  const { document } = page();
  const root = document.createElement("header"),
    log: string[] = [];
  const gameMenu = createGameMenu({
    document,
    controls: [],
    onLobby: () => log.push("lobby"),
    onLeave: () => log.push("main menu"),
  });
  root.append(gameMenu.element);
  document.body.append(root);
  createTopBar({ element: root, gameId: "test-game", music: false });
  const dialog = root.querySelector<HTMLDialogElement>(".fui-top-bar-menu")!;
  Object.defineProperty(dialog, "open", { get: () => true });
  Object.defineProperty(dialog, "close", { value: () => log.push("closed") });
  const body = dialog.querySelector<HTMLElement>(".fui-top-bar-actions")!;
  const rows = () =>
    [...body.children]
      .filter((row) => !(row as HTMLElement).hidden)
      .map((row) => row.textContent?.trim().split("\n")[0]);
  assert.deepEqual(rows().slice(0, 1), ["MAIN MENU"], "a guest can leave");
  gameMenu.update({ canLobby: true });
  assert.deepEqual(rows().slice(0, 2), ["BACK TO LOBBY", "MAIN MENU"]);
  const lobby = body.querySelector<HTMLButtonElement>(".fui-game-menu-lobby")!;
  assert.equal(
    lobby.parentElement,
    body,
    "one click away, not under Game controls",
  );
  lobby.click();
  body.querySelector<HTMLButtonElement>(".fui-game-menu-leave")!.click();
  // linkedom runs capture listeners in bubble order: a browser closes the dialog first.
  assert.deepEqual([...log].sort(), ["closed", "closed", "lobby", "main menu"]);
  gameMenu.update({ canLobby: false, canLeave: false });
  assert.equal(body.querySelector(".fui-game-menu-exit:not([hidden])"), null);
});

test("Escape nobody else used opens the bar's menu; Escape a page used as Back does not", async () => {
  const { document, window } = page();
  const root = document.createElement("header");
  document.body.append(root);
  createTopBar({ element: root, gameId: "test-game", music: false });
  const dialog = root.querySelector<HTMLDialogElement>(".fui-top-bar-menu")!;
  let opened = 0;
  Object.defineProperty(dialog, "showModal", { value: () => opened++ });
  const escape = (handled: boolean) => {
    const event = Object.assign(
      new window.Event("keydown", { bubbles: true, cancelable: true }),
      { key: "Escape" },
    );
    if (handled)
      document.addEventListener("keydown", (e) => e.preventDefault(), {
        once: true,
      });
    document.body.dispatchEvent(event);
  };
  const settle = () => new Promise((done) => setTimeout(done, 5));
  escape(true);
  await settle();
  assert.equal(opened, 0, "a page's Back took this Escape");
  escape(false);
  await settle();
  assert.equal(opened, 1, "Escape in a match opens the menu with the ways out");
});

test("a match that hides the bar gets a floating ☰ top right that opens the same menu", () => {
  const { document, window } = page();
  const root = document.createElement("header");
  document.body.append(root);
  createTopBar({ element: root, gameId: "test-game", music: false });
  const dialog = root.querySelector<HTMLDialogElement>(".fui-top-bar-menu")!;
  let opened = 0;
  Object.defineProperty(dialog, "showModal", { value: () => opened++ });
  const float = () => document.querySelector<HTMLElement>(".fui-top-bar-float");
  window.dispatchEvent(new window.Event("resize"));
  assert.ok(!float() || float()!.hidden, "the bar's own ☰ is on the screen");
  root.hidden = true;
  window.dispatchEvent(new window.Event("resize"));
  assert.equal(float()!.hidden, false);
  float()!.querySelector("button")!.click();
  assert.equal(opened, 1);
  assert.equal(dialog.parentElement, float(), "the menu opens where it shows");
  dialog.dispatchEvent(new window.Event("close"));
  assert.equal(dialog.parentElement, root, "and goes back to the bar");
  root.hidden = false;
  window.dispatchEvent(new window.Event("resize"));
  assert.equal(float()!.hidden, true);
});
