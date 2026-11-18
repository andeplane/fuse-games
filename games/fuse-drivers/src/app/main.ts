import { createTopBar } from "fuse-ui";
import {
  bindAudioInput,
  browserAudioDependencies,
  createAudioControl,
  createGameAudio,
} from "fuse-ui/game-audio";
import "fuse-ui/game-audio.css";
import { createOffroadAudio } from "./offroad-audio.js";
import {
  playtestInputBlocked,
  registerPlaytestInput,
} from "fuse-ui/playtest-input";
import { requestedRoomSlot } from "fuse-ui";
import { createGameSocial } from "fuse-ui/social";
import "fuse-ui/social.css";
import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import { createModalInputGate } from "fuse-ui/modal-input";
import { createAppPortal } from "fuse-ui/portal";
import { createPlayMetrics, startGameAnalytics } from "fuse-ui/play-metrics";
import "fuse-ui/results.css";
import "./fuseDrivers.css";
import "./race-results.css";
import QRCode from "qrcode";
import {
  PeerTransport,
  createEndpoints,
  createRoom,
  installRoomLifecycle,
  validRoomCode,
} from "fuse-network-fe";
import {
  MAX_PACKET_BYTES,
  TICK_MS,
  createLeadClock,
  ticksAhead,
  uuid,
} from "fuse-netcode";
import {
  button,
  createControllerRow,
  createDialog,
  createInviteCard,
  createLandingCard,
  createRoomLayout,
  createNameEntry,
  createNotice,
  createResultsScreen,
  createRoundControls,
  createRoster,
  createSharedTvOption,
  el,
} from "fuse-ui";
import {
  DEFAULT_SETTINGS,
  fuseDriversGame,
  seatName,
  isBotId,
} from "../game/index.js";
import { createRaceOptions } from "./race-options.js";
import { readStadiumTheme, storeStadiumTheme } from "./arena/theme.js";
import { createPitShop } from "./pit-shop.js";
import { NEUTRAL_INPUT, type TruckInput } from "../game/sim/input.js";
import type { RaceState } from "../game/sim/race.js";
import {
  mountArena,
  renderSnapshot,
  type MountedArena,
} from "./arena/index.js";
import { createSmoother, forward } from "./forward.js";
import { presentTable, type TableModel, type Viewer } from "./presenter.js";
import { resultBar, resultReport } from "./result-report.js";
import { createReportDispatcher, dueReports, sendReport } from "./reports.js";
import { FuseDriversRuntime, type FuseDriversCallbacks } from "./runtime.js";
import { keys, roomFailure, safeStore, sessionFor } from "fuse-ui/room-session";
import { playFrame, confirmedPlayFrame } from "./play-metrics.js";

/**
 * The page's glue: it reads the query, builds the screens from fuse-ui, wires the runtime to the transport,
 * and hands every animation frame to the arena. The decisions live in the presenter, the reports and the
 * session modules, which are unit-tested; this file only puts their answers on the page.
 */
const GAME = fuseDriversGame.id;
const query = new URLSearchParams(location.search);
/** `?lead=off` draws the old way, between the two newest folded races, to compare the feel against. */
const drawAhead = query.get("lead") !== "off",
  /** `?probe` publishes the heading this device's truck was last drawn at, for `scripts/lead-press-latency.ts`. */
  probe = query.has("probe");
const analytics = startGameAnalytics(GAME);
const observePlay = createPlayMetrics(analytics.track, () => performance.now());
const social = createGameSocial({
  gameId: GAME,
  base: import.meta.env.BASE_URL,
  apiOrigin: import.meta.env.VITE_API_ORIGIN,
  document,
  window,
  fetch: (input, init) => fetch(input, init),
  track: analytics.track,
});
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME.replaceAll("-", "")}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const store = safeStore(() => localStorage);
const audio = createGameAudio(browserAudioDependencies(store), {
  forceMute: query.has("mute"),
});
const audioControl = createAudioControl(document, audio, { music: false });
const unbindAudio = bindAudioInput(audio, document, window);
audio.setHidden(document.hidden);
function gameLink(search = "") {
  const url = new URL(endpoints.appUrl(search));
  if (audio.forcedMute) url.searchParams.set("mute", "");
  return url.href;
}
const names = keys(GAME);
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
const app = document.querySelector<HTMLElement>("#app")!;
/** The truck sprites' colours by grid slot (`TRUCK_COLORS` in the arena), as the page can paint them. */
const TRUCK_HEX = ["#10e0f0", "#f050a0", "#a0f020", "#f09020", "#b050f0"];
const truckColor = (truck: number): string =>
  TRUCK_HEX[truck % TRUCK_HEX.length] ?? "#ffffff";

function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "fd-top");
  const brand = el("a", "FUSE DRIVERS", "fd-brand");
  (brand as HTMLAnchorElement).href = import.meta.env.BASE_URL;
  bar.append(
    createAppPortal({
      document,
      current: GAME,
      base: import.meta.env.BASE_URL,
      search: location.search,
    }).element,
    brand,
    social.element(),
    audioControl.element,
    ...extra,
  );
  return createTopBar({
    element: bar,
    gameId: GAME,
    sound: audioControl.sound,
  });
}

const drivingGuide = {
  goal: "Cross the finish line first after four laps. Lift off the gas for tight corners and spend nitro on the straights. Collect cash and spend your prize in the speed shop between races.",
  controls: [
    { keys: "A / ←", action: "Steer left" },
    { keys: "D / →", action: "Steer right" },
    { keys: "W / ↑", action: "Hold to accelerate, release to coast" },
    { keys: "Shift / Space", action: "Use nitro" },
  ],
  touchControls: [
    { keys: "◀ / ▶", action: "Steer while holding GAS" },
    { keys: "GAS", action: "Hold to accelerate, release to coast" },
    { keys: "NITRO", action: "Use nitro" },
  ],
};

const battleGuide = {
  ...drivingGuide,
  controls: [
    ...drivingGuide.controls,
    { keys: "E", action: "Use your Battle item" },
  ],
  touchControls: [
    ...drivingGuide.touchControls,
    { keys: "ITEM", action: "Use your Battle item" },
  ],
};

function landing(): void {
  const card = createLandingCard({
    howToPlay: {
      ...battleGuide,
      goal:
        drivingGuide.goal +
        " In Battle, drop a timed firebomb or activate a shield. Drive through an item crate to refill.",
    },
    background: async (host, signal) =>
      (await import("./attract.js")).createAttract(host, signal),
    title: "FUSE DRIVERS",
    tagline:
      "Choose your course and race a series against computer drivers or friends. Up to five drivers share the grid.",
    soloText: "RACE THE CPU",
    async onCreate() {
      const room = await createRoom(endpoints.apiUrl, fetch, GAME).catch(
        (error: unknown) => {
          throw new Error(
            roomFailure(error instanceof Error ? error.message : String(error)),
          );
        },
      );
      store.setItem(names.host(room.code), room.token);
      location.href = gameLink(`?room=${room.code}`);
    },
    onSolo: () => {
      location.href = gameLink("?solo=1");
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = gameLink(`?room=${code}`);
    },
  });
  app.replaceChildren(header(), card.element);
}

/** The keys a driver holds, read every frame rather than on each event, so a held turn keeps turning. */
function keyboardControls(
  blocked: () => boolean,
  itemChanged: () => void,
): {
  read: () => TruckInput;
  clear: () => void;
  stop: () => void;
} {
  const down = new Set<string>();
  const key = (event: KeyboardEvent) => event.key.toLowerCase();
  const onDown = (event: KeyboardEvent) => {
    if (blocked()) return;
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLButtonElement
    )
      return;
    down.add(key(event));
    if (key(event) === "e" && !event.repeat) itemChanged();
    if ([" ", "arrowleft", "arrowright", "arrowup"].includes(key(event)))
      event.preventDefault();
  };
  const onUp = (event: KeyboardEvent) => {
    if (down.delete(key(event)) && key(event) === "e") itemChanged();
  };
  const clear = () => down.clear();
  addEventListener("keydown", onDown);
  addEventListener("keyup", onUp);
  addEventListener("blur", clear);
  return {
    clear,
    read: () => ({
      left: down.has("arrowleft") || down.has("a"),
      right: down.has("arrowright") || down.has("d"),
      gas: down.has("arrowup") || down.has("w"),
      nitro: down.has("shift") || down.has(" "),
      brake: false,
      item: down.has("e"),
      itemAlt: false,
    }),
    stop: () => {
      removeEventListener("keydown", onDown);
      removeEventListener("keyup", onUp);
      removeEventListener("blur", clear);
    },
  };
}

function room(solo: boolean): void {
  const session = solo
    ? ({ kind: "solo" } as const)
    : sessionFor(location.search, store, GAME, validRoomCode, secret);
  if (session.kind === "invalid" || session.kind === "landing") {
    app.replaceChildren(header(), el("p", "Invalid room code", "fd-error"));
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO";
  const role = session.kind === "room" ? session.role : "host";
  const display = role === "display";
  const viewer: Viewer = {
    me: "",
    host: solo || role === "host",
    solo,
    display,
    shared: false,
  };

  // The room's state is one line: at the lobby's foot while the room waits, beside the menu while a race is on.
  // What went wrong is said apart from it, above the room, so a failure is never a quiet line at the foot.
  const status = createNotice({ className: "fd-status" }),
    live = createNotice({ className: "fd-live" }),
    problem = createNotice({ className: "fd-alert" });
  const say = (text: string, tone: "info" | "error") => {
    if (tone === "error") {
      status.clear();
      live.clear();
      problem.show(text, "error");
    } else {
      problem.clear();
      status.show(text, "info");
      live.show(text, "info");
    }
  };
  const lobbyNote = el("p", "", "fui-lobby-note");
  const roster = createRoster({ emptyText: "Nobody has joined yet" });
  const start = button("START RACE", "fui-button-primary");
  const addAI = button("Add AI");
  addAI.onclick = () =>
    runtime.command({
      type: "bot",
      action: "add",
      slot: requestedRoomSlot(addAI),
    });
  let roomSettings = DEFAULT_SETTINGS;
  let requestedSettings: typeof DEFAULT_SETTINGS | undefined;
  function changeSettings(change: Partial<typeof DEFAULT_SETTINGS>) {
    const next = { ...(requestedSettings ?? roomSettings), ...change };
    if (!runtime.command({ type: "settings", settings: next })) return false;
    requestedSettings = next;
    raceOptions.update(next, true);
    return true;
  }
  const previewTheme = query.get("theme");
  let stadiumTheme =
    previewTheme === "classic" || previewTheme === "fuse"
      ? previewTheme
      : readStadiumTheme(store);
  const raceOptions = createRaceOptions(
    changeSettings,
    stadiumTheme,
    (theme) => {
      stadiumTheme = theme;
      storeStadiumTheme(store, theme);
    },
  );
  const lobby = el("section", "", "fd-lobby");
  if (!solo)
    lobby.append(
      createInviteCard({
        code,
        link: gameLink(`?room=${code}`),
        qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
      }).element,
    );
  lobby.append(roster.element, start);
  // Shared TV is the room's choice, made in the room: the host turns it on here and opens the screen beside it.
  // The choice is remembered for the next room this device creates.
  const sharedTv = createSharedTvOption({
    className: "fd-tv-option",
    onChange: (display) => {
      const sent = changeSettings({ display });
      if (sent) store.setItem(names.shared, display ? "1" : "0");
      return sent;
    },
    onOpenScreen: () =>
      window.open(gameLink(`?room=${code}&display=1`), "_blank"),
  });

  const nameEntry = createNameEntry({
    normalize: (raw) => seatName(raw) ?? "",
    initial: social.playerName(store.getItem(names.name)) ?? "",
    onInput: (value) => store.setItem(names.name, value),
    buttonText: "JOIN THE GRID",
    onSubmit: (name) => {
      store.setItem(names.name, name);
      runtime.command({
        type: "join",
        name,
        slot: requestedRoomSlot(nameEntry.form),
      });
    },
  });

  const canvas = document.createElement("canvas");
  canvas.className = "fd-arena";
  const hud = el("p", "", "fd-hud");
  // The result: the shared results screen over the page, on a phone controller and the TV too.
  let shopView: Parameters<FuseDriversCallbacks["state"]>[0] | undefined;
  const shop = createPitShop(
    document,
    (kind) => !!shopView && runtime.buyUpgrade(kind, shopView),
  );
  const lobbyShopButton = button("Speed shop", "fui-button");
  const lobbyShop = createDialog({ title: "Speed shop", document });
  lobbyShopButton.onclick = () => {
    if (shopView?.phase === "lobby")
      lobbyShop.show({ title: "Speed shop", content: [shop.element] });
  };
  const results = createResultsScreen({
    document,
    // The screen covers the page's header: whoever is not the host still has a way out of the room.
    onBack: () => {
      runtime.stop();
      location.href = gameLink();
    },
    backText: "Leave",
    onAction: (id) => {
      if (id === "shop") shop.focus();
      else if (id === "rematch" || id === "lobby")
        runtime.command({ type: "action", action: id });
    },
  });
  /** What the results screen last showed: it is rebuilt only when the result itself changed. */
  let shownResult = "";
  const race = el("section", "", "fd-race");
  race.classList.toggle("fd-display", display);
  const arenaBox = el("div", "", "fd-arena-box");
  arenaBox.append(canvas);
  race.append(arenaBox, hud);

  // Touch drivers steer with the same controls the keyboard writes, held while a finger is down.
  const touch = { ...NEUTRAL_INPUT };
  const pad = createControllerRow({
    className: "fui-controller fd-pad",
    buttons: [
      {
        label: "◀",
        keys: "ArrowLeft A",
        title: "Steer left",
        onPress: () => {
          if (!modalInput.blocked()) touch.left = true;
        },
        onRelease: () => (touch.left = false),
      },
      {
        label: "GAS",
        keys: "ArrowUp W",
        title: "Hold to accelerate",
        onPress: () => {
          if (!modalInput.blocked()) touch.gas = true;
        },
        onRelease: () => (touch.gas = false),
      },
      {
        label: "NITRO",
        keys: "Shift Space",
        title: "Use nitro",
        onPress: () => {
          if (!modalInput.blocked()) touch.nitro = true;
        },
        onRelease: () => (touch.nitro = false),
      },
      {
        label: "▶",
        keys: "ArrowRight D",
        title: "Steer right",
        onPress: () => {
          if (!modalInput.blocked()) touch.right = true;
        },
        onRelease: () => (touch.right = false),
      },
      {
        label: "ITEM",
        keys: "E",
        title: "Use your Battle item",
        onPress: () => {
          if (!modalInput.blocked()) {
            touch.item = true;
            drive();
          }
        },
        onRelease: () => {
          touch.item = false;
          drive();
        },
      },
    ] as const,
  });
  const roundControls = createRoundControls(drivingGuide);
  const touchDevice = window.matchMedia("(pointer: coarse)");
  race.append(pad.element, roundControls.element);

  const main = el("main", "", "fd-room");
  // Until the first view arrives there is nothing to show but the lobby: a room with no host yet would
  // otherwise show an empty arena and an empty results table at the same time.
  race.hidden = true;
  start.hidden = true;
  main.append(
    problem.element,
    nameEntry.form,
    lobby,
    race,
    results.element,
    lobbyShop.dialog,
  );
  // The room's code is on its invitation, and in the lobby its state is at the lobby's foot: the bar holds the
  // state only while a race is on.
  app.replaceChildren(header([live.element]), main);
  /** This device's own seat in the lobby, as the last frame had it. */
  let ownSeat: { name: string; slot: number } | undefined;
  createRoomLayout({
    // Seated already: any open seat is a move, and the truck's colour follows it.
    ownSlot: () => ownSeat?.slot,
    onMove: (slot) => {
      if (ownSeat) runtime.command({ type: "join", name: ownSeat.name, slot });
    },
    primaryAction: start,
    playerName: () => social.playerName(undefined) ?? undefined,
    background: async (host) =>
      (await import("./attract.js")).createAttract(
        host,
        undefined,
        () => stadiumTheme,
      ),
    element: lobby,
    roster,
    capacity: 5,
    slotColor: truckColor,
    join: nameEntry.form,
    // ADD FRIEND on a driver's row and INVITE FRIENDS under Copy link: the shared room's, in every game.
    friends: social.friends,
    addAI,
    layout: "configuration",
    configuration: [raceOptions.element],
    settings: [raceOptions.settingsField],
    actions: [lobbyShopButton, lobbyNote],
    // Back, Settings and START lead the room and stay there; the invitation and the drivers scroll under them.
    actionsInHeader: true,
    extras: [sharedTv.element],
    status: status.element,
    ...(solo ? { compact: true, heading: "Solo race" } : { heading: "Room" }),
  });

  const render = (model: TableModel) => {
    ownSeat = model.lobby.own;
    lobby.hidden = model.screen !== "lobby";
    race.hidden = model.screen === "lobby";
    nameEntry.form.hidden = !model.askName;
    canvas.hidden = viewer.shared && !display && !solo;
    arenaBox.hidden = canvas.hidden;
    roster.update(model.lobby.members);
    addAI.hidden = !viewer.host || display || model.lobby.members.length >= 5;
    if (model.screen === "lobby") {
      raceOptions.update(
        requestedSettings ?? roomSettings,
        viewer.host && !display,
      );
      for (const [id, row] of roster.entries()) {
        if (!isBotId(id)) continue;
        const existing = row.querySelector<HTMLButtonElement>(".fd-remove-ai");
        if (!viewer.host || display) existing?.remove();
        else if (!existing) {
          const remove = button("Remove", "fd-remove-ai");
          remove.setAttribute(
            "aria-label",
            `Remove ${model.lobby.members.find((m) => m.id === id)?.name ?? "AI"}`,
          );
          remove.onclick = () =>
            runtime.command({ type: "bot", action: "remove", id });
          row.append(remove);
        }
      }
    }
    start.hidden = !model.lobby.showStart;
    start.disabled = !model.lobby.canStart;
    if (lobbyNote.textContent !== model.lobby.note)
      lobbyNote.textContent = model.lobby.note;
    lobbyNote.hidden = !model.lobby.note;
    main.dataset.screen = model.screen;
    sharedTv.update(
      requestedSettings?.display ?? viewer.shared,
      viewer.host && !display && !solo && model.screen === "lobby",
    );
    if (model.race) {
      const mine = model.race.drivers.find((driver) => driver.you);
      const lap = `LAP ${model.race.lap}/${model.race.laps}`;
      const identity =
        mine && canvas.hidden && model.race.countdown > 0
          ? `YOU · TRUCK ${mine.truck + 1}   `
          : "";
      hud.textContent = mine
        ? `${identity}${lap}   POS ${mine.place}/${model.race.drivers.length}   NITRO ${mine.nitros}`
        : lap;
      const battle = latest?.race?.battle;
      const held = mine && battle?.slots[mine.truck]?.held;
      pad.buttons[4].hidden = !battle;
      pad.buttons[4].disabled = !held;
      if (mine && battle)
        hud.textContent += "   ITEM " + (held?.toUpperCase() ?? "EMPTY");
    }
    const result = model.results;
    const seat =
      (result || model.screen === "lobby") && !display
        ? latest?.drivers.find(
            (driver) =>
              driver.id === viewer.me &&
              driver.connected &&
              !driver.bot &&
              (model.screen === "lobby" || driver.truck >= 0),
          )
        : undefined;
    shopView =
      seat && !latest?.seriesComplete && latest?.garage[seat.id]
        ? latest
        : undefined;
    const wallet = shopView?.garage[viewer.me];
    lobbyShopButton.hidden = model.screen !== "lobby" || !wallet;
    if (lobbyShopButton.hidden && lobbyShop.dialog.open)
      lobbyShop.dialog.close();
    if (wallet) shop.update(wallet);
    if (!result) {
      if (results.open) results.hide();
      shownResult = "";
    } else {
      // The bar's own fields do not rebuild the report; an account that turns up after the race gets its button.
      const shown = JSON.stringify([
        { ...result, host: false, waiting: "" },
        !!wallet,
        result.rows.map((row) => social.friends.publicIdOfMember(row.id)),
      ]);
      if (shown !== shownResult) {
        shownResult = shown;
        results.show(
          resultReport(result, {
            color: truckColor,
            shop: wallet ? shop.element : undefined,
            friend: (id) => {
              const publicId = social.friends.publicIdOfMember(id);
              return publicId
                ? social.friends.friendButton(publicId)
                : undefined;
            },
          }),
        );
      }
      results.update(resultBar(result, !!wallet));
      // No focus on show: Space is a play key here, and a held one would press the primary button.
    }
    // A phone that is only a controller has no room for the arena.
    const driving = model.screen === "race" && !!model.lobby.own && !display;
    pad.element.hidden = !driving || !touchDevice.matches;
    const guideParent =
      !canvas.hidden && !display && !touchDevice.matches ? arenaBox : race;
    if (roundControls.element.parentElement !== guideParent)
      guideParent.append(roundControls.element);
    roundControls.update({
      round: latest?.matchId ?? "",
      visible: model.screen === "race" && latest?.race?.phase === "countdown",
      controls: latest?.race?.battle
        ? battleGuide.controls
        : drivingGuide.controls,
      touchControls: latest?.race?.battle
        ? battleGuide.touchControls
        : drivingGuide.touchControls,
      touch: touchDevice.matches,
      spectator: !model.lobby.own,
      display,
    });
  };

  start.onclick = () => runtime.command({ type: "action", action: "start" });

  let latest: Parameters<FuseDriversCallbacks["state"]>[0] | undefined;
  /** When the newest view arrived, so a frame between two views draws part way between them. */
  let viewAt = 0;
  /** The race of the view before `latest`, as the arena poses from it: only the latency probe reads it. */
  let shownBefore: RaceState | undefined;
  const callbacks: FuseDriversCallbacks = {
    state(frame, settings) {
      viewer.host = runtime.managing;
      roomSettings = settings;
      // The input log can publish an older frame between two quick edits.
      // Keep the host's complete selection until that settings entry is applied.
      if (
        !viewer.host ||
        frame.phase !== "lobby" ||
        (requestedSettings &&
          requestedSettings.track === settings.track &&
          requestedSettings.races === settings.races &&
          requestedSettings.mode === settings.mode &&
          requestedSettings.display === settings.display)
      )
        requestedSettings = undefined;
      viewer.shared = settings.display;
      if (frame.race !== latest?.race) shownBefore = latest?.race;
      latest = frame;
      main.dataset.tick = String(frame.tick);
      main.dataset.race = frame.race?.phase ?? "";
      const slot = frame.drivers.find(
        (driver) => driver.id === viewer.me,
      )?.truck;
      main.dataset.turn = String(
        frame.race?.trucks.find((truck) => truck.slot === slot)?.turnDir ?? 0,
      );
      viewAt = performance.now();
      render(presentTable(frame, viewer));
    },
    event() {
      /* Never render from events: a rollback rewrites outcomes without emitting them again. */
    },
    status(text) {
      const shown = roomFailure(text);
      say(shown, shown === text ? "info" : "error");
    },
    ready(id, host) {
      viewer.me = id;
      viewer.host = host;
    },
    ended() {
      say("Room ended", "error");
    },
  };

  const shared =
    !solo && role === "host" && store.getItem(names.shared) === "1";
  const runtime = new FuseDriversRuntime(
    code,
    { ...DEFAULT_SETTINGS, display: shared },
    callbacks,
    session.kind === "room"
      ? {
          transport: (events) =>
            social.transport(
              code,
              session.token,
              events,
              (events) =>
                new PeerTransport(code, session.token, events, {
                  apiUrl: endpoints.apiUrl,
                  gameId: GAME,
                  maxFastBytes: MAX_PACKET_BYTES,
                }),
            ),
          displayOnly: display,
        }
      : {
          autoStartSolo: false,
          humanName: social.playerName(store.getItem(names.name)) ?? undefined,
        },
  );

  const board = keyboardControls(
    () => latest?.phase !== "running" || modalInput.blocked(),
    drive,
  );
  function drive() {
    if (display || !latest) return;
    const keys = board.read();
    runtime.drive(
      modalInput.blocked()
        ? NEUTRAL_INPUT
        : {
            left: keys.left || touch.left,
            right: keys.right || touch.right,
            gas: !!(keys.gas || touch.gas),
            brake: false,
            nitro: keys.nitro || touch.nitro,
            item: !!(latest.race?.battle && (keys.item || touch.item)),
            itemAlt: false,
          },
    );
  }
  if (probe) {
    Reflect.set(window, "__driversRaceProbe", () => {
      const state = runtime.roomState();
      const metrics = runtime.metrics();
      return {
        phase: state?.race?.phase,
        track: state?.race?.trackName,
        mode: state?.settings.mode,
        theme: stadiumTheme,
        held: state?.race?.battle?.slots.map((slot) => slot.held),
        bombs: state?.race?.battle?.bombs.length,
        tick: state?.tick,
        hashChecks: metrics.hashChecks,
        mismatches: metrics.mismatches,
        trucks: state?.race?.trucks.map((truck) => ({
          x: truck.motion.x,
          y: truck.motion.y,
          nitros: truck.nitros,
          tires: truck.upgrades?.tires,
        })),
      };
    });
  }
  const stopPlaytestInput = registerPlaytestInput(document, {
    cancel: () => {
      board.clear();
      Object.assign(touch, NEUTRAL_INPUT);
      runtime.drive(NEUTRAL_INPUT);
    },
  });
  const modalInput = createModalInputGate({
    isOpen: () =>
      playtestInputBlocked(document) ||
      !!document.querySelector("dialog[open]"),
    observe: (change) => {
      const observer = new MutationObserver(change);
      observer.observe(document.body, {
        attributes: true,
        subtree: true,
        attributeFilter: ["open"],
      });
      return () => observer.disconnect();
    },
    cancel: () => {
      board.clear();
      Object.assign(touch, NEUTRAL_INPUT);
      runtime.drive(NEUTRAL_INPUT);
    },
  });
  let arena: MountedArena | undefined;
  const raceAudio = createOffroadAudio(audio);
  let stopped = false;
  const reports = createReportDispatcher({
    now: () => performance.now(),
    send: (report) =>
      session.kind === "room" || social.isSignedIn()
        ? sendReport(
            endpoints.apiUrl(
              `/api/games/${GAME}/${session.kind === "room" ? `rooms/${code}` : "me"}/${report.path}`,
            ),
            report,
            {
              fetch: social.reportFetch,
              ...(session.kind === "room" ? { roomToken: session.token } : {}),
            },
          )
        : Promise.resolve(true),
  });

  // ---- drawing: the newest folded race played forward to the clock, once per animation frame ----
  const smoother = createSmoother(),
    leadClock = createLeadClock();
  const frame = () => {
    if (stopped) return;
    requestAnimationFrame(frame);
    if (!latest) return;
    const drawArena = !viewer.shared || display || solo;
    if (!arena && drawArena)
      arena = mountArena(canvas, {
        theme: () => stadiumTheme,
        onReady: () => {
          canvas.dataset.ready = "true";
        },
        assetBase: `${import.meta.env.BASE_URL}${GAME}/assets/`,
        onError: (error: unknown) => {
          // The race keeps running without a picture; say so rather than leaving a black rectangle.
          console.error("arena", error);
          say("The arena could not start", "error");
        },
      });
    drive();
    const room = runtime.roomState();
    const timing = runtime.frameTiming();
    if (room && drawArena && !document.hidden) {
      const own = room.grid.indexOf(runtime.self);
      raceAudio.observe(
        `${room.matchId}:${room.round}`,
        room.race,
        own >= 0 ? own : (room.race?.placements[0] ?? 0),
        timing?.revision ?? 0,
      );
    } else {
      raceAudio.stop();
    }
    if (drawArena) {
      const now = performance.now(),
        lead =
          drawAhead &&
          timing &&
          room?.stage === "running" &&
          room.race &&
          room.race === latest.race
            ? forward(
                room,
                leadClock(ticksAhead(timing), timing.newer.logTick, now),
                runtime.self,
                runtime.heldNow,
              )
            : undefined;
      if (lead && room) {
        const own = room.grid.indexOf(runtime.self);
        smoother.begin(
          `${room.matchId}:${room.round}`,
          timing?.revision ?? 0,
          room.tick,
          room.grid.map((id) => room.controls[id] ?? 0),
          now,
        );
        if (probe) {
          const pose = renderSnapshot(lead.previous, lead.race, lead.alpha)[
            own
          ];
          Reflect.set(window, "__leadProbe", {
            at: now,
            x: pose?.heading,
            y: 0,
          });
        }
        arena?.render(latest, lead.alpha, display ? undefined : runtime.self, {
          previous: lead.previous,
          current: lead.race,
          place: (slot, pose) =>
            slot === own ? pose : smoother.place(slot, pose),
        });
      } else {
        // Views arrive one log tick apart; alpha is how far into that gap this frame falls.
        const alpha = Math.min(1, Math.max(0, (now - viewAt) / TICK_MS));
        if (probe && latest.race) {
          const slot = room?.grid.indexOf(runtime.self) ?? -1,
            pose = renderSnapshot(shownBefore, latest.race, alpha)[slot];
          Reflect.set(window, "__leadProbe", {
            at: now,
            x: pose?.heading,
            y: 0,
          });
        }
        arena?.render(latest, alpha, display ? undefined : runtime.self);
      }
    }
    if (room) {
      const final = runtime.confirmedFrame();
      const mode = solo
        ? "solo"
        : display
          ? "display"
          : viewer.shared
            ? "controller"
            : "online";
      observePlay(playFrame(room, runtime.self, mode), {
        frame: final && confirmedPlayFrame(final, runtime.self, mode),
      });
      if (final && (session.kind === "room" || social.isSignedIn()))
        reports.tick(
          dueReports(final, runtime.self, final.tick, reports.completed),
        );
    }
  };
  requestAnimationFrame(frame);

  installRoomLifecycle(window, {
    stop: () => {
      stopped = true;
      raceAudio.stop();
      audio.setHidden(true);
      unbindAudio();
      audioControl.destroy();
      modalInput.dispose();
      stopPlaytestInput();
      board.stop();
      runtime.stop();
    },
    destroy: () => arena?.destroy(),
    reload: () => location.reload(),
  });
  runtime.start();
}

if (query.get("solo") === "1") room(true);
else if (query.has("room")) room(false);
else landing();
