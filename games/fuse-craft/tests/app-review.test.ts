import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  actionCue,
  mountFuseCraft,
  type AppDependencies,
} from "../src/app/app.js";
import { createAttractScene } from "../src/app/attract-scene.js";
import {
  createCueTracker,
  type PresentationAudio,
  type SoundCue,
} from "../src/app/audio.js";
import type {
  NeuralSession,
  OnlineDependencies,
  OnlineSession,
  RoomRules,
  RoomSnapshot,
} from "../src/app/contracts.js";
import { chartMarkup, reportPlayers } from "../src/app/match-report.js";
import { ROOM_MAPS } from "../src/online/maps.js";

/**
 * Regressions from the Fuse Craft app review: online results for players,
 * the help dialog's keyboard handling, the tutorial's start and failure,
 * the animation loop after a relaunch, the room lobby's portal and more.
 */

test("chart moment tooltips escape player names", () => {
  const world = createAttractScene();
  world.tick = 600;
  world.finished = true;
  world.winnerId = "blue";
  world.events = [{ tick: 300, playerId: "blue", type: "dominating" }];
  const players = reportPlayers(world, null, (id) =>
    id === "blue" ? '<img src=x onerror="alert(1)">' : undefined,
  );
  const chart = chartMarkup(world, "territory", players);
  assert.doesNotMatch(chart, /<img/);
  assert.match(chart, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("a draw plays its own neutral cue, not the defeat", () => {
  const track = createCueTracker();
  const world = createAttractScene();
  track(world, "blue");
  world.tick++;
  world.finished = true;
  world.winnerId = null;
  const cues = track(world, "blue").map((e) => e.cue);
  assert.ok(cues.includes("draw"));
  assert.ok(!cues.includes("defeat"));
});

test("the match bar mutes and unmutes sound and saves the choice", async () => {
  const f = fixture();
  await f.startSkirmish();
  const button = () => f.root.querySelector<HTMLElement>(".fui-top-bar-sound")!;
  assert.equal(button().getAttribute("aria-label"), "Sound off");
  f.click(".fui-top-bar-sound");
  assert.deepEqual(f.written, [false]);
  assert.equal(button().getAttribute("aria-label"), "Sound on");
  assert.ok(f.played.includes("toggle"));
  f.click(".fui-top-bar-sound");
  assert.deepEqual(f.written, [false, true]);
});

test("closing the top-right menu returns focus to a playing board", async () => {
  const f = fixture();
  await f.startSkirmish();
  const dialog = f.root.querySelector<HTMLDialogElement>(".fui-top-bar-menu")!;
  const board = f.root.querySelector<SVGSVGElement>("#nd-board")!;
  // linkedom does not implement focus on SVG elements.
  board.focus = () => f.focus(board);
  f.focus(f.root.querySelector(".fui-top-bar-toggle"));
  dialog.dispatchEvent(new f.root.ownerDocument.defaultView!.Event("close"));
  assert.equal(f.active(), board);
  f.app.dispose();
});

test("dialogs open and close with their own interface cues", async () => {
  const f = fixture();
  await f.startSkirmish();
  f.played.length = 0;
  f.click('[data-action="help"]');
  f.click('[role="dialog"] [data-action="close-help"]');
  assert.deepEqual(f.played, ["panel", "back"]);
});

test("each interface action picks a fitting cue", () => {
  assert.equal(actionCue("back-menu"), "back");
  assert.equal(actionCue("cancel-research"), "cancel");
  assert.equal(actionCue("particle-heavy"), "toggle");
  assert.equal(actionCue("mode-watch"), "panel");
  assert.equal(actionCue("start"), "select");
  assert.equal(actionCue(undefined), "select");
  // Placement and mute sound from their own handlers.
  assert.equal(actionCue("build-tower"), null);
  assert.equal(actionCue("toggle-mute"), null);
});

test("a finished online match shows a seated player their own victory", () => {
  const f = fixture({ online: { manager: false } });
  f.enterMatch();
  f.finish("blue");
  const result = f.root.querySelector("#match-result")!;
  assert.match(result.textContent!, /Victory/);
  assert.doesNotMatch(result.textContent!, /Blue wins/);
  assert.equal(
    f.root.querySelector(".watch-players"),
    null,
    "a player is not sent to the spectator view",
  );
  assert.doesNotMatch(f.root.textContent!, /AI vs AI/);
  assert.equal(
    f.root.querySelector('.session-controls [data-action="reset"]'),
    null,
    "only the host can send the room back to the lobby",
  );
  assert.equal(f.audioLocal(), "blue", "the result cue is the player's");
  assert.match(
    result.querySelector(".fui-results-status")!.textContent!,
    /Waiting for the host/,
  );
  assert.equal(
    result.querySelector(".fui-results-actions button"),
    null,
    "only the host gets the room's next steps",
  );
  assert.match(
    f.root.querySelector(".report-findings")!.textContent!,
    /Ada held/,
  );
  assert.ok(
    f.root.querySelector(".finding.good"),
    "the report reads from the player's side",
  );
  f.app.dispose();
});

test("a finished online match shows the loser a defeat", () => {
  const f = fixture({ online: { manager: true } });
  f.enterMatch();
  f.finish("coral");
  const result = f.root.querySelector("#match-result")!;
  assert.match(result.textContent!, /Defeat/);
  assert.deepEqual(
    Array.from(
      result.querySelectorAll<HTMLElement>(".fui-results-actions button"),
      (button) => button.dataset.action,
    ),
    ["lobby", "rematch"],
  );
  f.click('#match-result [data-action="lobby"]');
  assert.ok(f.calls.includes("lobby"));
  assert.ok(
    Array.from(
      f.root.querySelectorAll<HTMLButtonElement>(".fui-game-menu-action"),
    ).find(
      (button) => button.textContent === "BACK TO LOBBY" && !button.hidden,
    ),
    "the host keeps its Lobby control",
  );
  f.app.dispose();
});

test("an online spectator sees names, neutral text and no dead Restart", () => {
  const f = fixture({ online: { manager: false, self: "watcher" } });
  f.enterMatch();
  assert.ok(f.root.querySelector(".watch-players"));
  const cards = f.root.querySelector(".watch-players")!.textContent!;
  assert.match(cards, /Ada/);
  assert.doesNotMatch(cards, /balanced|pressure/, "no stale local openings");
  assert.equal(
    f.root.querySelector('.session-controls [data-action="reset"]'),
    null,
  );
  assert.match(f.root.querySelector(".hud-mini")!.textContent!, /Spectating/);
  const rival = f.world.players.find((p) => p.id === "coral")!;
  rival.dominanceSince = f.world.tick;
  f.publish();
  const banner = f.root.querySelector("#dominance-banner")!.textContent!;
  assert.doesNotMatch(banner, /defeat|victory/);
  assert.match(banner, /to a dominance win/);
  f.finish("blue");
  assert.match(f.root.querySelector("#match-result")!.textContent!, /wins/);
  assert.equal(f.audioLocal(), "", "spectators get no victory or defeat cue");
  f.app.dispose();
});

test("an online battlefield is labelled with the room's map", () => {
  const f = fixture({ online: { manager: true } });
  f.enterMatch();
  const title = ROOM_MAPS.find((m) => m.id === "close-quarters")!.title;
  assert.equal(
    f.root.querySelector(".game-layout")!.getAttribute("aria-label"),
    `${title} battlefield`,
  );
  f.app.dispose();
});

test("the app portal stays first in the room lobby's header after updates", () => {
  const f = fixture({ online: { manager: true } });
  const first = () =>
    f.root.querySelector(".nd-header .fui-top-bar-left")?.firstElementChild;
  assert.ok(
    first() === f.portal(),
    "portal precedes the brand in the shared header",
  );
  f.updateRoom((room) => {
    room.status = "Waiting for players";
  });
  assert.ok(first() === f.portal(), "room updates retain the same portal");
  assert.ok(
    f.root
      .querySelector('[data-action="start-room"]')!
      .classList.contains("fui-button-primary"),
    "lobby updates keep the Fuse button styling",
  );
  f.app.dispose();
});

test("help closes with Escape from anywhere and holds game shortcuts", async () => {
  const f = fixture();
  await f.startSkirmish();
  f.focus(f.root.querySelector('[data-action="help"]')!);
  f.click('[data-action="help"]');
  assert.equal(
    f.active()?.getAttribute("data-action"),
    "close-help",
    "focus moves into the dialog",
  );
  // A shortcut behind the dialog does nothing.
  f.press("w", "#nd-board");
  assert.equal(
    f.root.querySelector(".command-card")?.getAttribute("data-panel"),
    "inspect",
  );
  // Focus lost to the page body: Escape still closes the dialog.
  f.focus(null);
  f.press("Escape", "body");
  assert.equal(f.root.querySelector('[role="dialog"]'), null);
  assert.equal(
    f.active()?.getAttribute("data-action"),
    "help",
    "focus returns to the control that opened it",
  );
  f.press("w", "#nd-board");
  assert.equal(
    f.root.querySelector(".command-card")?.getAttribute("data-panel"),
    "build",
    "shortcuts work again once it is closed",
  );
  f.app.dispose();
});

test("a room change closes How to play", () => {
  const f = fixture({ online: { manager: true } });
  f.enterMatch();
  f.click('[data-action="help"]');
  assert.ok(f.root.querySelector('[role="dialog"]'));
  f.updateRoom((room) => {
    room.stage = "lobby";
  });
  f.updateRoom((room) => {
    room.stage = "running";
  });
  assert.equal(f.root.querySelector('[role="dialog"]'), null);
  assert.equal(
    f.root.querySelector(".game-layout")!.hasAttribute("inert"),
    false,
  );
  f.app.dispose();
});

test("every page under the menu has Back at the top left, and New game has Start beside it", () => {
  const f = fixture();
  for (const [open, title] of [
    ["guide", "How to play"],
    ["new-game", "New game"],
  ] as const) {
    f.click(`[data-action="${open}"]`);
    const head = f.root.querySelector(".screen-heading")!;
    assert.equal(head.firstElementChild?.className, "fui-back", title);
    assert.equal(head.querySelector(".fui-page-title")?.textContent, title);
    assert.equal(
      f.root.querySelectorAll('[data-action="back-menu"]').length,
      1,
      `${title} has one way back, in its head`,
    );
    if (open === "new-game")
      assert.ok(
        head.querySelector('.fui-page-actions [data-action="start"]'),
        "Start is at the top",
      );
    f.click('[data-action="back-menu"]');
    assert.ok(f.root.querySelector('[data-action="new-game"]'), "on the menu");
  }
  f.click('[data-action="new-game"]');
  // The app portal's open grid takes this Escape.
  const grid = f.root.ownerDocument.createElement("div");
  grid.className = "fui-portal-panel";
  f.root.ownerDocument.body.append(grid);
  f.press("Escape", "body");
  assert.equal(
    f.root.querySelector(".screen-heading h1")?.textContent,
    "New game",
  );
  grid.remove();
  f.press("Escape", "body");
  assert.ok(
    f.root.querySelector('[data-action="new-game"]'),
    "Escape is Back on a page",
  );
  f.app.dispose();
});

test("a slow room creation does not pull back someone who left", async () => {
  const f = fixture({ online: { manager: true, slowCreate: true } });
  f.click('[data-action="multiplayer"]');
  f.click('[data-action="create-room"]');
  f.click('[data-action="back-menu"]');
  f.resolveCreate();
  await settle();
  assert.ok(!f.calls.some((call) => call.startsWith("openRoom")));
  assert.ok(!f.calls.some((call) => call.startsWith("enterRoom")));
  assert.ok(f.root.querySelector('[data-action="new-game"]'), "still on menu");
  f.app.dispose();
});

test("the animation loop keeps running after a random-opening relaunch", async () => {
  const f = fixture();
  await f.startSkirmish();
  assert.equal(f.pendingFrames(), 1, "the first match animates");
  f.finish("blue");
  f.click('[data-action="reset"]');
  assert.equal(f.created(), 2, "a random opening relaunches the session");
  assert.equal(f.pendingFrames(), 1, "only the relaunched match animates");
  f.app.dispose();
});

test("a relaunch retains its light canvas and disposing the app releases it once", async () => {
  const { created, destroyed, createLightRenderer } = trackLightRenderers();
  const f = fixture({ createLightRenderer });
  await f.startSkirmish();
  f.finish("blue");
  f.click('[data-action="reset"]');
  assert.equal(created.length, 1, "the renderer belongs to the mounted canvas");
  assert.deepEqual(destroyed, []);
  assert.equal(f.pendingFrames(), 1);

  f.app.dispose();
  f.app.dispose();
  assert.deepEqual(destroyed, created);
  assert.equal(f.pendingFrames(), 0);
});

test("returning to a room unmounts the battlefield before the next match", () => {
  const { created, destroyed, createLightRenderer } = trackLightRenderers();
  const f = fixture({ online: { manager: true }, createLightRenderer });
  f.enterMatch();
  assert.equal(created.length, 1);
  assert.equal(f.pendingFrames(), 1);
  f.finish("blue");
  const result = f.root.querySelector<HTMLElement>("#match-result")!;
  assert.equal(result.hidden, false);

  f.updateRoom((room) => {
    room.stage = "lobby";
  });
  assert.deepEqual(destroyed, created);
  assert.equal(f.pendingFrames(), 0);
  assert.equal(result.hidden, true);
  assert.equal(result.isConnected, false);

  f.world.finished = false;
  f.enterMatch();
  assert.equal(created.length, 2);
  assert.notEqual(created[0], created[1]);
  assert.deepEqual(destroyed, [created[0]]);
  assert.equal(f.pendingFrames(), 1);
  f.app.dispose();
  assert.deepEqual(destroyed, created);
});

test("the tutorial waits for the player to select the brain, and a reset starts it over", async () => {
  const f = fixture();
  f.click('[data-action="tutorial"]');
  await settle();
  const coach = () => f.root.querySelector<HTMLElement>("#tutorial-coach")!;
  assert.match(coach().textContent!, /1\/10.*This is your brain/s);
  assert.match(
    f.root.querySelector(".inspector")!.textContent!,
    /Select a hex/,
  );
  f.click('[data-action="tutorial-next"]');
  assert.match(coach().textContent!, /2\/10.*Select your brain/s);
  f.selectCell(f.world.map.spawns[0]!.cellIndex);
  // The scenery already has neurons by deposits, so the coach moves past
  // the steps the player has done, starting with this one.
  assert.doesNotMatch(
    f.root.querySelector(".coach-progress")!.textContent!,
    /[12]\/10/,
  );
  f.click('[data-action="reset"]');
  f.click('[data-action="confirm-reset"]');
  assert.match(coach().textContent!, /1\/10.*This is your brain/s);
  assert.match(
    f.root.querySelector(".inspector")!.textContent!,
    /Select a hex/,
  );
  f.app.dispose();
});

test("a tutorial map that fails to load says so and leaves no coach behind", async () => {
  const f = fixture({ failTutorialMap: true });
  f.click('[data-action="tutorial"]');
  await settle();
  const alert = f.root.querySelector('[role="alert"]');
  assert.ok(alert, "the failure is shown");
  assert.match(alert.textContent!, /Tutorial map unavailable.*offline/s);
  assert.doesNotMatch(f.root.textContent!, /Loading maps/);
  f.click('[data-action="back-menu"]');
  await f.startSkirmish();
  assert.equal(
    f.root.querySelector<HTMLElement>("#tutorial-coach")!.hidden,
    true,
    "a later match has no coach",
  );
  f.app.dispose();
});

test("multiplayer copy matches the rooms' real sizes and controls", () => {
  const f = fixture({ online: { manager: true } });
  f.updateRoom((room) => {
    room.mapId = "close-quarters";
    room.seats = ["a", "b", "c", "d", "e"].map((id, slot) => ({
      id,
      name: id,
      slot,
      bot: true,
      connected: true,
      watcher: false,
    }));
  });
  assert.match(f.root.textContent!, /ask someone to leave/);
  assert.doesNotMatch(f.root.textContent!, /ask someone to watch/);
  f.click('[data-action="leave-room"]');
  f.click('[data-action="multiplayer"]');
  const most = Math.max(...ROOM_MAPS.map((m) => m.seats));
  assert.equal(most, 6, "Grand Cortex seats six");
  assert.match(f.root.textContent!, /Two to six networks depending on the map/);
  assert.doesNotMatch(f.root.textContent!, /Two to four/);
  f.app.dispose();
});

// --- helpers ---

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

interface FixtureOptions {
  online?: { manager: boolean; self?: string; slowCreate?: boolean };
  failTutorialMap?: boolean;
  createLightRenderer?: AppDependencies["createLightRenderer"];
}

function trackLightRenderers() {
  const created: HTMLCanvasElement[] = [];
  const destroyed: HTMLCanvasElement[] = [];
  const createLightRenderer: NonNullable<
    AppDependencies["createLightRenderer"]
  > = (canvas) => {
    created.push(canvas);
    const svg =
      canvas.parentElement!.querySelector<SVGSVGElement>("#nd-board")!;
    // Linkedom has no SVG layout. Only this board needs the missing method.
    svg.getScreenCTM = () => null;
    return {
      draw() {},
      destroy() {
        destroyed.push(canvas);
      },
    };
  };
  return { created, destroyed, createLightRenderer };
}

function fixture(options: FixtureOptions = {}) {
  const { document: dom } = parseHTML(
    '<html><body><div id="app"></div></body></html>',
  );
  const document = dom as unknown as Document;
  const view = dom.defaultView!;
  const EventConstructor = view.Event;
  // linkedom has no focus model: track focus on this test-local document so
  // the app's focus calls and reads of activeElement can be observed.
  let focused: Element | null = null;
  Object.defineProperty(document, "activeElement", { get: () => focused });
  const elementPrototype: { focus?: () => void } = Object.getPrototypeOf(
    document.createElement("button"),
  );
  elementPrototype.focus = function (this: Element) {
    focused = this;
  };
  const root = document.getElementById("app")!;
  const world = createAttractScene();
  const listeners = new Set<() => void>();
  const calls: string[] = [];
  let created = 0;
  let requested = 0;
  const pendingFrames = new Set<number>();
  let audioLocal: string | undefined;
  const played: SoundCue[] = [];
  const written: boolean[] = [];
  const audio: PresentationAudio = {
    configure() {},
    unlock() {},
    play(cue) {
      played.push(cue);
    },
    present(_world, local) {
      audioLocal = local;
    },
    dispose() {},
  };
  // Single player: blue at spawn slot 0, so its spawn is its brain.
  const local = (mode: string): NeuralSession => ({
    localPlayerId: "blue",
    canControl: mode !== "watch",
    view: () => world,
    dispatch() {},
    dispatchBatch() {
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {},
    dispose() {},
  });
  const room: RoomSnapshot = {
    code: "AB12AA",
    stage: "lobby",
    seats: [
      { id: "blue", name: "Ada", slot: 0, bot: false, connected: true },
      { id: "coral", name: "Bo", slot: 1, bot: false, connected: true },
    ].map((seat) => ({ ...seat, watcher: false })),
    self: options.online?.self ?? "blue",
    manager: options.online?.manager ?? false,
    status: "",
    closed: "",
    mapId: "close-quarters",
    aiStrategy: "balanced",
    powerups: true,
  };
  const online: OnlineSession = {
    confirmedView: () => ({
      ...world,
      seats: room.seats,
      decided: null,
      history: [],
      logTick: 0,
    }),
    code: "AB12AA",
    get localPlayerId() {
      return room.self;
    },
    get canControl() {
      return (
        room.stage === "running" &&
        world.players.some((p) => p.id === room.self)
      );
    },
    view: () => world,
    dispatch() {},
    dispatchBatch() {
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {},
    dispose() {},
    room: () => ({ ...room, seats: [...room.seats] }),
    join() {},
    addBot() {},
    removeBot() {},
    configure(change: Partial<RoomRules>) {
      calls.push(`configure:${JSON.stringify(change)}`);
    },
    start() {},
    rematch() {},
    lobby() {
      calls.push("lobby");
    },
  };
  let resolveCreate: () => void = () => {};
  const onlineDependencies: OnlineDependencies = {
    createRoom() {
      calls.push("createRoom");
      if (!options.online?.slowCreate)
        return Promise.resolve({ code: "AB12AA" });
      return new Promise((resolve) => {
        resolveCreate = () => resolve({ code: "AB12AA" });
      });
    },
    openRoom(code) {
      calls.push(`openRoom:${code}`);
      return online;
    },
    validCode: (code) => /^[A-Z0-9]{6}$/.test(code),
    roomLink: (code) => `https://fuse.test/fuse-craft/?room=${code}`,
    enterRoom: (code) => calls.push(`enterRoom:${code}`),
    leaveRoom: () => calls.push("leaveRoom"),
    savedName: () => "",
    saveName() {},
  };
  const portal = document.createElement("nav");
  portal.className = "fui-portal portal-stub";
  const dependencies: AppDependencies = {
    maps: {
      async list() {
        return [
          {
            id: world.map.id,
            title: "Test map",
            description: "",
            width: 14,
            height: 10,
            url: "",
          },
        ];
      },
      async load(id) {
        if (options.failTutorialMap && id === "sandbox-12")
          throw new Error("The map server is offline.");
        return world.map;
      },
    },
    preferences: {
      read: () => ({
        mute: true,
        volume: 0.5,
        reducedMotion: true,
        edgeScroll: true,
      }),
      write(value) {
        written.push(value.mute);
      },
    },
    createSession(_map, _slot, mode) {
      created++;
      return local(mode);
    },
    debug: false,
    random: () => 0,
    portal: () => portal,
    audio,
    createLightRenderer: options.createLightRenderer,
    animationClock: () => 0,
    requestFrame() {
      const handle = ++requested;
      pendingFrames.add(handle);
      return handle;
    },
    cancelFrame(handle) {
      pendingFrames.delete(handle);
    },
    ...(options.online ? { online: onlineDependencies } : {}),
    ...(options.online && !options.online.slowCreate
      ? { initialRoom: "AB12AA" }
      : {}),
  };
  const app = mountFuseCraft(root, dependencies);
  const publish = () => {
    for (const listener of [...listeners]) listener();
  };
  const click = (selector: string) => {
    const element = root.querySelector<HTMLElement>(selector);
    assert.ok(element, `missing ${selector}`);
    element.click();
  };
  return {
    root,
    world,
    app,
    calls,
    click,
    publish,
    portal: () => portal,
    created: () => created,
    audioLocal: () => audioLocal,
    played,
    /** Each saved preference's mute setting, in order. */
    written,
    resolveCreate: () => resolveCreate(),
    active: () => focused,
    focus(element: Element | null) {
      focused = element;
    },
    pendingFrames: () => pendingFrames.size,
    async startSkirmish() {
      click('[data-action="new-game"]');
      await settle();
      click('[data-action="start"]');
    },
    updateRoom(edit: (room: RoomSnapshot) => void) {
      edit(room);
      publish();
    },
    enterMatch() {
      room.stage = "running";
      publish();
    },
    finish(winnerId: string) {
      world.tick += 20;
      world.finished = true;
      world.winnerId = winnerId;
      world.victory = "dominance";
      world.timeline = [
        {
          tick: world.tick,
          players: world.players.map((p) => ({
            id: p.id,
            territory: p.id === winnerId ? 60 : 20,
            structures: 5,
            weapons: 1,
            biomassEarned: 1000,
            insightEarned: 0,
            damage: 0,
            lost: 0,
            biomass: 0,
          })),
        },
      ];
      if (options.online) room.stage = "over";
      publish();
    },
    selectCell(cell: number) {
      root
        .querySelector(`[data-cell="${cell}"]`)!
        .dispatchEvent(new EventConstructor("click", { bubbles: true }));
    },
    press(key: string, selector: string) {
      class KeyEvent extends EventConstructor {
        readonly key = key;
        readonly ctrlKey = false;
        readonly metaKey = false;
        readonly altKey = false;
        readonly repeat = false;
        readonly shiftKey = false;
      }
      const target =
        selector === "body"
          ? document.body
          : (root.querySelector(selector) ?? document.body);
      target.dispatchEvent(
        new KeyEvent("keydown", { bubbles: true, cancelable: true }),
      );
    },
  };
}
