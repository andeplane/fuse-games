import { requestedRoomSlot } from "fuse-ui";
import {
  playtestInputBlocked,
  registerPlaytestInput,
} from "fuse-ui/playtest-input";
import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "fuse-ui/social.css";
import "fuse-ui/results.css";
import "./birds.css";
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
  uuid,
  type Callbacks,
  type Frame,
} from "fuse-netcode";
import {
  button,
  createInviteCard,
  createNameEntry,
  createMainMenu,
  createLiveResults,
  createResultsScreen,
  createRoomLayout,
  createRoster,
  createSharedTvOption,
  el,
} from "fuse-ui";
import { createAppPortal } from "fuse-ui/portal";
import { createTopBar } from "fuse-ui";
import { createGameSocial } from "fuse-ui/social";
import { createResultsHistory } from "fuse-ui/results-history";
import { createModalInputGate } from "fuse-ui/modal-input";
import {
  createPlayMetrics,
  startGameAnalytics,
  observeConfirmedPlay,
} from "fuse-ui/play-metrics";
import {
  UNIT,
  type Fact,
  type Weapon,
  type WorldView,
  type Vector,
} from "../engine/view.js";
import { quantize } from "../engine/view-kit.js";
import {
  DEFAULT_SETTINGS,
  seatName,
  type BirdsSettings,
  type BirdsView,
} from "../online/game.js";
import { BirdsRuntime, type Play, type Session } from "../online/runtime.js";
import { createArena } from "../render/arena.js";
import {
  constrainCamera,
  followShot,
  turnCamera,
  zoomAt,
  type Camera,
} from "../render/camera.js";
import {
  cancelGesture,
  resetGesture,
  createGestures,
  pointerDown,
  pointerMove,
  pointerUp,
} from "./gestures.js";
import { roomFailure, roomToken, safeStore, storageKeys } from "./session.js";
import { BirdsAudio } from "./audio.js";
import { SoloBattle } from "./solo.js";
import { PracticeRuntime } from "./practice.js";
import { birdsPlayFrame } from "./play-metrics.js";
import { canPlayTurn } from "./turn-controls.js";
import { matchResult, resultBar, resultReport } from "./result-report.js";

const BIRDS_HELP =
  "Drag your bird backwards to aim, then release to fire. Drag elsewhere to pan. Pinch or scroll to zoom. Keyboard: I/K and J/L aim, Enter fires, Escape cancels. Be the last bird standing.";
const GAME = "fuse-birds",
  COLORS = ["#6df4ed", "#ff6ec7", "#bded76", "#ffb75e", "#b797ff"];
const analytics = startGameAnalytics(GAME);
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME.replaceAll("-", "")}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const app = document.querySelector<HTMLElement>("#app")!,
  store = safeStore(() => localStorage);
const social = createGameSocial({
  gameId: GAME,
  base: import.meta.env.BASE_URL,
  apiOrigin: import.meta.env.VITE_API_ORIGIN,
  document,
  window,
  fetch: (input, init) => fetch(input, init),
  track: analytics.track,
});
const playerName = () =>
  seatName(social.playerName(store.get(storageKeys.name)) ?? "");
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
const muted = new URLSearchParams(location.search).has("mute");
const audio = new BirdsAudio(!muted);
const masterSound = {
  enabled: () => audio.enabled,
  forcedMute: muted,
  setEnabled(on: boolean) {
    audio.enabled = on;
    audio.unlock();
  },
};
function brand(): HTMLElement {
  const title = el("a", "", "birds-brand");
  title.href = endpoints.appUrl();
  title.append(el("span", "FUSE"), el("span", "BIRDS"));
  return title;
}
function portal(): HTMLElement {
  return createAppPortal({
    document,
    current: GAME,
    base: import.meta.env.BASE_URL,
    search: location.search,
  }).element;
}
function notice(text: string): HTMLElement {
  const p = el("p", text, "birds-notice");
  p.setAttribute("role", "status");
  return p;
}
function landing(): void {
  const page = el("main", "", "birds-landing"),
    card = el("section", "", "birds-card");
  const title = el("h1", "SMALL BIRDS.\nBIG TROUBLE."),
    intro = el(
      "p",
      "Battle AI birds or play with 2–5 friends. Carve the cliffs, catch supply crates, and be the last bird standing.",
    );
  const create = button("CREATE ROOM", "fui-button-primary"),
    practice = button("Target Practice"),
    join = button("JOIN ROOM"),
    code = el("input");
  code.placeholder = "ROOM CODE";
  code.maxLength = 8;
  code.setAttribute("aria-label", "Room code");
  code.autocomplete = "off";
  const joinForm = el("form", "", "birds-join");
  join.type = "submit";
  joinForm.append(code, join);
  const message = notice(""),
    back = el("a", "All games", "birds-back");
  back.href = import.meta.env.BASE_URL;
  create.onclick = async () => {
    if (create.disabled) return;
    create.disabled = practice.disabled = join.disabled = code.disabled = true;
    message.textContent = "Creating your room…";
    try {
      const result = await createRoom(endpoints.apiUrl, fetch, GAME);
      store.set(storageKeys.host(result.code), result.token);
      history.pushState(
        null,
        "",
        endpoints.appUrl(`?room=${result.code}${muted ? "&mute" : ""}`),
      );
      room(result.code, false);
    } catch (error) {
      message.textContent = `${roomFailure(error)} Try again.`;
      create.disabled =
        practice.disabled =
        join.disabled =
        code.disabled =
          false;
    }
  };
  practice.onclick = () => {
    if (practice.disabled) return;
    history.pushState(
      null,
      "",
      endpoints.appUrl(`?practice=1${muted ? "&mute" : ""}`),
    );
    room("SOLO PRACTICE", false, true);
  };
  joinForm.onsubmit = (e) => {
    e.preventDefault();
    if (create.disabled) return;
    const value = code.value.trim().toUpperCase();
    if (!validRoomCode(value)) {
      message.textContent = "Enter a valid room code.";
      return;
    }
    history.pushState(
      null,
      "",
      endpoints.appUrl(`?room=${value}${muted ? "&mute" : ""}`),
    );
    room(value, false);
  };
  card.append(
    el("small", "ARTILLERY · FRIENDS · MAYHEM", "birds-eyebrow"),
    title,
    intro,
    create,
    practice,
    joinForm,
    message,
    back,
  );
  const header = el("header", "", "birds-top");
  header.append(portal(), brand(), social.element());
  createTopBar({ element: header, gameId: GAME, sound: masterSound });
  const mainMenu = createMainMenu({
    background: async (host, signal) =>
      (await import("./attract.js")).createAttract(host, signal),
    title: "FUSE BIRDS",
    description: intro.textContent ?? "",
    play: card,
    onSinglePlayer: () => {
      location.href = endpoints.appUrl(`?solo=1${muted ? "&mute" : ""}`);
    },
    extraPlayActions: [practice],
    joinContent: [joinForm, message],
    onPlay: async () => {
      await create.onclick?.call(create, new PointerEvent("click"));
      if (message.textContent?.includes("Try again"))
        throw new Error(message.textContent);
    },
    howToPlay: [el("p", BIRDS_HELP)],
  });
  page.append(header, mainMenu.element);
  app.replaceChildren(page);
}
function room(
  code: string,
  display: boolean,
  practice = false,
  solo = false,
): void {
  const historyToken =
    practice || solo ? undefined : roomToken(store, code, display, secret);
  const resultsHistory = createResultsHistory({
    fetch: social.reportFetch,
    apiUrl: endpoints.apiUrl,
    gameId: GAME,
    ...(historyToken ? { room: { code, token: historyToken } } : {}),
    signedIn: () => social.isSignedIn(),
    playerId: () => me,
    now: () => performance.now(),
  });
  const metricsScope = practice || solo ? crypto.randomUUID() : code;
  const observePlay = createPlayMetrics(analytics.track, () =>
    performance.now(),
  );
  const page = el("main", "", "birds-room"),
    header = el("header", "", "birds-top"),
    message = notice("Connecting…");
  // The room's state is one line: at the lobby's foot while the room waits, under the bar during a battle, where
  // it also says what a turn did. What went wrong is said apart from it, above the room.
  const status = notice("Connecting…"),
    problem = el("p", "", "birds-alert");
  status.classList.add("birds-status");
  problem.setAttribute("role", "alert");
  problem.hidden = true;
  // Removed from the room or the room gone: nothing that arrives afterwards may take that off the screen.
  let over = false;
  const say = (text: string) => {
    if (over) return;
    problem.hidden = true;
    message.textContent = status.textContent = text;
  };
  const fail = (text: string, last = false) => {
    if (over) return;
    over = last;
    message.textContent = status.textContent = "";
    problem.textContent = text;
    problem.hidden = false;
  };
  const retry = button("RETRY"),
    leave = button("LEAVE");
  retry.hidden = practice || solo;
  retry.onclick = () => location.reload();
  const resume = button("Resume");
  resume.dataset.fuiMenuDismiss = "";
  const group = (label: string, content: HTMLElement) => {
    const toggle = button(label);
    content.dataset.fuiMenuContent = "";
    content.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.onclick = () => {
      content.hidden = !content.hidden;
      toggle.setAttribute("aria-expanded", String(!content.hidden));
    };
    return [toggle, content];
  };
  const helpContent = el("section");
  helpContent.append(el("p", BIRDS_HELP));
  const helpGroup = group("How to play", helpContent);
  const socialGroup = group("Community", social.element());
  page.addEventListener("pointerdown", () => audio.unlock());
  // The room's code is on its invitation: the bar holds the brand, the battle's line and the menu.
  header.append(
    portal(),
    brand(),
    message,
    resume,
    ...helpGroup,
    retry,
    leave,
    ...socialGroup,
  );
  createTopBar({
    element: header,
    gameId: GAME,
    sound: masterSound,
    onOpenChange: (open) => {
      if (open) abandonInput();
      else if (
        !display &&
        !board.hidden &&
        !results.open &&
        !modalInput.blocked()
      )
        canvas.focus({ preventScroll: true });
    },
  });
  const lobby = el("section", "", "birds-lobby"),
    roster = createRoster({ emptyText: "No birds yet" }),
    start = button("START BATTLE", "fui-button-primary");
  roster.element.classList.add("birds-roster");
  const lobbyNote = el(
    "p",
    "Invite at least one friend to start.",
    "fui-lobby-note",
  );
  const invite = createInviteCard({
    code,
    link: endpoints.appUrl(`?room=${code}`),
    qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 300 }),
  });
  const nameEntry = createNameEntry({
    initial: playerName() ?? "",
    normalize: (raw) => seatName(raw) ?? "",
    buttonText: "JOIN BATTLE",
    onSubmit(name) {
      store.set(storageKeys.name, name);
      runtime.command({
        type: "join",
        slot: requestedRoomSlot(nameEntry.form),
        name,
        avatarId: "owl",
      });
    },
  });
  nameEntry.form.hidden = true;
  lobby.append(
    invite.element,
    nameEntry.form,
    roster.element,
    lobbyNote,
    start,
  );
  const board = el("section", "", "birds-board"),
    canvas = el("canvas"),
    scorebar = el("div", "", "birds-scorebar"),
    turn = el("div", "", "birds-turn");
  canvas.setAttribute(
    "aria-label",
    "Battlefield. Drag your bird backwards to aim, then release to fire. Drag elsewhere to pan. Pinch or scroll to zoom.",
  );
  canvas.tabIndex = 0;
  canvas.setAttribute(
    "aria-description",
    "Keyboard: I/K aim up/down, J/L aim left/right, Shift adjusts faster, Enter fires, Escape cancels. Plus/minus zoom.",
  );
  canvas.title = canvas.getAttribute("aria-description")!;
  const sky = el("div", "", "birds-canvas");
  sky.append(canvas);
  const overlay = el("section", "", "birds-overlay"),
    overlayTitle = el("h2"),
    overlayText = el("p"),
    rematch = button("NEW ROUND", "fui-button-primary"),
    toLobby = button("LOBBY");
  overlay.append(overlayTitle, overlayText, rematch, toLobby);
  // A finished battle: the shared results screen over the page, on the TV and the phones alike.
  const results = createResultsScreen({
    document,
    onBack: () => leave.click(),
    backText: "Leave",
    onAction: (id) =>
      runtime.command({
        type: "action",
        action: id === "rematch" ? "rematch" : "lobby",
      }),
  });
  const liveResults = createLiveResults(results);
  const cameraBar = el("div", "", "birds-camera"),
    zoomIn = button("+"),
    zoomOut = button("−"),
    recenter = button("MY BIRD"),
    full = button("FULL MAP"),
    zoomLabel = el("output", "100%", "birds-zoom");
  zoomLabel.setAttribute("aria-label", "Map zoom");
  zoomIn.setAttribute("aria-label", "Zoom in");
  zoomOut.setAttribute("aria-label", "Zoom out");
  cameraBar.append(recenter, zoomOut, zoomLabel, zoomIn, full);
  const footer = el("footer", "", "birds-controls"),
    weapons = el("div", "", "birds-weapons"),
    pebble = button("", "birds-weapon"),
    scatter = button("", "birds-weapon");
  const pebbleCount = el("b", "∞"),
    scatterCount = el("b", "×3");
  pebble.append(
    el("span", "●", "birds-pebble-icon"),
    el("span", "PEBBLE"),
    pebbleCount,
  );
  scatter.append(
    el("span", "✹", "birds-scatter-icon"),
    el("span", "SCATTER BOMB"),
    scatterCount,
  );
  weapons.append(pebble, scatter);
  const turnActions = el("div", "", "birds-turn-actions"),
    pass = button("PASS");
  turnActions.append(pass);
  const hint = el(
    "p",
    "Pull your bird backwards. Release to fire. Pinch to zoom.",
    "birds-hint",
  );
  const outcome = notice("");
  outcome.hidden = true;
  const shotFeedback = (text: string) => {
    outcome.textContent = text;
    outcome.hidden = !text;
  };
  footer.append(weapons, turnActions, hint, outcome);
  board.append(scorebar, turn, sky, overlay, cameraBar, footer);
  board.hidden = true;
  page.append(header, problem, lobby, board, results.element);
  app.replaceChildren(page);
  // Shared TV is the room's choice, made in the room: the host turns it on here and opens the screen beside it.
  // The choice is remembered for the next room this device creates.
  const sharedTv = createSharedTvOption({
    className: "birds-tv-option",
    onChange: (display) => {
      const sent = runtime.command({ type: "settings", settings: { display } });
      if (sent) store.set(storageKeys.shared, display ? "1" : "0");
      return sent;
    },
    onOpenScreen: () =>
      window.open(
        endpoints.appUrl(`?room=${code}&display=1${muted ? "&mute" : ""}`),
        "_blank",
        "noopener",
      ),
  });
  const howToPlay = el("p", BIRDS_HELP);
  /** This device's own seat in the lobby, as the last frame had it. */
  let ownSeat: { name: string; slot: number } | undefined;
  const addAI = button("Add AI");
  addAI.onclick = () =>
    runtime.command({
      type: "bot",
      action: "add",
      slot: requestedRoomSlot(addAI),
    });
  createRoomLayout({
    compact: solo,
    addAI: solo ? addAI : undefined,
    // Seated already: any open seat is a move, and the bird's colour follows it.
    ownSlot: () => ownSeat?.slot,
    onMove: (slot) => {
      if (ownSeat)
        runtime.command({
          type: "join",
          slot,
          name: ownSeat.name,
          avatarId: "owl",
        });
    },
    primaryAction: start,
    playerName: () => social.playerName(undefined) ?? undefined,
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    element: lobby,
    invite: invite.element,
    roster,
    // ADD FRIEND on a bird's row and INVITE FRIENDS under Copy link: the shared room's, in every game.
    friends: social.friends,
    capacity: 5,
    join: nameEntry.form,
    settings: [howToPlay],
    actions: [lobbyNote],
    // Back, Settings and START lead the room and stay there; the invitation and the birds scroll under them.
    actionsInHeader: true,
    extras: solo ? [] : [sharedTv.element],
    status,
    heading: solo ? "Your room" : "Room",
  });
  page.classList.toggle("birds-tv", display);
  const gestures = createGestures({ x: 768, y: 384, zoom: 1 });
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let following = true,
    previousPaint = 0;
  let preferredZoom = 1;
  let handoff: { from: Camera; to: Camera; start: number } | undefined;
  let lastWheel = -Infinity;
  let me = "",
    host = false,
    view: WorldView | null = null,
    weapon: Weapon = "pebble",
    turnKey = "",
    ready = false,
    battlefieldReady = false,
    stopped = false,
    frameId = 0;
  let keyboardAim: Vector | undefined;
  let currentFrame: Frame<BirdsView> | null = null;
  const arena = createArena(
    canvas,
    `${import.meta.env.BASE_URL}games/fuse-birds/art/v1`,
    reducedMotion,
  );
  arena.ready
    .then(() => {
      ready = true;
    })
    .catch((error) => {
      fail(roomFailure(error));
    });
  const viewport = () => ({
    width: Math.max(1, canvas.clientWidth),
    height: Math.max(1, canvas.clientHeight),
  });
  const cancel = () => {
    keyboardAim = undefined;
    cancelGesture(gestures);
  };
  const cancelAim = () => {
    keyboardAim = undefined;
    if (gestures.mode === "aim") cancelGesture(gestures);
  };
  const canPlay = () =>
    !modalInput.blocked() &&
    canPlayTurn(currentFrame, me, display, battlefieldReady, runtime);
  const abandonInput = () => {
    cancel();
    resetGesture(gestures);
  };
  const modalInput = createModalInputGate({
    isOpen: () =>
      playtestInputBlocked(document) ||
      Boolean(document.querySelector("dialog[open]")),
    observe(change) {
      const observer = new MutationObserver(change);
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["open"],
        subtree: true,
      });
      return () => observer.disconnect();
    },
    cancel: abandonInput,
  });
  const canAim = canPlay;
  const play = (action: Play) => {
    if (modalInput.blocked()) return;
    if (!runtime.play(action)) say("Wait for your turn before playing.");
  };
  const select = (next: Weapon) => {
    cancelAim();
    weapon = next;
    pebble.setAttribute("aria-pressed", String(next === "pebble"));
    scatter.setAttribute("aria-pressed", String(next === "scatter"));
  };
  pebble.onclick = () => select("pebble");
  scatter.onclick = () => select("scatter");
  select("pebble");
  const centerBird = () => {
    if (!view || display) return;
    const bird =
      view.players.find((p) => p.id === me && p.hp > 0) ??
      view.players[view.active]!;
    gestures.camera = constrainCamera(
      { x: bird.x / UNIT, y: bird.y / UNIT, zoom: 2.5 },
      view,
      viewport(),
    );
    cancel();
  };
  const zoom = (factor: number) => {
    if (!view || display) return;
    handoff = undefined;
    following = false;
    cancel();
    const vp = viewport();
    gestures.camera = zoomAt(
      gestures.camera,
      gestures.camera.zoom * factor,
      { x: vp.width / 2, y: vp.height / 2 },
      view,
      vp,
    );
    preferredZoom = gestures.camera.zoom;
  };
  zoomIn.onclick = () => zoom(1.4);
  zoomOut.onclick = () => zoom(1 / 1.4);
  recenter.onclick = () => {
    handoff = undefined;
    following = true;
    centerBird();
    preferredZoom = gestures.camera.zoom;
  };
  full.onclick = () => {
    handoff = undefined;
    preferredZoom = 1;
    following = false;
    cancel();
    gestures.camera = { x: 768, y: 384, zoom: 1 };
  };
  const point = (e: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - box.left, y: e.clientY - box.top };
  };
  canvas.onpointerdown = (e) => {
    if (!view || display) return;
    handoff = undefined;
    if (keyboardAim) cancel();
    audio.unlock();
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const bird = view.players[view.active]!;
    pointerDown(gestures, point(e), canAim(), view, viewport(), {
      x: bird.x / UNIT,
      y: bird.y / UNIT,
    });
    if (gestures.mode !== "aim") following = false;
  };
  canvas.onpointermove = (e) => {
    if (view && !display) pointerMove(gestures, point(e), view, viewport());
    if (gestures.mode === "pinch") preferredZoom = gestures.camera.zoom;
  };
  canvas.onpointerup = (e) => {
    const shot = pointerUp(gestures, e.pointerId);
    if (shot && canPlay()) {
      following = true;
      play({ type: "launch", weapon, ...shot });
    }
  };
  canvas.onpointercancel = (e) => {
    cancel();
    pointerUp(gestures, e.pointerId);
  };
  canvas.onlostpointercapture = (e) => {
    if (gestures.pointers.has(e.pointerId)) {
      cancel();
      pointerUp(gestures, e.pointerId);
    }
  };
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (display || !view) return;
      handoff = undefined;
      lastWheel = performance.now();
      following = false;
      e.preventDefault();
      cancel();
      const box = canvas.getBoundingClientRect();
      gestures.camera = zoomAt(
        gestures.camera,
        gestures.camera.zoom * Math.exp(-e.deltaY * 0.002),
        { x: e.clientX - box.left, y: e.clientY - box.top },
        view,
        viewport(),
      );
      preferredZoom = gestures.camera.zoom;
    },
    { passive: false },
  );
  if (practice) {
    pass.hidden = true;
    const newMap = button("NEW MAP");
    newMap.onclick = () => {
      cancel();
      runtime.command({ type: "action", action: "rematch" });
    };
    turnActions.append(newMap);
    retry.hidden = true;
  }
  pass.onclick = () => {
    cancel();
    play({ type: "pass" });
  };
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  toLobby.onclick = () => runtime.command({ type: "action", action: "lobby" });
  const cards = new Map<string, HTMLElement>();
  let shotOutcome: "miss" | "hit" | undefined;
  const callbacks: Callbacks<BirdsView, Fact, BirdsSettings> = {
    ready(id, isHost) {
      me = id;
      host = isHost;
    },
    status(text) {
      const shown = roomFailure(text);
      if (shown === text) say(shown);
      else fail(shown);
    },
    kicked() {
      fail(
        "You were removed from this room. Leave to create or join another.",
        true,
      );
      cancel();
    },
    ended() {
      fail(
        "Room connection ended. Retry to reconnect, or leave to start another room.",
        true,
      );
      cancel();
    },
    event(fact, matchId, round) {
      arena.emit(fact, `${matchId}:${round}`, performance.now());
      audio.play(fact, performance.now());
      if (fact.type === "rejected" && fact.actor === me)
        say(fact.reason ?? "That action was not accepted.");
      if (fact.type === "shot") {
        shotOutcome = "miss";
        shotFeedback("");
      }
      if (fact.type === "damage" || fact.type === "pickup") shotOutcome = "hit";
      if (fact.type === "turn") {
        if (shotOutcome === "miss") shotFeedback("Missed.");
        shotOutcome = undefined;
      }
      if (fact.type === "damage")
        shotFeedback(
          `${view?.players.find((p) => p.id === fact.actor)?.name ?? "Bird"} lost ${fact.amount} health.`,
        );
      if (fact.type === "pickup")
        shotFeedback(
          fact.amount
            ? "Supply collected: +1 Scatter Bomb."
            : "Supply collected. Scatter ammunition is already full.",
        );
    },
    state(frame, settings) {
      const previousWorld = currentFrame?.world;
      if (
        currentFrame?.matchId !== frame.matchId ||
        currentFrame?.world?.round !== frame.world?.round
      ) {
        shotFeedback("");
        shotOutcome = undefined;
        handoff = undefined;
        if (solo) {
          gestures.camera = { x: 768, y: 384, zoom: 1 };
          preferredZoom = 1;
          following = true;
        }
      }
      currentFrame = frame;
      host = frame.managerId === me;
      view = frame.world;
      page.dataset.phase = view?.phase ?? frame.stage;
      page.dataset.turn = String(view?.turn ?? 0);
      page.dataset.tick = String(frame.tick);
      page.dataset.match = view?.id ?? "";
      page.dataset.round = String(view?.round ?? 0);
      const seated = frame.seats.some((s) => s.id === me && !s.watcher),
        inLobby = frame.stage === "lobby";
      observeConfirmedPlay(
        observePlay,
        frame,
        () => (solo ? frame : runtime.confirmedFrame?.()),
        (frame) =>
          birdsPlayFrame(frame, settings, {
            memberId: me,
            displayOnly: display,
            practice,
            solo,
            roomScope: metricsScope,
          }),
      );
      const confirmed = runtime.confirmedFrame?.();
      if (!display && !practice && confirmed)
        resultsHistory.observe(confirmed.history, confirmed.logTick);
      ownSeat = frame.seats.find((s) => s.id === me && !s.watcher);
      resume.textContent = inLobby ? "Back to room" : "Resume";
      leave.textContent = inLobby
        ? "Leave room"
        : practice
          ? "Leave practice"
          : "Leave battle";
      lobby.hidden = !inLobby;
      board.hidden = inLobby;
      nameEntry.form.hidden = display || seated || !inLobby;
      page.dataset.screen = inLobby ? "lobby" : "battle";
      roster.update(
        frame.seats
          .filter((s) => !s.watcher)
          .map((s) => ({
            id: s.id,
            slot: s.slot,
            name:
              s.id === me && s.name.toLowerCase() !== "you"
                ? `${s.name} (you)`
                : s.name,
            status: s.bot ? "AI" : s.connected ? "READY" : "AWAY",
            color: COLORS[s.slot]!,
            host: s.id === frame.managerId,
          })),
      );
      if (solo && inLobby)
        for (const [id, row] of roster.entries()) {
          if (
            !frame.seats.some((s) => s.id === id && s.bot) ||
            row.querySelector(".birds-remove")
          )
            continue;
          const remove = button("×", "birds-remove");
          remove.setAttribute("aria-label", "Remove bot");
          remove.onclick = () =>
            runtime.command({ type: "bot", action: "remove", id });
          row.append(remove);
        }
      sharedTv.update(
        settings.display,
        host && !display && !practice && inLobby,
      );
      const present = frame.seats.filter(
        (s) => !s.watcher && s.connected,
      ).length;
      start.hidden = !host;
      start.disabled = present < 2;
      lobbyNote.textContent = host
        ? `${present}/5 birds ready. ${present < 2 ? (solo ? "Add an AI bird to start." : "Invite a friend to start.") : "Start when your flock is ready."}`
        : "Waiting for the host to start.";
      const result = view
        ? matchResult(view, {
            me,
            host,
            bots: new Set(frame.seats.filter((s) => s.bot).map((s) => s.id)),
          })
        : null;
      liveResults.render(result, {
        friends: social.friends,
        report: (result, friend) =>
          resultReport(result, {
            color: (slot) => COLORS[slot] ?? "#ffffff",
            friend,
          }),
        bar: resultBar,
      });
      if (!view) {
        cancel();
        return;
      }
      const player = view.players[view.active]!,
        key = `${view.id}:${view.round}:${view.turn}`;
      if (turnKey !== key) {
        handoff = undefined;
        cancelAim();
        if (
          solo &&
          player.id === me &&
          previousWorld?.id === view.id &&
          previousWorld.round === view.round &&
          previousWorld.turn !== view.turn &&
          !gestures.pointers.size &&
          performance.now() - lastWheel > 180
        ) {
          const to = {
            x: player.x / UNIT,
            y: player.y / UNIT,
            zoom: preferredZoom,
          };
          if (reducedMotion)
            gestures.camera = constrainCamera(to, view, viewport());
          else
            handoff = { from: gestures.camera, to, start: performance.now() };
        }
        if (player.ammo === 0) select("pebble");
        if (
          !solo &&
          !display &&
          viewport().width < 800 &&
          (!turnKey || player.id === me)
        ) {
          centerBird();
          following = true;
        }
        turnKey = key;
      }
      if (!canPlay() || (weapon === "scatter" && player.ammo === 0))
        cancelAim();
      scorebar.replaceChildren(
        ...view.players.map((p) => {
          let card = cards.get(p.id);
          if (!card) {
            card = el("article", "", "birds-player");
            cards.set(p.id, card);
          }
          card.style.setProperty("--bird", COLORS[p.slot]!);
          card.dataset.playerId = p.id;
          card.dataset.appliedOrdinal = String(p.ordinal);
          card.dataset.ammo = String(p.ammo);
          card.classList.toggle("current", p.id === player.id);
          card.classList.toggle("eliminated", p.hp === 0);
          card.replaceChildren(
            el(
              "span",
              `${p.name}${p.id === me && !practice && p.name.toLowerCase() !== "you" ? " · YOU" : ""}`,
            ),
            el("b", p.hp > 0 ? String(p.hp) : "OUT"),
          );
          return card;
        }),
      );
      turn.textContent = practice
        ? `SOLO PRACTICE · WIND ${view.wind}`
        : `${player.id === me ? "YOUR TURN" : `${player.name}'S TURN`}  ·  ${view.phase === "aiming" ? `${Math.ceil(view.timeLeft)}s` : view.phase.toUpperCase()}  ·  WIND ${view.wind < 0 ? "←" : view.wind > 0 ? "→" : "—"} ${Math.abs(view.wind)}`;
      pebbleCount.textContent = "∞";
      scatterCount.textContent = `×${player.ammo}`;
      pebble.setAttribute("aria-label", "Pebble, unlimited ammunition");
      scatter.setAttribute(
        "aria-label",
        `Scatter Bomb, ${player.ammo} shots remaining`,
      );
      pebble.disabled = !canPlay();
      scatter.disabled = !canPlay() || player.ammo === 0;
      pass.disabled = !canPlay();
      turnActions.hidden = display;
      cameraBar.hidden = display;
      hint.textContent = display
        ? "Scan the room QR on your phone to play."
        : !battlefieldReady
          ? "Preparing the battlefield…"
          : view.phase === "aiming" &&
              view.players[view.active]?.id === me &&
              !runtime.admitted
            ? "Waiting for your seat to reconnect…"
            : canPlay()
              ? "Pull your bird backwards to aim. Release to fire. Drag elsewhere to pan."
              : `Watch ${player.name}. You can still explore the map.`;
      // The battle's result is the results screen's; this card is for a map being made and a round that broke.
      overlay.hidden = !["preparing", "fault"].includes(view.phase);
      overlayTitle.textContent =
        view.phase === "preparing"
          ? "SHAPING THE ISLANDS"
          : "ROUND INTERRUPTED";
      overlayText.textContent =
        view.phase === "preparing"
          ? practice
            ? "Preparing your practice map…"
            : "Checking that every bird has an opening shot…"
          : (view.fault ?? "");
      rematch.hidden = toLobby.hidden = !host || view.phase === "preparing";
    },
  };
  const runtime: Session = practice
    ? new PracticeRuntime(callbacks, {
        name: playerName() ?? "YOU",
        seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
        active: () => !document.hidden,
      })
    : solo
      ? new SoloBattle(callbacks, {
          name: playerName() ?? "You",
          seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
          active: () => !document.hidden && !modalInput.blocked(),
          schedule: (tick) => {
            const timer = setInterval(tick, 50);
            return () => clearInterval(timer);
          },
        })
      : new BirdsRuntime(
          code,
          {
            ...DEFAULT_SETTINGS,
            display:
              !!store.get(storageKeys.host(code)) &&
              store.get(storageKeys.shared) === "1",
          },
          callbacks,
          {
            displayOnly: display,
            transport: (events) => {
              const token = historyToken!;
              return social.transport(
                code,
                token,
                events,
                (events) =>
                  new PeerTransport(code, token, events, {
                    apiUrl: endpoints.apiUrl,
                    gameId: GAME,
                    maxFastBytes: MAX_PACKET_BYTES,
                  }),
              );
            },
          },
        );
  const stop = () => {
    resultsHistory.dispose();
    stopped = true;
    cancel();
    modalInput.dispose();
    stopPlaytestInput();
    cancelAnimationFrame(frameId);
    runtime.stop();
    arena.destroy();
    audio.destroy();
  };
  leave.onclick = () => {
    resultsHistory.close(
      () => ({
        receipts: currentFrame?.history ?? [],
        confirmedTick: runtime.confirmedFrame?.()?.logTick ?? -1,
      }),
      () => {
        stop();
        location.href = endpoints.appUrl();
      },
    );
  };
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: stop,
    reload: () => location.reload(),
  });
  const stopPlaytestInput = registerPlaytestInput(document, {
    cancel: abandonInput,
  });
  window.addEventListener("blur", abandonInput);
  window.addEventListener("resize", cancel);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) abandonInput();
  });
  window.addEventListener("keydown", (e) => {
    if (modalInput.blocked()) return;
    if (e.key === "Escape") {
      cancel();
      return;
    }
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLButtonElement
    )
      return;
    const key = e.key.toLowerCase();
    if (!display && (key === "+" || key === "=" || key === "-")) {
      e.preventDefault();
      zoom(key === "-" ? 1 / 1.4 : 1.4);
    } else if (canAim() && ["i", "j", "k", "l"].includes(key)) {
      handoff = undefined;
      e.preventDefault();
      audio.unlock();
      const bird = view!.players[view!.active]!;
      const current = keyboardAim ?? {
        vx: bird.x / UNIT < view!.width / 2 ? 1536 : -1536,
        vy: -1600,
      };
      const step = e.shiftKey ? 128 : 16;
      const next = quantize(
        current.vx + (key === "l" ? step : key === "j" ? -step : 0),
        current.vy + (key === "k" ? step : key === "i" ? -step : 0),
      );
      cancelGesture(gestures);
      if (Math.abs(next.vx) + Math.abs(next.vy) >= 128) keyboardAim = next;
    } else if (canAim() && key === "enter" && keyboardAim && !e.repeat) {
      e.preventDefault();
      const vector = keyboardAim;
      cancel();
      following = true;
      play({ type: "launch", weapon, ...vector });
    }
  });
  function paint(now: number): void {
    if (stopped) return;
    if (handoff && view?.phase === "aiming") {
      const next = turnCamera(handoff.from, handoff.to, now - handoff.start);
      gestures.camera = constrainCamera(next, view, viewport());
      if (next === handoff.to) handoff = undefined;
    } else if (
      view &&
      following &&
      !display &&
      !reducedMotion &&
      !keyboardAim &&
      gestures.mode === "idle"
    )
      gestures.camera = followShot(
        gestures.camera,
        view.projectiles.map((p) => ({ x: p.x / UNIT, y: p.y / UNIT })),
        view,
        viewport(),
        now - previousPaint,
      );
    previousPaint = now;
    if (ready && view && !board.hidden && view.phase !== "preparing")
      battlefieldReady = arena.paint(
        {
          world: view,
          camera: gestures.camera,
          shared: display,
          aim: keyboardAim ?? gestures.aim,
        },
        now,
      );
    else battlefieldReady = false;
    canvas.dataset.ready = String(battlefieldReady);
    canvas.dataset.gesture = keyboardAim ? "keyboard-aim" : gestures.mode;
    const zoomText = `${Math.round(gestures.camera.zoom * 100)}%`;
    if (zoomLabel.textContent !== zoomText) zoomLabel.textContent = zoomText;
    frameId = requestAnimationFrame(paint);
  }
  frameId = requestAnimationFrame(paint);
  runtime.start();
}
const query = new URLSearchParams(location.search),
  code = query.get("room")?.trim().toUpperCase();
window.addEventListener("popstate", () => location.reload());
if (query.get("practice") === "1") room("SOLO PRACTICE", false, true);
else if (query.get("solo") === "1") room("SOLO", false, false, true);
else if (code && validRoomCode(code)) room(code, query.get("display") === "1");
else landing();
