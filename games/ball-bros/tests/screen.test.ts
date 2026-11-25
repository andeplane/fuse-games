import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createTopBar } from "fuse-ui";
import type { Callbacks, Frame, RoomCommand } from "fuse-netcode";
import type { PlayFrame } from "fuse-ui/play-metrics";
import {
  mountGame,
  type Client,
  type ScreenOptions,
} from "../src/app/game-screen.js";
import { landing } from "../src/app/landing.js";
import {
  NAME_KEY,
  chosenMap,
  rememberRoom,
  rememberShared,
  roomFailure,
  safeStore,
  session,
} from "../src/app/session.js";
import { roomModel } from "../src/app/room-model.js";
import { installLifecycle } from "../src/app/lifecycle.js";
import {
  ballGame,
  createRoom,
  type RoomView,
  type Settings,
} from "../src/online/game.js";
import {
  createArena,
  type Impact,
  type Steering,
} from "../src/engine/state.js";

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("every BFCache restoration rebuilds the stopped runtime", () => {
  const listeners = new Map<string, (event: { persisted: boolean }) => void>();
  let stops = 0,
    restores = 0;
  installLifecycle(
    {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
    },
    {
      dispose() {
        stops++;
      },
      restore() {
        restores++;
      },
    },
  );
  listeners.get("pageshow")!({ persisted: false });
  assert.equal(restores, 0);
  for (let i = 0; i < 3; i++) {
    listeners.get("pagehide")!({ persisted: true });
    listeners.get("pageshow")!({ persisted: true });
  }
  assert.equal(stops, 3);
  assert.equal(restores, 3);
});

test("returning to the lobby clears the previous round's power timers", async () => {
  const s = screen();
  await flush();
  const f = frame("running");
  f.arena!.bases.find((b) => b.id === s.client.self)!.stickyUntil = 160;
  s.update(f);
  const powers = s.root.querySelector<HTMLElement>(".power-status")!;
  assert.match(powers.textContent!, /STICKY/);
  assert.equal(powers.hidden, false);
  s.update(frame());
  assert.equal(powers.textContent, "");
  assert.equal(powers.hidden, true);
  s.destroy();
});

test("a delayed room creation cannot navigate away from a newer screen", async () => {
  const { root } = dom();
  let complete!: (value: { code: string; token: string }) => void;
  let active = true,
    destination = "";
  const store = safeStore(() => {
    throw new Error();
  });
  const card = landing(root, {
    store,
    create: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    active: () => active,
    navigate: (query) => {
      destination = query;
      active = false;
    },
  });
  const map = root.querySelector<HTMLSelectElement>(".map-select")!;
  map.querySelector<HTMLOptionElement>('option[value="crossfire"]')!.selected =
    true;
  map.dispatchEvent(new root.ownerDocument.defaultView!.Event("change"));
  assert.equal(chosenMap(store), "crossfire");
  card.create.click();
  card.solo!.click();
  complete({ code: "AB42AA", token: "stale" });
  await flush();
  assert.equal(destination, "?solo=1");
  assert.equal(store.getItem("ball-bros-host-AB42AA"), null);
});
function frame(
  stage: "lobby" | "running" | "over" = "lobby",
  matchId = "match",
): Frame<RoomView> {
  const r = createRoom(matchId, { display: false, mapId: "classic" });
  for (const [slot, id] of ["a", "b"].entries())
    r.seats.set(id, {
      id,
      name: id === "a" ? "Alice" : "Bob",
      slot,
      bot: false,
      connected: true,
      generation: 1,
      avatarId: "robot",
    });
  r.stage = stage;
  if (stage !== "lobby") r.arena = createArena([...r.seats.values()]);
  if (stage === "over") {
    r.arena!.phase = "over";
    r.arena!.winner = "b";
  }
  return { ...ballGame.view(r), logTick: r.tick, managerId: "a" };
}
const dom = () => {
  const { document, window } = parseHTML(
    "<html><body><div id='app'></div></body></html>",
  );
  return {
    root: document.querySelector<HTMLElement>("#app")!,
    document,
    window,
  };
};
const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === text)!;

test("room identities are game-scoped, reloadable and never included in invites", async () => {
  const memory = safeStore(() => {
    throw new Error("blocked");
  });
  assert.equal(session("", memory, () => "guest").kind, "landing");
  assert.equal(session("?solo=1", memory, () => "guest").kind, "solo");
  assert.equal(
    session("?room=<script>", memory, () => "guest").kind,
    "invalid",
  );
  rememberRoom(memory, "AB42AA", "host-secret");
  rememberShared(memory, "AB42AA", true);
  assert.deepEqual(
    session("?room=ab42aa", memory, () => "unused"),
    {
      kind: "room",
      code: "AB42AA",
      token: "host-secret",
      display: false,
      shared: true,
    },
  );
  assert.equal(
    (
      session("?room=AB42AA&display=1", memory, () => "display-secret") as {
        token: string;
      }
    ).token,
    "display-secret",
  );
  const guest = session("?room=CD42AA", memory, () => "guest-secret");
  assert.deepEqual(
    session("?room=CD42AA", memory, () => "replacement"),
    guest,
  );
  const flaky = safeStore(() => ({
    getItem() {
      throw new Error();
    },
    setItem() {
      throw new Error();
    },
  }));
  flaky.setItem("x", "saved");
  assert.equal(flaky.getItem("x"), "saved");
  const readOnly = safeStore(() => ({
    getItem: () => "old-token",
    setItem() {
      throw new Error("quota");
    },
  }));
  readOnly.setItem("credential", "new-token");
  assert.equal(readOnly.getItem("credential"), "new-token");
  const backing = new Map<string, string>();
  const normal = safeStore(() => ({
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => {
      backing.set(k, v);
    },
  }));
  normal.setItem("x", "ok");
  assert.equal(normal.getItem("x"), "ok");
  assert.match(roomFailure("unknown game"), /solo/);
  assert.match(roomFailure("another game"), /another game/);
  assert.equal(roomFailure("Link failed"), "Link failed");

  const { root, window } = dom();
  let navigated = "",
    refuse = true;
  const card = landing(root, {
    store: memory,
    navigate: (q) => {
      navigated = q;
    },
    create: async () => {
      if (refuse) throw new Error("unknown game");
      return { code: "EF42AA", token: "new-secret" };
    },
  });
  card.create.click();
  await flush();
  assert.match(card.error.textContent!, /solo/);
  assert.equal(card.create.disabled, false);
  refuse = false;
  assert.equal(
    root.querySelector("input[type=checkbox]"),
    null,
    "Shared TV is chosen in the room, not on the first page",
  );
  card.create.click();
  await flush();
  assert.equal(navigated, "?room=EF42AA");
  assert.equal(
    (session("?room=EF42AA", memory, () => "unused") as { shared: boolean })
      .shared,
    false,
  );
  assert.ok(!root.textContent!.includes("new-secret"));
  card.solo!.click();
  assert.equal(navigated, "?solo=1");
  card.join.input.value = " ab42aa ";
  card.join.button.click();
  assert.equal(navigated, "?room=AB42AA");
  card.join.input.value = "?";
  card.join.input.dispatchEvent(
    Object.assign(new window.Event("keydown"), { key: "Enter" }),
  );
  assert.match(card.error.textContent!, /room code/);
});

function screen(
  online = true,
  display = false,
  shared = false,
  fail = "",
  closeHistory?: ScreenOptions["closeHistory"],
  awaitAdmission = false,
) {
  const { root, document, window } = dom();
  const inputs: [Steering, Steering, boolean][] = [],
    commands: RoomCommand<Settings>[] = [];
  const metrics: PlayFrame[] = [];
  const unavailableRooms: string[] = [];
  let callbacks!: Callbacks<RoomView, Impact, Settings>,
    paint!: (now: number) => void;
  let current = frame(),
    paints = 0,
    disposed = 0,
    stopped = 0,
    retries = 0,
    homes = 0,
    starts = 0,
    impacts = 0;
  let renderFails = fail === "paint",
    readyFails = fail === "ready";
  const events = new EventTarget(),
    store = safeStore(() => {
      throw new Error();
    });
  const client: Client = {
    self: display ? "tv" : "b",
    canManage: true,
    start() {
      starts++;
      if (awaitAdmission) return;
      callbacks.ready(client.self, true);
      callbacks.state(current, { display: shared, mapId: "classic" });
    },
    stop() {
      stopped++;
    },
    cancel() {
      inputs.push([0, 0, false]);
    },
    input(s, r = 0, l = false) {
      inputs.push([s, r, l]);
      return true;
    },
    command(c) {
      commands.push(c);
      return true;
    },
    frameTiming: () => ({ newer: current, tick: current.tick, lead: 0 }),
    confirmedFrame: () => current,
    historyReceipts: () => current.history,
  };
  const options: ScreenOptions = {
    ...(closeHistory ? { closeHistory } : {}),
    observePlay: (observed) => metrics.push(observed),
    online: online
      ? {
          code: "AB42AA",
          display,
          shared,
          link: "http://game/ball-bros/?room=AB42AA",
          displayLink: "http://game/ball-bros/?room=AB42AA&display=1",
        }
      : undefined,
    store,
    settings: { display: shared, mapId: "classic" },
    qr: async () => "data:image/png;base64,test",
    friends: {
      publicIdOfMember: (id) => `account-${id}`,
      friendButton(publicId) {
        const add = document.createElement("button");
        add.className = "friend";
        add.textContent = `ADD ${publicId}`;
        return add;
      },
    },
    events,
    audio: {
      muted: true,
      unlock() {},
      play() {},
      destroy() {
        disposed++;
      },
    },
    renderer: () => ({
      ready: readyFails
        ? Promise.reject(new Error("load failed"))
        : Promise.resolve(),
      paint() {
        if (renderFails) throw new Error();
        paints++;
      },
      impact() {
        impacts++;
      },
      destroy() {
        disposed++;
      },
    }),
    runtime(c) {
      callbacks = c;
      return client;
    },
    now: () => 10,
    frame(cb) {
      paint = cb;
      return 1;
    },
    cancelFrame() {},
    home() {
      homes++;
    },
    retry() {
      retries++;
    },
    roomUnavailable: (code) => unavailableRooms.push(code),
  };
  const destroy = mountGame(root, options);
  createTopBar({
    element: root.querySelector<HTMLElement>("header")!,
    sound: {
      enabled: () => !options.audio.muted,
      setEnabled: (on) => {
        options.audio.muted = !on;
      },
    },
  });
  return {
    root,
    document,
    window,
    client,
    inputs,
    commands,
    metrics,
    unavailableRooms,
    events,
    store,
    destroy,
    update(
      v: Frame<RoomView>,
      settings: Settings = { display: shared, mapId: "classic" },
    ) {
      current = v;
      callbacks.state(v, settings);
    },
    key(
      code: string,
      type = "keydown",
      target: HTMLElement | Document = document,
    ) {
      target.dispatchEvent(
        Object.assign(
          new window.Event(type, { bubbles: true, cancelable: true }),
          { code, repeat: false },
        ),
      );
    },
    draw() {
      paint(10);
    },
    status(text: string) {
      callbacks.status(text);
    },
    event() {
      callbacks.event({ kind: "block", x: 1, y: 1, slot: 1 }, "match", 1, 1);
    },
    ended() {
      callbacks.ended?.();
    },
    kicked() {
      callbacks.kicked?.();
    },
    repair() {
      renderFails = false;
      readyFails = false;
    },
    counters: () => ({
      paints,
      disposed,
      stopped,
      retries,
      homes,
      starts,
      impacts,
    }),
  };
}

test("an unavailable room never shows its invitation or seat controls", async () => {
  const s = screen(true, false, false, "", undefined, true);
  await flush();
  assert.equal(s.counters().starts, 1);
  assert.equal(s.root.querySelector<HTMLElement>(".room-panel")!.hidden, true);
  s.ended();
  assert.deepEqual(s.unavailableRooms, ["AB42AA"]);
  s.destroy();
});

test("Leave holds the actual runtime until history closes and reads fresh corrected receipts", async () => {
  let drain:
    | {
        read: () => import("fuse-ui/results-history").HistorySnapshot;
        stop: () => void;
      }
    | undefined;
  const s = screen(true, false, false, "", (read, stop) => {
    drain = { read, stop };
  });
  await flush();
  const predicted = frame("over");
  predicted.logTick = 5;
  predicted.history = [
    {
      tick: 7,
      result: {
        matchId: "old",
        length: 1,
        finishers: ["b"],
        players: [
          {
            playerId: "b",
            name: "Bob",
            slot: 1,
            roundsPlayed: 1,
            roundWins: 1,
            matchScoreUnits: 1,
            matchPlacement: 1,
            earlyExits: 0,
          },
        ],
      },
    },
  ];
  s.update(predicted);
  button(s.root, "Leave").click();
  assert.ok(drain);
  assert.equal(s.counters().homes, 0);
  assert.equal(s.counters().stopped, 0);
  assert.equal(drain.read().confirmedTick, 5);
  assert.equal(drain.read().receipts[0]!.tick, 7);
  const corrected = frame("running", "next");
  corrected.logTick = 8;
  s.update(corrected);
  assert.deepEqual(drain.read(), { receipts: [], confirmedTick: 8 });
  drain.stop();
  assert.equal(s.counters().homes, 1);
  assert.equal(s.counters().stopped, 1);
  s.destroy();
});

test("room screen follows lobby, own identity, controls, corrected results, rematch and leaving", async () => {
  const s = screen();
  await flush();
  assert.equal(s.root.querySelector<HTMLElement>(".room-panel")!.hidden, false);
  s.status("Direct link failed. Reconnect to retry.");
  assert.equal(
    s.root.querySelector(".status")!.parentElement,
    s.root,
    "connection failures stay visible outside the hidden arena",
  );
  assert.match(s.root.querySelector(".status")!.textContent!, /Reconnect/);
  button(s.root, "Add AI").click();
  const map = s.root.querySelector<HTMLSelectElement>(
    ".room-panel .map-select",
  )!;
  map.querySelector<HTMLOptionElement>('option[value="ricochet"]')!.selected =
    true;
  map.dispatchEvent(new s.window.Event("change"));
  assert.deepEqual(s.commands.at(-1), {
    type: "settings",
    settings: { display: false, mapId: "ricochet" },
  });
  s.update(frame(), { display: false, mapId: "ricochet" });
  assert.equal(map.value, "ricochet");
  // While the room waits its line is at the room's foot; the match's own line is hidden with the arena.
  assert.match(
    s.root.querySelector(".room-foot-status")!.textContent!,
    /Reconnect/,
  );
  assert.equal(s.root.querySelector<HTMLElement>(".status")!.hidden, true);
  assert.equal(
    s.root.querySelector(".topbar")!.textContent!.includes("AB42AA"),
    false,
    "the room's code is on its invitation only",
  );
  // Shared TV is the room's choice: the manager's tick asks the room, keeping the arena it has.
  const tv = s.root.querySelector<HTMLInputElement>(
    ".shared-tv input[type=checkbox]",
  )!;
  assert.equal(tv.closest<HTMLElement>(".shared-tv")!.hidden, false);
  tv.checked = true;
  tv.dispatchEvent(new s.window.Event("change"));
  assert.deepEqual(s.commands.at(-1), {
    type: "settings",
    settings: { display: true, mapId: "ricochet" },
  });
  // The room has not answered yet: an arena chosen in between keeps the tick instead of sending the old value back.
  map.querySelector<HTMLOptionElement>('option[value="classic"]')!.selected =
    true;
  map.dispatchEvent(new s.window.Event("change"));
  assert.deepEqual(s.commands.at(-1), {
    type: "settings",
    settings: { display: true, mapId: "classic" },
  });
  button(s.root, "START MATCH").click();
  assert.deepEqual(s.commands.at(-1), { type: "action", action: "start" });
  const lobby = frame();
  lobby.players.push({
    id: "bot-1",
    name: "Orbit",
    avatarId: "robot",
    slot: 2,
    connected: true,
    bot: true,
  });
  s.update(lobby);
  button(s.root, "REMOVE").click();
  // Only the bot's remove control is visible.
  const remove = [
    ...s.root.querySelectorAll<HTMLButtonElement>(".remove-bot"),
  ].find((b) => !b.hidden)!;
  remove.click();
  assert.deepEqual(s.commands.at(-1), {
    type: "bot",
    action: "remove",
    id: "bot-1",
  });
  const running = frame("running");
  running.arena!.bases[0]!.saves = 99;
  running.arena!.bases[1]!.saves = 3;
  s.update(running);
  s.update(running);
  s.draw();
  s.event();
  assert.equal(
    s.root.querySelector(".controller-identity")!.textContent,
    "P2 BOB",
  );
  s.key("KeyD");
  s.key("KeyW");
  assert.deepEqual(s.inputs.at(-1), [1, 1, false]);
  s.key("KeyD", "keyup");
  assert.deepEqual(s.inputs.at(-1), [0, 1, false]);
  s.events.dispatchEvent(new Event("blur"));
  assert.deepEqual(s.inputs.at(-1), [0, 0, false]);
  const sound = s.root.querySelector<HTMLButtonElement>(".fui-top-bar-sound")!;
  assert.equal(sound.getAttribute("aria-label"), "Sound off");
  s.key("Space", "keydown", sound);
  assert.deepEqual(s.inputs.at(-1), [0, 0, false]);
  sound.click();
  assert.equal(sound.getAttribute("aria-label"), "Sound on");
  s.key("Space");
  assert.deepEqual(s.inputs.at(-1), [0, 0, true]);
  s.key("Space", "keyup");
  const result = frame("over");
  result.arena!.bases[1]!.saves = 3;
  s.update(result);
  const results = s.root.querySelector<HTMLElement>(".fui-results")!;
  assert.equal(results.hidden, false);
  assert.equal(s.root.querySelector<HTMLElement>(".overlay")!.hidden, true);
  assert.equal(
    results.querySelector(".fui-results-victory h2")!.textContent,
    "BOB WINS",
  );
  // The winner first, tagged as this device's, with their saves; the other human gets the friend button.
  const rows = [...results.querySelectorAll("tbody tr")];
  assert.deepEqual(
    [...rows[0]!.querySelectorAll("td")].map((cell) => cell.textContent),
    ["01", "3", "0", "48"],
  );
  assert.ok(rows[0]!.classList.contains("is-you"));
  assert.deepEqual(
    rows.map((row) => row.querySelector(".friend")?.textContent),
    [undefined, "ADD account-a"],
  );
  s.update(result);
  assert.equal(results.querySelectorAll("tbody tr")[0], rows[0]);
  results
    .querySelector<HTMLButtonElement>('button[data-action="rematch"]')!
    .click();
  await flush();
  assert.deepEqual(s.commands.at(-1), { type: "action", action: "rematch" });
  button(s.root, "Back to lobby").click();
  assert.deepEqual(s.commands.at(-1), { type: "action", action: "lobby" });
  s.update(frame("running", "rematch"));
  assert.equal(results.hidden, true);
  s.update(result);
  button(s.root, "Leave").click();
  assert.equal(s.counters().homes, 1);
  s.update(frame("running", "rematch"));
  s.status("Link failed: retry");
  assert.match(s.root.querySelector(".status")!.textContent!, /Link failed/);
  button(s.root, "RECONNECT").click();
  button(s.root, "LEAVE").click();
  assert.equal(s.counters().retries, 1);
  assert.equal(s.counters().homes, 2);
  s.ended();
  assert.match(s.root.querySelector(".status")!.textContent!, /Room ended/);
  s.kicked();
  assert.match(s.root.querySelector(".status")!.textContent!, /removed/);
  s.destroy();
  assert.equal(s.counters().disposed, 2);
  assert.equal(s.counters().impacts, 1);
});

test("product metrics observe actual room frames while previews and drawing emit nothing", async () => {
  const preview = screen(false);
  preview.draw();
  assert.deepEqual(preview.metrics, []);
  preview.destroy();
  await flush();
  const s = screen();
  await flush();
  assert.equal(s.metrics.length, 1);
  assert.equal(s.metrics[0]!.active, false);
  s.draw();
  assert.equal(s.metrics.length, 1);
  s.update(frame("running"));
  assert.equal(s.metrics.at(-1)!.active, true);
  assert.equal(s.metrics.at(-1)!.seated, true);
  s.update(frame("over"));
  assert.equal(s.metrics.at(-1)!.ended, true);
  s.destroy();
});

test("shared phones show a controller, displays never play, and eliminated players stop sending", async () => {
  const phone = screen(true, false, true);
  await flush();
  phone.update(frame("running"));
  assert.ok(phone.root.classList.contains("controller-mode"));
  phone.draw();
  assert.equal(phone.counters().paints, 0);
  const dead = frame("running");
  dead.arena!.bases[1]!.alive = false;
  phone.update(dead);
  assert.equal(
    phone.root.querySelector<HTMLElement>(".touch-controls")!.hidden,
    true,
  );
  phone.destroy();
  const tv = screen(true, true, true);
  await flush();
  tv.update(frame("running"));
  tv.key("KeyA");
  assert.equal(
    tv.root.querySelector<HTMLElement>(".touch-controls")!.hidden,
    true,
  );
  assert.equal(
    tv.root.querySelector<HTMLElement>(".controller-identity")!.hidden,
    true,
  );
  assert.ok(tv.inputs.every((i) => i[0] === 0 && i[1] === 0));
  tv.update(frame("over"));
  // The TV shows the result and waits for the host: it has no next step of its own.
  const shown = tv.root.querySelector<HTMLElement>(".fui-results")!;
  assert.equal(shown.hidden, false);
  assert.equal(shown.querySelector("button[data-action]"), null);
  assert.equal(
    shown.querySelector(".fui-results-status")!.textContent,
    "Waiting for the host",
  );
  tv.destroy();
});

test("name entry, remembered lobby rejoin, renderer failures and solo restart remain usable", async () => {
  const s = screen();
  await flush();
  const empty = frame();
  empty.players = [];
  s.update(empty);
  const name = s.root.querySelector<HTMLInputElement>(".fui-name-input")!;
  name.value = "Bob";
  s.root
    .querySelector(".fui-name-entry")!
    .dispatchEvent(new s.window.Event("submit", { cancelable: true }));
  assert.deepEqual(s.commands.at(-1), {
    type: "join",
    name: "Bob",
    avatarId: "fox",
  });
  assert.equal(s.store.getItem(NAME_KEY), "Bob");
  s.update(empty);
  assert.deepEqual(s.commands.at(-1), {
    type: "join",
    name: "Bob",
    avatarId: "fox",
  });
  s.destroy();
  // A room whose arena stops keeps its failure in view: the next lobby frame must not hide both lines.
  const stalled = screen(true, false, false, "paint");
  await flush();
  stalled.update(frame());
  stalled.draw();
  stalled.update(frame());
  const line = stalled.root.querySelector<HTMLElement>(".status")!,
    room = stalled.root.querySelector<HTMLElement>(".room-panel")!;
  assert.equal(line.hidden, false);
  assert.match(line.textContent!, /rendering stopped/);
  assert.equal(room.hidden, true);
  stalled.repair();
  button(stalled.root, "RETRY ARENA").click();
  await flush();
  stalled.update(frame());
  assert.equal(room.hidden, false, "the retry brings the room back");
  stalled.destroy();
  for (const fault of ["ready", "paint"]) {
    const bad = screen(false, false, false, fault);
    await flush();
    if (fault === "paint") bad.draw();
    assert.equal(button(bad.root, "RETRY ARENA").hidden, false);
    bad.repair();
    button(bad.root, "RETRY ARENA").click();
    await flush();
    assert.ok(bad.counters().starts >= 1);
    bad.update(frame("running"));
    button(bad.root, "RESTART ROUND").click();
    await flush();
    assert.ok(bad.counters().starts >= 2);
    bad.update(frame("over"));
    button(bad.root, "PLAY AGAIN").click();
    await flush();
    assert.deepEqual(bad.commands.at(-1), {
      type: "action",
      action: "rematch",
    });
    bad.destroy();
  }
  const model = roomModel(
    frame("running"),
    "late",
    false,
    false,
    false,
    { display: false, mapId: "classic" },
    "a",
  );
  assert.equal(model.controls, false);
  assert.deepEqual(
    model.players.map((player) => player.host),
    [true, false],
    "the room's manager carries HOST",
  );
  assert.match(model.note, /lobby/);
  assert.equal(
    roomModel(frame(), "late", false, false, false, {
      display: false,
      mapId: "classic",
    }).askName,
    true,
  );
});
