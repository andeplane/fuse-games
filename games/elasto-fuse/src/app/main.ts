import { GamepadInput, browserGamepads } from "fuse-ui/gamepad";
import {
  createHowToPlay,
  createPlayScreen,
  requestedRoomSlot,
  stageBox,
} from "fuse-ui";
import {
  playtestInputBlocked,
  registerPlaytestInput,
} from "fuse-ui/playtest-input";
import { createGameSocial } from "fuse-ui/social";
import { signedInToken } from "fuse-ui/browser-account";
import "fuse-ui/social.css";
import {
  observeConfirmedPlay,
  startGameAnalytics,
  createPlayMetrics,
} from "fuse-ui/play-metrics";
import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import {
  bindAudioInput,
  browserAudioDependencies,
  createAudioControl,
  createGameAudio,
} from "fuse-ui/game-audio";
import "fuse-ui/game-audio.css";
import { safeStorage } from "fuse-ui/safe-storage";
import "fuse-ui/results.css";
import "./elasto-fuse.css";
import QRCode from "qrcode";
import { createTopBar } from "fuse-ui";
import {
  PeerTransport,
  createEndpoints,
  createRoom,
  installRoomLifecycle,
  validRoomCode,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES, uuid } from "fuse-netcode";
import {
  backOnEscape,
  button,
  createAppPortal,
  createGameMenu,
  createInviteCard,
  createLandingCard,
  createNameEntry,
  createNotice,
  showInvalidRoomPage,
  createLiveResults,
  createResultsScreen,
  createRoomLayout,
  createRoster,
  createRoundControls,
  createSharedTvOption,
  createSubPage,
  el,
} from "fuse-ui";
import { GAS, RESTART } from "../engine/input.js";
import { CAPACITY } from "../engine/tuning.js";
import { LEVELS, centiseconds } from "../engine/index.js";
import type { WorldView } from "../engine/view.js";
import { GAME_ID } from "../basics.js";
import { DEFAULT_SETTINGS, type Settings, type View } from "../online/game.js";
import { seatName } from "../online/names.js";
import {
  ElastoFuseRuntime,
  type ElastoFuseCallbacks,
} from "../online/runtime.js";
import { cueGate, cuesBetween, type Cue } from "../render/cues.js";
import { slotColor, slotName } from "../render/palette.js";
import { createScene } from "../render/scene.js";
import { createSmoother } from "../render/smooth.js";
import { browserCanvas, browserImages, browserTint, loadArt } from "./art.js";
import { createSfx, ELASTO_SONGS } from "./audio.js";
import {
  HeldControls,
  PadSet,
  TOUCH_BUTTONS,
  bindButton,
  type PadSurface,
} from "./controls.js";
import { createGhosts, project } from "./forward.js";
import { gamepadBits } from "./gamepad.js";
import {
  LEVEL_CHOICES,
  createFinishWatch,
  levelFrom,
  present,
  type Model,
  type Row,
  type Viewer,
} from "./presenter.js";
import { createReceiptReporter } from "fuse-ui/receipt-reporting";
import { dueReports } from "./reports.js";
import { resultBar, resultReport } from "./result-report.js";
import {
  NOT_OPEN,
  bestTime,
  createBestTimes,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "./session.js";
import { clockText } from "../render/hud.js";
import {
  createLevelLeaderboards,
  parseLevelTimes,
} from "./level-leaderboards.js";
import type { LevelRun } from "../level-times.js";

/**
 * The Elasto Fuse page's glue: it reads the query, builds the screens from fuse-ui components, wires the runtime to
 * the transport, draws every animation frame and turns keys, touches and gamepads into held control bits. The
 * decisions live in the presenter, the renderer and the engine; nothing here changes the race.
 */
const GAME = GAME_ID;
const analytics = startGameAnalytics(GAME);
const reportPlay = createPlayMetrics(analytics.track, () => performance.now());
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME.replaceAll("-", "")}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const social = createGameSocial({
  gameId: GAME,
  base: import.meta.env.BASE_URL,
  apiOrigin: import.meta.env.VITE_API_ORIGIN,
  document,
  window,
  fetch: (input, init) => fetch(input, init),
  track: analytics.track,
});
const store = safeStore(() => localStorage);
const names = keys(GAME);
/** The level a room's lobby last chose (the tour is −1). */
const roomLevelKey = `${GAME}-room-level`;
const query = new URLSearchParams(location.search);
const muted = query.has("mute");
const app = document.querySelector<HTMLElement>("#app")!;
/** One sound bus for the page: the header's button, `M` and the remembered volumes are the shared module's. */
const audio = createGameAudio(
  browserAudioDependencies(safeStorage(() => localStorage)),
  { forceMute: muted },
);
// Music is supplied by the shared header; this bus owns the game effects.
bindAudioInput(audio, document, window);
const audioControl = createAudioControl(document, audio, { music: false });
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
/** A link within the game that keeps this page's developer flags. */
const withFlags = (path: string) =>
  ["mute", "probe"]
    .filter((flag) => query.has(flag))
    .reduce(
      (link, flag) => `${link}${link.includes("?") ? "&" : "?"}${flag}`,
      path,
    );
const levelTimesUrl = (level: number) =>
  endpoints.apiUrl(`/api/games/${GAME}/level-times?level=${level}`);
const setText = (node: HTMLElement, value: string) => {
  if (node.textContent !== value) node.textContent = value;
};
const coarse = () => matchMedia("(pointer: coarse)").matches;
/** The level solo rides: the link's, else the one ridden last, else the first. */
const soloLevel = (): number =>
  levelFrom(query.get("level") ?? store.getItem(names.level), 0);
/** The level a new room starts on: the last lobby's choice, else the tour. */
const roomLevel = (): number => {
  const stored = store.getItem(roomLevelKey);
  return levelFrom(stored, 0);
};

const GUIDE = {
  controls: [
    { keys: "↑ / W", action: "Gas" },
    { keys: "↓ / S", action: "Brake" },
    { keys: "← → / A D", action: "Volt: rotate the bike left or right" },
    { keys: "SPACE", action: "Turn around" },
    { keys: "ENTER / R", action: "Restart from the start" },
    {
      keys: "GAMEPAD",
      action: "A gas, B brake, LB RB volt, X turn, Y restart",
    },
  ],
  touchControls: [
    {
      keys: "GAS / BRAKE",
      action: "Right thumb: hold to drive, brake to stop",
    },
    { keys: "⟲ ⟳", action: "Left thumb: rotate the bike in the air" },
    { keys: "TURN", action: "Face the other way" },
  ],
  goal: "Eat every apple, then touch the flower. Keep your head off the ground: the bike is springy and flips easily.",
} as const;

const QUICK_GUIDE = {
  controls: [
    { keys: "↑ ↓", action: "Gas, brake" },
    { keys: "← →", action: "Rotate" },
    { keys: "SPACE", action: "Turn around" },
    { keys: "ENTER", action: "Restart" },
  ],
  touchControls: [
    { keys: "GAS / BRAKE", action: "Drive" },
    { keys: "⟲ ⟳", action: "Rotate" },
    { keys: "TURN", action: "Turn around" },
  ],
  goal: "Every apple, then the flower. Mind your head.",
} as const;

function logo(): HTMLElement {
  const brand = el("a", "", "ef-brand");
  brand.href = withFlags(endpoints.appUrl());
  brand.append(
    el("b", "ELASTO", "ef-brand-elasto"),
    el("b", "FUSE", "ef-brand-fuse"),
    el("small", "SPRINGY BIKE TRIALS"),
  );
  return brand;
}
function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "ef-top");
  const portal = createAppPortal({
    document,
    current: GAME,
    base: import.meta.env.BASE_URL,
    search: location.search,
  });
  bar.append(
    portal.element,
    logo(),
    social.element(),
    audioControl.element,
    ...extra,
  );
  return createTopBar({
    music: ELASTO_SONGS,
    element: bar,
    gameId: GAME,
    sound: audioControl.sound,
  });
}

function keyHelp(): HTMLElement {
  return createHowToPlay(GUIDE);
}

/** A compact native picker with keyboard type-ahead, shared by solo and rooms. */
function createLevelPicker(room: boolean, onPick: (level: number) => void) {
  const element = el("label", "", "ef-level-picker");
  const select = el("select");
  element.append(el("span", "Starting level"), select);
  for (const choice of LEVEL_CHOICES) {
    const node = el("option");
    node.value = String(choice.level);
    const best = bestTime(store, names.best(LEVELS[choice.level]!.id));
    node.append(`${choice.level + 1} ${choice.title}`);
    if (best !== undefined && !room) node.append(` · ${clockText(best)}`);
    select.append(node);
  }
  select.onchange = () => onPick(Number(select.value));
  return {
    element,
    update(selected: number, editable: boolean) {
      select.value = String(selected);
      select.disabled = !editable;
    },
  };
}

function landing(): void {
  let level = soloLevel();
  const card = createLandingCard({
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    title: "ELASTO FUSE",
    howToPlay: GUIDE,
    tagline:
      "A springy motorbike, the original 54-level campaign and hundreds of extra tracks. Eat every apple, then touch the flower, and keep your head off the ground. Chase your best times alone, or race up to four friends.",
    soloText: "PLAY SOLO",
    async onCreate() {
      const room = await createRoom(endpoints.apiUrl, fetch, GAME).catch(
        (error: unknown) => {
          throw new Error(
            roomFailure(error instanceof Error ? error.message : String(error)),
          );
        },
      );
      store.setItem(names.host(room.code), room.token);
      location.href = withFlags(endpoints.appUrl(`?room=${room.code}`));
    },
    onSolo: () => {
      store.setItem(names.level, String(level));
      location.href = withFlags(endpoints.appUrl(`?solo=1&level=${level}`));
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = withFlags(endpoints.appUrl(`?room=${code}`));
    },
  });
  card.menu.addEntry("Leaderboards", () => {
    location.href = withFlags(endpoints.appUrl("?leaderboards"));
  });
  const picker = createLevelPicker(false, (picked) => {
    level = picked;
    store.setItem(names.level, String(picked));
    picker.update(picked, true);
  });
  picker.update(level, true);
  const rules = el("section", "", "ef-landing-rules");
  rules.append(picker.element);
  card.solo?.before(rules);
  const back = el("a", "All games", "ef-back");
  back.href = import.meta.env.BASE_URL + (muted ? "?mute" : "");
  const menu = createGameMenu(GUIDE);
  menu.update({ canLobby: false, canLeave: false, touch: coarse() });
  app.replaceChildren(header([back, menu.element]), card.element);
}

function leaderboards(): void {
  const board = createLevelLeaderboards({
    initial: soloLevel(),
    levels: LEVEL_CHOICES,
    playHref: (level) => withFlags(endpoints.appUrl(`?solo=1&level=${level}`)),
    async load(level, signal) {
      const response = await fetch(levelTimesUrl(level), { signal });
      if (!response.ok) throw new Error("Leaderboard unavailable");
      return parseLevelTimes(await response.json());
    },
  });
  const page = createSubPage({
    title: "Leaderboards",
    backHref: withFlags(endpoints.appUrl()),
    content: [board.element],
  });
  const menu = createGameMenu(GUIDE);
  menu.update({ canLobby: false, canLeave: false, touch: coarse() });
  app.replaceChildren(header([menu.element]), page.element);
  backOnEscape(page.back);
  window.addEventListener("pagehide", board.dispose, { once: true });
}

/** A real element as a touch button. */
function surface(node: HTMLElement): PadSurface {
  node.addEventListener("contextmenu", (event) => event.preventDefault());
  return {
    on(kind, listener) {
      const types =
        kind === "down"
          ? ["pointerdown"]
          : ["pointerup", "pointercancel", "lostpointercapture"];
      for (const type of types)
        node.addEventListener(type, (event) => {
          if (kind === "down" && playtestInputBlocked(document)) return;
          listener(event as PointerEvent);
        });
    },
    capture: (pointerId) => node.setPointerCapture(pointerId),
    show: (held) => node.classList.toggle("held", held),
  };
}

function room(solo: boolean): void {
  const session = solo
    ? ({ kind: "solo" } as const)
    : sessionFor(location.search, store, GAME, validRoomCode, secret);
  if (session.kind === "invalid" || session.kind === "landing") {
    showInvalidRoomPage(app, header(), withFlags(endpoints.appUrl()));
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO",
    role = session.kind === "room" ? session.role : "host",
    display = role === "display";
  document.body.classList.toggle("ef-display", display);
  const viewer: Viewer = { me: "", host: solo, solo, display };
  const sfx = createSfx(audio);
  const leave = () => {
    runtime.stop();
    location.href = withFlags(endpoints.appUrl());
  };

  // ---- the page ----
  // How the room is doing sits at the lobby's foot, and beside the menu while a race is on the screen (a link that
  // is retrying is said there, as it always was); what went wrong is said above the room.
  const status = createNotice({ className: "ef-status" }),
    live = createNotice({ className: "ef-live" }),
    problem = createNotice({ className: "ef-alert" });
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
  const controls = new HeldControls((bits) => runtime.input(bits));
  /** Lets go of every key, button and pad: a menu opened, or the page lost focus. */
  let letGoAll = () => controls.clear();
  const menu = createGameMenu({
    ...GUIDE,
    onLobby: () => runtime.command({ type: "action", action: "lobby" }),
    onLeave: leave,
    onOpenChange: (open) => {
      if (open) letGoAll();
      else if (model?.riding) main.focus({ preventScroll: true });
    },
  });
  const roundControls = createRoundControls(QUICK_GUIDE);
  // The room's code is on its invitation, and in the lobby its state is at the lobby's foot: the bar holds the
  // state only while a race is on.
  const top = header([live.element, menu.element]);
  createTopBar({
    music: ELASTO_SONGS,
    element: top,
    onOpenChange: (open) => {
      if (open) {
        letGoAll();
        gamepads.letGo();
        captured.clear();
      } else if (model?.riding) main.focus({ preventScroll: true });
    },
  });
  const modalOpen = () =>
    playtestInputBlocked(document) ||
    Boolean(document.querySelector("dialog[open]"));

  // Lobby: the invitation and the riders on one side, the level and START on the other.
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const lobby = el("section", "", "ef-lobby"),
    lobbyMain = el("div", "", "ef-panel"),
    roster = createRoster({ emptyText: "No riders yet" }),
    start = button("START RACE", "fui-button-primary ef-start"),
    lobbyNote = el("p", "", "fui-lobby-note");
  // Shared TV is the room's choice, made in the room: the host turns it on here and opens the screen beside it.
  // The choice is remembered for the next room this device creates.
  const sharedTv = createSharedTvOption({
    className: "ef-tv-option",
    onChange: (display) => {
      const sent = runtime.command({
        type: "settings",
        settings: { ...settings, display },
      });
      if (sent) store.setItem(names.shared, display ? "1" : "0");
      return sent;
    },
    onOpenScreen: () =>
      window.open(
        withFlags(endpoints.appUrl(`?room=${code}&display=1`)),
        "_blank",
      ),
  });
  let inviteCard: HTMLElement | undefined;
  if (!solo) {
    const invite = createInviteCard({
      code,
      link: endpoints.appUrl(`?room=${code}`),
      qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
    });
    inviteCard = invite.element;
    lobbyMain.append(invite.element);
  }
  const nameEntry = createNameEntry({
    normalize: (raw) => seatName(raw) ?? "",
    initial: social.playerName(store.getItem(names.name)) ?? "",
    onInput: (value) => store.setItem(names.name, value),
    buttonText: "JOIN",
    onSubmit: (name) => {
      store.setItem(names.name, name);
      runtime.command({
        type: "join",
        name,
        slot: requestedRoomSlot(nameEntry.form),
      });
    },
  });
  lobbyMain.append(el("h2", "RIDERS", "fui-lobby-title"), roster.element);
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  const levelPicker = createLevelPicker(true, (level) => {
    store.setItem(roomLevelKey, String(level));
    runtime.command({ type: "settings", settings: { ...settings, level } });
  });
  const countPicker = el("select");
  const orderPicker = el("select");
  const seriesOptions = el("div", "", "ef-series-options");
  for (const count of [3, 5, 10] as const) {
    const option = el("option", String(count));
    option.value = String(count);
    countPicker.append(option);
  }
  for (const [value, title] of [
    ["consecutive", "In order"],
    ["random", "Random"],
  ]) {
    const option = el("option", title);
    option.value = value!;
    orderPicker.append(option);
  }
  for (const [title, picker] of [
    ["Levels per match", countPicker],
    ["Race order", orderPicker],
  ] as const) {
    const label = el("label", "", "ef-level-picker");
    label.append(el("span", title), picker);
    seriesOptions.append(label);
  }
  countPicker.onchange = () =>
    runtime.command({
      type: "settings",
      settings: {
        ...settings,
        count: Number(countPicker.value) as Settings["count"],
      },
    });
  orderPicker.onchange = () =>
    runtime.command({
      type: "settings",
      settings: { ...settings, order: orderPicker.value as Settings["order"] },
    });
  const mapTitle = el("h2", "MAP", "fui-lobby-title");
  lobby.append(lobbyMain);

  // The race: the canvas, the table over it between two races, and the touch buttons.
  const stage = el("section", "", "ef-stage"),
    screen = el("div", "", "ef-screen"),
    canvas = el("canvas", "", "ef-canvas"),
    note = el("p", "", "ef-note");
  const card = el("section", "", "ef-card"),
    cardTitle = el("h2"),
    cardRows = el("ol", "", "ef-rows"),
    cardFoot = el("p", "", "ef-card-foot");
  card.append(cardTitle, cardRows, cardFoot);
  card.hidden = true;
  const rematch = () => runtime.command({ type: "action", action: "rematch" }),
    toLobby = () => runtime.command({ type: "action", action: "lobby" });
  const nextMap = () => {
    const next = model?.result?.solo?.next;
    if (next === undefined) return;
    // The next level, then a rematch: both fold on the same tick, in this order.
    runtime.command({
      type: "settings",
      settings: { ...settings, level: next },
    });
    runtime.command({ type: "action", action: "rematch" });
    store.setItem(names.level, String(next));
    history.replaceState(
      null,
      "",
      withFlags(endpoints.appUrl(`?solo=1&level=${next}`)),
    );
  };
  /** The result's main button: NEXT MAP after a solo map ridden home, otherwise another go. */
  const mainAction = () =>
    model?.result?.solo?.finished ? nextMap() : rematch();
  // The result: the shared results screen over the page. A phone controller keeps its own two buttons.
  const results = createResultsScreen({
    document,
    // The screen covers the page's own bar: whoever is not the host still has a way out of the room.
    onBack: leave,
    backText: "Leave",
    onAction(id) {
      if (id === "retry-time") {
        if (rankedRun?.failed) void publishTime(rankedRun);
      } else if (id === "menu") leave();
      else if (id === "next") nextMap();
      else if (id === "lobby") toLobby();
      else rematch();
    },
  });
  const liveResults = createLiveResults(results);
  let rankedRun:
    | { match: string; run: LevelRun; status: string; failed: boolean }
    | undefined;
  const publishTime = async (attempt: NonNullable<typeof rankedRun>) => {
    attempt.status = "Verifying time…";
    attempt.failed = false;
    try {
      const token = await signedInToken();
      if (!token) throw new Error("Sign in to submit time");
      const response = await fetch(levelTimesUrl(attempt.run.level), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(attempt.run),
      });
      if (!response.ok) throw new Error("Could not save time");
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("ranked" in result))
        throw new Error("Missing leaderboard result");
      attempt.status =
        result.ranked === true
          ? "Leaderboard time saved"
          : "Verified outside the top 100";
    } catch {
      attempt.status = "Could not save leaderboard time";
      attempt.failed = true;
    }
  };
  screen.append(canvas, card, roundControls.element);

  // The touch buttons, twice: under a phone's own race, and filling the phone for a shared screen.
  const pads = (className: string) => {
    const row = el("div", "", className),
      left = el("div", "", "ef-cluster ef-cluster-left"),
      right = el("div", "", "ef-cluster ef-cluster-right");
    const set = new PadSet(controls);
    for (const each of TOUCH_BUTTONS) {
      const node = el("div", each.label, `ef-pad ef-pad-${each.id}`);
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", each.hint);
      set.add(
        bindButton(surface(node), each.bits, (bits) =>
          controls.hold(`${className}:${each.id}`, bits),
        ),
      );
      if (each.id === "gas" || each.id === "brake") right.append(node);
      else left.append(node);
    }
    row.append(left, right);
    return { row, set };
  };
  const touch = pads("ef-touch"),
    controllerPads = pads("ef-controller-pads");
  letGoAll = () => {
    touch.set.release();
    controllerPads.set.release();
    controls.clear();
  };
  stage.append(screen, note, touch.row);
  // A phone's live race is the whole screen, drawn turned when the phone is upright.
  const playScreen = createPlayScreen({
    stage,
    wide: true,
    onChange: () => letGoAll(),
  });

  const controller = el("section", "", "ef-controller"),
    controllerHead = el("header", "", "ef-controller-head"),
    controllerName = el("b"),
    controllerState = el("span");
  controllerHead.append(controllerName, controllerState);
  const controllerResult = el("div", "", "ef-actions ef-controller-result"),
    controllerRematch = button("REMATCH", "fui-button-primary"),
    controllerLobby = button("LOBBY");
  controllerRematch.onclick = rematch;
  controllerLobby.onclick = toLobby;
  controllerResult.append(controllerLobby, controllerRematch);
  controller.append(controllerHead, controllerResult, controllerPads.row);

  const connecting = el("p", "Connecting to the room…", "ef-connecting"),
    closed = el("section", "", "ef-panel ef-closed"),
    closedRetry = button("TRY AGAIN", "ef-retry"),
    closedBack = el(
      "a",
      "BACK TO ELASTO FUSE",
      "fui-button-primary ef-closed-back",
    );
  closedBack.href = withFlags(endpoints.appUrl());
  closedRetry.onclick = () => location.reload();
  const closedActions = el("div", "", "ef-actions");
  closedActions.append(closedRetry, closedBack);
  closed.append(
    el("h2", "ROOM CLOSED", "fui-lobby-title"),
    el(
      "p",
      "This room has ended, or it never existed. Try again, start a new one, or play solo.",
    ),
    closedActions,
  );
  closed.hidden = true;
  const main = el("main", "", "ef-room");
  // Resuming a ride returns keyboard input here, outside the header's own keyboard controls.
  main.tabIndex = -1;
  main.setAttribute("aria-label", "Elasto Fuse play area");
  main.append(
    problem.element,
    connecting,
    closed,
    nameEntry.form,
    lobby,
    stage,
    controller,
    results.element,
  );
  app.replaceChildren(top, main);
  /** This device's own seat in the lobby, as the last frame had it. */
  let ownSeat: { name: string; slot: number } | undefined;
  const roomLayout = createRoomLayout({
    primaryAction: start,
    playerName: () => social.playerName(undefined) ?? undefined,
    slotColor,
    slotLabel: (slot) => `${slotName(slot)} · Slot ${slot + 1}`,
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    element: lobby,
    ...(inviteCard ? { invite: inviteCard } : {}),
    roster,
    // ADD FRIEND on a rider's row and INVITE FRIENDS under Copy link: the shared room's, in every game.
    friends: social.friends,
    capacity: CAPACITY,
    join: nameEntry.form,
    // Seated already: any open seat is a move, and what the seat is (a team, a colour) follows it.
    ownSlot: () => ownSeat?.slot,
    onMove: (slot) => {
      if (ownSeat) runtime.command({ type: "join", name: ownSeat.name, slot });
    },
    settings: [keyHelp()],
    layout: "configuration",
    modes: [mapTitle, seriesOptions, levelPicker.element],
    actions: [lobbyNote],
    // Back, Settings and START lead the room and stay there; the invitation and the riders scroll under them.
    actionsInHeader: true,
    extras: [sharedTv.element],
    status: status.element,
    ...(solo ? { compact: true, heading: "Solo ride" } : { heading: "Room" }),
  });
  lobby.hidden = true;
  stage.hidden = true;
  controller.hidden = true;
  nameEntry.form.hidden = true;
  let over = false;

  // ---- drawing: the newest folded world played forward to the clock, once per animation frame ----
  const scene = createScene(canvas, {
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    art: loadArt(import.meta.env.BASE_URL, browserImages, browserTint),
    createCanvas: browserCanvas,
  });
  const smoother = createSmoother();
  let padBits = 0;
  const gamepads = new GamepadInput(
    browserGamepads(navigator),
    gamepadBits,
    (bits) => {
      // On a result, a pad's gas pressed afresh is the main button, as Enter is on the keys, and its restart a retry.
      const fresh = bits & ~padBits & (GAS | RESTART);
      padBits = bits;
      if (fresh && !model?.riding && model?.result?.host)
        if (fresh & RESTART) rematch();
        else mainAction();
      controls.hold("gamepad", bits);
    },
  );
  let model: Model | undefined;
  const ghosts = createGhosts();
  /** `?probe`: the last frames drawn, for a smoke test to read how evenly each bike moved. Off otherwise. */
  const probe = query.has("probe")
    ? (now: number, own: number | undefined, view: WorldView) => {
        const frames = ((
          window as { __elastoFrames?: unknown[] }
        ).__elastoFrames ??= []);
        frames.push({
          now,
          own,
          phase: view.phase,
          riders: view.riders.map((rider) => ({
            x: rider.bike.x,
            y: rider.bike.y,
            step: rider.step,
            status: rider.status,
          })),
        });
        if (frames.length > 2000) frames.shift();
      }
    : undefined;
  /**
   * What to draw now: every bike played on from the room's newest world to its own clock. This device's bike runs
   * on this device's clock alone; the others are ghosts, eased.
   */
  const picture = (): WorldView | undefined => {
    const state = runtime.roomState();
    const world = state?.world;
    if (!state || !world || state.stage === "lobby") return undefined;
    const now = performance.now();
    const plans = ghosts(state, viewer.me, now);
    const ride = runtime.localRide();
    if (ride) plans[ride.slot] = { to: ride.step, bits: ride.bits };
    let view = project(world, plans);
    if (ride && view.phase !== "over") {
      // The start and the clock are this device's too: its bike goes on its own count.
      const step = Math.max(0, Math.floor(ride.step));
      view =
        ride.step < 0
          ? { ...view, phase: "countdown", go: Math.ceil(-ride.step), step: 0 }
          : {
              ...view,
              phase: "racing",
              go: 0,
              step,
              left: Math.max(0, world.close - step),
            };
    }
    const shown = smoother.apply(
      view,
      runtime.frameTiming()?.revision ?? 0,
      now,
      model?.localSlot ?? -1,
    );
    probe?.(now, ride?.step, shown);
    return shown;
  };
  /** What of the canvas the touch buttons float over (a phone on its side), in CSS pixels; nothing when they sit below it. */
  let covered: { left: number; right: number; bottom: number } | undefined;
  const measureCovered = () => {
    covered = undefined;
    const [left, right] = [...touch.row.children];
    if (touch.row.hidden || stage.hidden || !left || !right) return;
    // In the stage's own frame: an upright phone draws the race turned.
    const pads = stageBox(touch.row),
      picture = stageBox(screen);
    const bottom =
      Math.min(picture.bottom, pads.bottom) - Math.max(picture.top, pads.top);
    if (bottom <= 0) return;
    covered = {
      left: Math.max(0, stageBox(left).right - picture.left),
      right: Math.max(0, picture.right - stageBox(right).left),
      bottom,
    };
  };
  /** A phone controller draws nothing, but still hears and feels its own bike: the cues read off its own views. */
  let felt: WorldView | undefined;
  const heard = cueGate();
  const frame = (now: number) => {
    // Asked first, so one bad frame cannot stop the drawing for good.
    if (!over) requestAnimationFrame(frame);
    gamepads.poll(!menu.isOpen() && !modalOpen() && !document.hidden && !over);
    const view = stage.hidden && controller.hidden ? undefined : picture();
    if (!view || !model) {
      sfx.engine(0, false, false);
      return;
    }
    const local = model.localSlot;
    let cues: readonly Cue[];
    if (stage.hidden) {
      cues = heard(cuesBetween(felt, view), now);
      felt = view;
      sfx.engine(0, false, false);
    } else {
      const drawn = scene.draw(view, now, {
        follow: model.follow,
        local,
        names: model.tags,
        title: model.title,
        ...(covered ? { covered } : {}),
      });
      cues = drawn.cues;
      sfx.engine(
        drawn.rev,
        drawn.gas,
        local !== -1 &&
          view.phase === "racing" &&
          !menu.isOpen() &&
          !modalOpen(),
      );
    }
    for (const cue of cues) {
      // A rider hears its own apples and crashes; a shared screen and a watcher hear everyone's.
      const mine = !("slot" in cue) || local === -1 || cue.slot === local;
      if (!mine) continue;
      sfx.play(cue);
      if (cue.kind === "crash" && local !== -1) navigator.vibrate?.(40);
      if (cue.kind === "apple" && local !== -1) navigator.vibrate?.(10);
    }
  };
  requestAnimationFrame(frame);

  const rowNode = (row: Row) => {
    const node = el("li", "", row.you ? "you" : "");
    node.style.setProperty("--c", slotColor(row.slot));
    node.append(
      el("span", String(row.place)),
      el("b", row.you ? `${row.name} (you)` : row.name),
      el("span", row.detail),
      el("em", row.points),
    );
    return node;
  };
  const render = (next: Model, view: View) => {
    if (over) return;
    model = next;
    ownSeat = next.lobby.members.find((member) => member.you);
    connecting.hidden = true;
    main.dataset.screen = next.screen;
    main.dataset.stage = view.stage;
    main.dataset.phase = view.world?.phase ?? "";
    main.dataset.level = view.world ? String(view.world.level) : "";
    main.dataset.round = String(view.round);
    main.dataset.riding = String(next.riding);
    lobby.hidden = next.screen !== "lobby";
    stage.hidden = next.screen !== "play";
    controller.hidden = next.screen !== "controller";
    nameEntry.form.hidden = !next.askName;
    // Lobby.
    roster.update(
      next.lobby.members.map((member) => ({
        id: member.id,
        slot: member.slot,
        // Alone there is nobody to tell apart from: the seat reads "You", not "You (you)".
        name: member.you && !solo ? `${member.name} (you)` : member.name,
        color: slotColor(member.slot),
        status: member.connected ? slotName(member.slot) : "OFFLINE",
      })),
    );
    start.hidden = !next.lobby.showStart;
    start.disabled = !next.lobby.canStart;
    setText(lobbyNote, next.lobby.note);
    lobbyNote.hidden = !next.lobby.note;
    sharedTv.update(view.settings.display, viewer.host && !display && !solo);
    levelPicker.update(
      view.settings.level,
      next.lobby.editable && view.settings.order === "consecutive",
    );
    levelPicker.element.hidden = view.settings.order === "random";
    countPicker.value = String(view.settings.count);
    orderPicker.value = view.settings.order;
    countPicker.disabled = orderPicker.disabled = !next.lobby.editable;
    roomLayout.update(next.lobby.members.length, CAPACITY);
    const touchGuide = coarse() || next.screen === "controller";
    const watching = display || (view.stage !== "lobby" && !next.riding);
    menu.update({
      canLobby: viewer.host && view.stage !== "lobby" && !display && !solo,
      touch: touchGuide,
      spectator: watching && view.stage === "running",
      display,
    });
    roundControls.update({
      round: next.guideKey,
      visible: next.controlsVisible,
      touch: touchGuide,
      spectator: watching,
      display,
    });
    const guideParent = next.screen === "controller" ? controller : screen;
    if (roundControls.element.parentElement !== guideParent)
      guideParent.append(roundControls.element);
    // The race.
    setText(note, next.note);
    note.hidden = !next.note;
    // Only while the race runs: the results and the lobby are tapped, not steered (the pads covered the results).
    const racing = view.stage === "running" && !next.result;
    playScreen.update(next.screen === "play" && racing);
    const touchOn = coarse() && next.riding && !display && racing;
    touch.row.hidden = !touchOn;
    main.dataset.touch = String(touchOn);
    touch.set.show(touchOn && !stage.hidden);
    controllerPads.set.show(!controller.hidden);
    scene.resize();
    measureCovered();
    // The phone controller.
    if (next.localSlot !== -1) {
      controller.style.setProperty("--c", slotColor(next.localSlot));
      setText(
        controllerName,
        `${slotName(next.localSlot)} · ${next.tags[next.localSlot] ?? ""}`,
      );
    }
    setText(controllerState, next.status);
    controllerResult.hidden = !(next.result && next.result.host);
    // The card: the table between two races.
    const table = next.screen === "controller" ? null : next.table;
    card.hidden = !table;
    if (table) {
      setText(cardTitle, table.title);
      const rows = JSON.stringify(table.rows);
      if (cardRows.dataset.rows !== rows) {
        cardRows.dataset.rows = rows;
        cardRows.replaceChildren(...table.rows.map(rowNode));
      }
      setText(cardFoot, table.next);
    }
    // The result.
    const result = next.screen === "controller" ? null : next.result;
    liveResults.render(result, {
      friends: social.friends,
      report: (result, friend) =>
        resultReport(result, { color: slotColor, friend }),
      bar: (result) => {
        const bar = resultBar(result);
        if (!result.solo || !rankedRun) return bar;
        return {
          ...bar,
          status: rankedRun.status,
          actions: rankedRun.failed
            ? [{ id: "retry-time", label: "Retry saving time" }, ...bar.actions]
            : bar.actions,
        };
      },
    });
  };

  // ---- the runtime ----
  const reportReceipts = createReceiptReporter({
    due: dueReports,
    gameId: GAME,
    display,
    scope:
      session.kind === "room"
        ? { kind: "room", code, token: session.token }
        : { kind: "solo", signedIn: () => social.isSignedIn() },
    apiUrl: endpoints.apiUrl,
    fetch: social.reportFetch,
    playerId: () => runtime.self,
    confirmedTick: () => runtime.confirmedTick(),
  });
  const finishes = createFinishWatch();
  const bests = createBestTimes(store);
  const remembered = seatName(
    social.playerName(store.getItem(names.name)) ?? "",
  );
  let joinSent = false;
  const callbacks: ElastoFuseCallbacks = {
    state(frame, roomSettings) {
      const mode = solo ? "solo" : roomSettings.display ? "shared" : "online";
      observeConfirmedPlay(
        reportPlay,
        frame,
        () => runtime.confirmedFrame(),
        (frame) => {
          const players =
            frame.stage === "lobby"
              ? frame.seats.filter((seat) => !seat.watcher)
              : frame.roster;
          return {
            matchId: frame.matchId,
            roundActive: frame.world?.phase === "racing",
            roundEnded: frame.world?.phase === "over",
            active: frame.stage === "running" || frame.stage === "between",
            ended: frame.stage === "over",
            playerCount: players.length,
            botCount: 0,
            seated: players.some((player) => player.id === viewer.me),
            mode,
            // A device that opens a tour midway joined a match; it did not start one.
            round: frame.round + 1,
          };
        },
      );
      for (const finish of finishes(frame, viewer.me))
        analytics.track("Race Finished", { ...finish, mode });
      settings = roomSettings;
      // A solo ride that is over settles its best time once, and keeps saying what the best was before it.
      let bestBefore: number | undefined;
      const world = frame.world;
      if (solo && frame.stage === "over" && world) {
        const rider = world.riders[0];
        bestBefore = bests.settle(
          frame.matchId,
          names.best(LEVELS[world.level]?.id ?? ""),
          rider?.status === "finished" ? centiseconds(rider.run) : undefined,
        );
      }
      if (rankedRun?.match !== frame.matchId) rankedRun = undefined;
      if (!rankedRun && solo && social.isSignedIn()) {
        const run = runtime.soloRun();
        if (run) {
          rankedRun = { match: frame.matchId, run, status: "", failed: false };
          void publishTime(rankedRun);
        }
      }
      const next = present(frame, viewer, bestBefore);
      // The host is seated like anyone else who has a name: opening a room is taking its first seat.
      if (next.askName && remembered && !joinSent) {
        joinSent = true;
        runtime.command({
          type: "join",
          slot: requestedRoomSlot(nameEntry.form),
          name: remembered,
        });
      }
      if (next.seated) joinSent = false;
      render(next, frame);
      const state = runtime.roomState();
      runtime.flush();
      reportReceipts(state);
    },
    event() {
      // Everything shown comes from the view: a rollback can change an outcome after its event.
    },
    status(text) {
      const shown = roomFailure(text);
      say(shown, shown === text ? "info" : "error");
    },
    ready(id, host) {
      viewer.me = id;
      viewer.host = host;
    },
    kicked() {
      say("The host removed you from the room", "error");
    },
    ended() {
      say("Room ended", "error");
      over = true;
      playScreen.destroy();
      // The frames stop here, so nothing else would let the engine go.
      sfx.engine(0, false, false);
      controls.clear();
      for (const part of [connecting, nameEntry.form, lobby, stage, controller])
        part.hidden = true;
      closed.hidden = false;
      void fetch(endpoints.apiUrl(`/api/games/${GAME}/leaderboard`))
        .then(async (response) => {
          const body = (await response.json()) as { error?: unknown };
          if (roomFailure(String(body.error ?? "")) === NOT_OPEN)
            say(NOT_OPEN, "error");
        })
        .catch(() => {
          /* offline: "Room ended" stands */
        });
    },
  };
  const shared =
    !solo && role === "host" && store.getItem(names.shared) === "1";
  const runtime = new ElastoFuseRuntime(
    code,
    {
      ...DEFAULT_SETTINGS,
      display: shared,
      level: solo ? soloLevel() : roomLevel(),
      count: solo ? 1 : 3,
    },
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
          humanName: social.playerName(store.getItem(names.name)) ?? undefined,
        },
  );
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => {
      stopPlaytestInput();
      menu.dispose();
      scene.destroy();
    },
    reload: () => location.reload(),
  });
  window.addEventListener("resize", () => {
    scene.resize();
    measureCovered();
  });

  // Keys: while this device rides, ours are swallowed so Space never scrolls or presses a focused button.
  const field = (target: EventTarget | null) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement;
  const captured = new Set<string>();
  document.addEventListener("keydown", (event) => {
    if (
      menu.isOpen() ||
      modalOpen() ||
      field(event.target) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    const onButton = event.target instanceof HTMLButtonElement;
    // A result that offers another go takes Enter as its main button and R as a retry, without the mouse.
    // The results screen focuses its main button, so R must work from a button; Enter there is the button's own.
    if (
      !model?.riding &&
      model?.result?.host &&
      !event.repeat &&
      (event.code === "KeyR" || (event.code === "Enter" && !onButton))
    ) {
      event.preventDefault();
      if (event.code === "KeyR") rematch();
      else mainAction();
      return;
    }
    // Only a race swallows keys: in the lobby Space and the arrows scroll and press as usual.
    if (!model?.riding) return;
    // A repeat presses nothing new, but a held game key must stay swallowed
    // or the page scrolls and a focused button fires under the player.
    if (event.repeat) {
      if (captured.has(event.code)) event.preventDefault();
      return;
    }
    if (controls.press(event.code)) {
      captured.add(event.code);
      event.preventDefault();
    }
  });
  document.addEventListener("keyup", (event) => {
    controls.release(event.code);
    if (captured.delete(event.code)) event.preventDefault();
  });
  const stopPlaytestInput = registerPlaytestInput(document, {
    cancel: () => {
      letGoAll();
      gamepads.letGo();
    },
  });
  window.addEventListener("blur", () => {
    letGoAll();
    gamepads.letGo();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      letGoAll();
      gamepads.letGo();
    }
  });
  // A pinch or a double tap must never zoom the race away from under the thumbs.
  for (const type of ["gesturestart", "gesturechange", "dblclick"])
    stage.addEventListener(type, (event) => event.preventDefault());
  runtime.start();
}

if (query.has("leaderboards")) leaderboards();
else if (query.get("solo") === "1") room(true);
else if (query.has("room")) room(false);
else landing();
