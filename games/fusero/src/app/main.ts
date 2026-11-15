import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "fuse-ui/social.css";
import "./style.css";
import QRCode from "qrcode";
import {
  button,
  createAppPortal,
  createGameMenu,
  createDialog,
  createInviteCard,
  createLandingCard,
  createNameEntry,
  createNotice,
  createRoomLayout,
  createRoster,
  createTopBar,
  el,
  requestedRoomSlot,
} from "fuse-ui";
import { createGameSocial } from "fuse-ui/social";
import {
  playtestInputBlocked,
  isEditableReportTarget,
} from "fuse-ui/playtest-input";
import {
  createPlayMetrics,
  observeConfirmedPlay,
  startGameAnalytics,
} from "fuse-ui/play-metrics";
import {
  createEndpoints,
  createRoom,
  PeerTransport,
  installRoomLifecycle,
  validRoomCode,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES, uuid } from "fuse-netcode";
import {
  DEFAULT_SETTINGS,
  createWorld,
  stepWorld,
  botInput,
  OUTER_MS,
  LEFT,
  RIGHT,
  UP,
  DOWN,
  JUMP,
  FIRE,
  ROPE,
  NEXT,
  PREV,
  CARVE,
  SLOT1,
  SLOT2,
  SLOT3,
  SLOT4,
  SLOT5,
} from "../engine/index.js";
import { CLASSIC_WEAPONS } from "../engine/classic/catalog.js";
import {
  allowedWeaponIds,
  defaultLoadout,
  score as classicScore,
} from "../engine/classic/match.js";
import { fuseroGame, type View } from "../online/game.js";
import { seatName } from "../online/names.js";
import { FuseroRuntime, type FuseroCallbacks } from "../online/runtime.js";
import { keys, safeStore, sessionFor, roomFailure } from "./session.js";
import {
  createArena,
  interpolateArena,
  COLORS,
  NATIVE_DRAW_SCALE,
} from "./arena.js";
import { HeldControls, keyboardBindings } from "./controls.js";
import { CLASSIC_LEVELS } from "../engine/classic/level.js";
import { createFuseroAudio, createWebAudioSurface } from "./audio.js";

const GAME = fuseroGame.id;
const analytics = startGameAnalytics(GAME);
const metrics = createPlayMetrics(analytics.track, () => performance.now());
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME}/`,
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
const store = safeStore(() => localStorage),
  names = keys(GAME);
const app = document.querySelector<HTMLElement>("#app")!;
const muted = new URLSearchParams(location.search).has("mute");
const audio = createFuseroAudio({
  base: import.meta.env.BASE_URL,
  forcedMute: muted,
  initiallyEnabled: store.getItem(`${GAME}-sound-enabled`) !== "0",
  now: () => performance.now(),
  fetch: (url, signal) => fetch(url, { signal }),
  open: () =>
    createWebAudioSurface(() =>
      typeof AudioContext === "undefined"
        ? undefined
        : new AudioContext({ latencyHint: "interactive" }),
    ),
});
audio.onChange(() => {
  if (!muted)
    store.setItem(`${GAME}-sound-enabled`, audio.enabled() ? "1" : "0");
});
audio.setVisible(!document.hidden);
for (const type of ["pointerdown", "keydown"])
  document.addEventListener(
    type,
    () => {
      void audio.unlock();
    },
    { passive: true },
  );
document.addEventListener("visibilitychange", () =>
  audio.setVisible(!document.hidden),
);
window.addEventListener("pagehide", () => audio.dispose(), { once: true });
const url = (query = "") =>
  endpoints.appUrl(query + (muted ? `${query ? "&" : "?"}mute` : ""));
// The original web build uses PC defaults; native Mac defaults remain selectable locally.
let keyboardPlatform: "pc" | "mac" =
  store.getItem(`${GAME}-keyboard`) === "mac" ? "mac" : "pc";
let KEY_BITS = keyboardBindings(keyboardPlatform);
const controlLabels = () => ({
  fireKey: keyboardPlatform === "mac" ? "Left Option" : "Left Ctrl",
  jumpKey: keyboardPlatform === "mac" ? "Left Command" : "Left Alt",
  selectKey: keyboardPlatform === "mac" ? "Space" : "Left Shift",
  strafeKey: keyboardPlatform === "mac" ? "C" : "Z",
});
const controlHints = () => {
  const { fireKey, jumpKey, selectKey, strafeKey } = controlLabels();
  return [
    { keys: "← →", action: "Move" },
    { keys: "↑ ↓", action: "Aim" },
    { keys: jumpKey, action: "Jump; detach ninja rope" },
    { keys: fireKey, action: "Fire" },
    { keys: "X", action: "Launch or relaunch ninja rope; jump releases it" },
    { keys: "A / S / 1–5", action: "Previous, next or select weapon slot" },
    { keys: "Hold ← and tap → (or the reverse)", action: "Dig while walking" },
    { keys: `${selectKey} + ← / →`, action: "Change weapon without walking" },
    {
      keys: `${strafeKey} + ← / →`,
      action: "Strafe while keeping your facing direction",
    },
  ];
};
const keyboardHint = () => {
  const { fireKey, jumpKey } = controlLabels();
  return `← → move · ↑ ↓ aim · ${jumpKey} jump / release rope · ${fireKey} fire · X rope · A S / 1–5 weapons · opposite arrow digs`;
};
const arenaDisplay = (wideScreen: boolean) => ({
  wideScreen,
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  touchControls: () =>
    matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0,
});
const TOUCH = [
  { keys: "LEFT / RIGHT", action: "Move" },
  { keys: "AIM ↑ / ↓", action: "Aim" },
  { keys: "JUMP / FIRE", action: "Jump and fire" },
  { keys: "ROPE", action: "Launch or relaunch; JUMP releases the rope" },
  { keys: "WEAPON SLOTS", action: "Select one of your five weapons" },
  { keys: "CARVE", action: "Dig into nearby dirt" },
];
const GOAL =
  "Classic deathmatch: choose five weapons, dig, shoot and swing through the cave. The default match ends at 15 kills or six minutes, with automatic respawn after 2.5 seconds. Weapon charge and reload advance only for the selected slot.";

function header(
  extra: HTMLElement[] = [],
  onOpenChange?: (open: boolean) => void,
) {
  const bar = el("header", "", "liero-top"),
    brand = el("a", "FUSERO", "liero-brand");
  brand.href = url();
  bar.append(
    createAppPortal({
      document,
      current: GAME,
      base: import.meta.env.BASE_URL,
      search: location.search,
    }).element,
    brand,
    social.element(),
    ...extra,
  );
  return createTopBar({
    element: bar,
    gameId: GAME,
    onOpenChange,
    sound: audio,
  });
}

/** Menu-only simulation, separate from actual play and disposed when hidden. */
function attract(host: HTMLElement) {
  const canvas = el("canvas", "", "liero-attract");
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);
  const arena = createArena(canvas, arenaDisplay(true));
  const world = createWorld(
    713,
    [
      { id: "demo-a", slot: 0 },
      { id: "demo-b", slot: 1 },
      { id: "demo-c", slot: 2 },
    ],
    DEFAULT_SETTINGS,
  );
  const labels = new Map([
    ["demo-a", "FUSE"],
    ["demo-b", "ROPE"],
    ["demo-c", "BOOM"],
  ]);
  let carry = 0;
  return {
    advance() {
      carry += 50;
      while (carry >= OUTER_MS) {
        stepWorld(
          world,
          new Map(world.worms.map((worm) => [worm.id, botInput(world, worm)])),
        );
        carry -= OUTER_MS;
      }
    },
    render() {
      arena.draw(world, labels, "");
    },
    tick: () => world.step,
    dispose() {
      canvas.remove();
    },
  };
}

function landing() {
  const card = createLandingCard({
    title: "FUSERO",
    tagline:
      "Dig in. Rope out. Blow the cave apart. Real-time worm warfare for up to five friends.",
    background: attract,
    soloText: "PLAY SOLO VS BOTS",
    onSolo: () => {
      location.href = url("?solo=1");
    },
    async onCreate() {
      const room = await createRoom(endpoints.apiUrl, fetch, GAME);
      store.setItem(names.host(room.code), room.token);
      location.href = url(`?room=${room.code}`);
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = url(`?room=${code}`);
    },
  });
  const shared = el("label", "", "liero-shared"),
    toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = store.getItem(names.shared) === "1";
  toggle.onchange = () =>
    store.setItem(names.shared, toggle.checked ? "1" : "0");
  shared.append(toggle, el("span", "Shared TV + phone controllers"));
  card.create.after(shared);
  app.replaceChildren(header(), card.element);
}

function room(solo: boolean) {
  const session = solo
    ? ({ kind: "solo" } as const)
    : sessionFor(
        location.search,
        store,
        GAME,
        validRoomCode,
        () => uuid().replaceAll("-", "") + uuid().replaceAll("-", ""),
      );
  if (session.kind === "invalid" || session.kind === "landing") {
    const back = el("a", "Back to Fusero");
    back.href = url();
    app.replaceChildren(
      header(),
      el("p", "Invalid room code. Return to the menu and try again."),
      back,
    );
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO";
  const display = session.kind === "room" && session.role === "display";
  let me = "",
    host = solo,
    last: View | undefined,
    joined = false;
  const status = createNotice({ className: "liero-status" });
  const controls = new HeldControls(
    (bits) => runtime.input(bits),
    () => performance.now(),
  );
  const menu = createGameMenu({
    controls: controlHints(),
    touchControls: TOUCH,
    goal: GOAL,
    onLobby: () => runtime.command({ type: "action", action: "lobby" }),
    onLeave: () => {
      runtime.stop();
      location.href = url();
    },
    onOpenChange: (open) => {
      if (open) controls.release();
    },
  });
  const changeWeapons = button("CHANGE WEAPONS", "fui-game-menu-action");
  changeWeapons.dataset.fuiMenuDismiss = "";
  changeWeapons.hidden = true;
  changeWeapons.onclick = () => {
    controls.release();
    menu.close();
    if (
      last?.world?.worms.find((worm) => worm.id === me)?.weaponsReady ===
        false ||
      runtime.beginLoadout()
    )
      openLiveLoadout();
  };
  menu.element
    .querySelector(".fui-game-menu-navigation")!
    .append(changeWeapons);
  const keyboardChoice = el("select");
  keyboardChoice.setAttribute("aria-label", "Keyboard preset");
  for (const [value, label] of [
    ["pc", "Original PC / web"],
    ["mac", "Original Mac"],
  ]) {
    const option = el("option", label);
    option.value = value!;
    keyboardChoice.append(option);
  }
  keyboardChoice.value = keyboardPlatform;
  keyboardChoice.onchange = () => {
    controls.release();
    keyboardHeld.clear();
    keyboardPlatform = keyboardChoice.value === "mac" ? "mac" : "pc";
    KEY_BITS = keyboardBindings(keyboardPlatform);
    store.setItem(`${GAME}-keyboard`, keyboardPlatform);
    hints.textContent = keyboardHint();
  };
  const keyboardLabel = el("label", "Keyboard", "liero-keyboard-preset");
  keyboardLabel.append(keyboardChoice);
  menu.element
    .querySelector(".fui-game-menu-navigation")!
    .append(keyboardLabel);
  const top = header([menu.element], (open) => {
    if (open) controls.release();
    else if (last?.stage === "running") canvas.focus({ preventScroll: true });
  });
  const main = el("main", "", "liero-room"),
    lobby = el("section", "", "liero-lobby");
  main.dataset.display = String(display);
  const roster = createRoster({ emptyText: "Take a seat or invite friends" });
  const start = button("START MATCH", "fui-button-primary"),
    addBot = button("+ ADD BOT"),
    note = el("p", "", "fui-lobby-note");
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  addBot.onclick = () =>
    runtime.command({
      type: "bot",
      action: "add",
      slot: requestedRoomSlot(addBot),
    });
  const nameEntry = createNameEntry({
    normalize: (value) => seatName(value) ?? "",
    initial: social.playerName(store.getItem(names.name)) ?? "",
    onInput: (name) => store.setItem(names.name, name),
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
  const loadoutPanel = el("section", "", "liero-loadout");
  loadoutPanel.append(
    el("h3", "YOUR FIVE WEAPONS"),
    el("p", "Choose a slot's weapon. Switching away pauses its reload."),
  );
  const loadoutFields = el("div", "", "liero-loadout-fields");
  const loadoutHome = el("div", "", "liero-loadout-home");
  loadoutHome.append(loadoutPanel);
  const liveLoadout = createDialog({ title: "CHOOSE WEAPONS", document });
  const liveDone = button("DONE", "fui-button-primary");
  const liveNote = el(
    "p",
    "The cave keeps running while you choose. Confirm all five slots to resume.",
    "liero-loadout-note",
  );
  liveLoadout.actions.append(liveDone);
  const openLiveLoadout = () => {
    const worm = last?.world?.worms.find((worm) => worm.id === me);
    if (!worm || last?.stage !== "running") return;
    liveNote.textContent =
      "The cave keeps running while you choose. Confirm all five slots to resume.";
    loadoutPanel.hidden = false;
    loadoutSelects.forEach((field, index) => {
      field.disabled = false;
      field.value = String(worm.slots[index]!.weaponId);
    });
    liveLoadout.show({
      title: "CHOOSE WEAPONS",
      content: [liveNote, loadoutPanel],
    });
    loadoutSelects[0]?.focus();
  };
  liveDone.onclick = () => {
    if (runtime.loadout(loadoutSelects.map((field) => Number(field.value))))
      liveLoadout.dialog.close();
    else
      liveNote.textContent =
        "Could not confirm weapons. Check your connection and try DONE again.";
  };
  liveLoadout.dialog.addEventListener("close", () => {
    loadoutHome.append(loadoutPanel);
    if (last?.stage === "running") canvas.focus({ preventScroll: true });
  });
  const loadoutSelects = Array.from({ length: 5 }, (_, index) => {
    const label = el("label"),
      select = el("select");
    label.append(el("span", `Slot ${index + 1}`), select);
    select.setAttribute("aria-label", `Weapon slot ${index + 1}`);
    select.onchange = () => {
      if (last?.stage === "lobby")
        runtime.loadout(loadoutSelects.map((field) => Number(field.value)));
    };
    loadoutFields.append(label);
    return select;
  });
  loadoutPanel.append(loadoutFields);
  const settingsPanel = el("div", "", "liero-settings");
  const patchSettings = (patch: Partial<typeof DEFAULT_SETTINGS>) => {
    if (host && last?.stage === "lobby")
      runtime.command({
        type: "settings",
        settings: { ...last.settings, ...patch },
      });
  };
  const settingLabel = (name: string, control: HTMLElement) => {
    const label = el("label");
    label.append(el("span", name), control);
    settingsPanel.append(label);
  };
  const levelChoice = el("select");
  levelChoice.setAttribute("aria-label", "Level");
  for (const level of CLASSIC_LEVELS) {
    const option = el(
      "option",
      `${level.name} · ${level.width} × ${level.height}`,
    );
    option.value = level.id;
    levelChoice.append(option);
  }
  levelChoice.onchange = () => {
    const level = CLASSIC_LEVELS.find((item) => item.id === levelChoice.value);
    if (level) patchSettings({ level: level.id });
  };
  settingLabel("Level", levelChoice);
  const restrictions = el("select");
  for (const [value, name] of [
    ["standard-100lt", "Standard 100lt"],
    ["all", "All 38 Classic weapons"],
  ]) {
    const option = el("option", name);
    option.value = value!;
    restrictions.append(option);
  }
  restrictions.onchange = () =>
    patchSettings({
      restrictionPreset:
        restrictions.value === "all" ? "all" : "standard-100lt",
    });
  settingLabel("Weapons", restrictions);
  const killLimit = el("input");
  killLimit.type = "number";
  killLimit.min = "-1";
  killLimit.max = "150";
  killLimit.step = "1";
  killLimit.onchange = () => {
    if (killLimit.validity.valid)
      patchSettings({ killLimit: Number(killLimit.value) });
  };
  settingLabel("Kill limit (−1: unlimited)", killLimit);
  const timeLimit = el("input");
  timeLimit.type = "number";
  timeLimit.min = "-1";
  timeLimit.max = "20";
  timeLimit.step = "0.5";
  timeLimit.onchange = () => {
    if (timeLimit.validity.valid)
      patchSettings({
        timeLimitMs:
          Number(timeLimit.value) < 0
            ? -1
            : Math.round(Number(timeLimit.value) * 60_000),
      });
  };
  settingLabel("Minutes (−1: unlimited)", timeLimit);
  const loading = el("input");
  loading.type = "number";
  loading.min = "0";
  loading.max = "500";
  loading.step = "1";
  loading.onchange = () => {
    if (loading.validity.valid)
      patchSettings({ loadingTime: Number(loading.value) });
  };
  settingLabel("Loading time %", loading);
  const bonuses = el("input");
  bonuses.type = "checkbox";
  bonuses.onchange = () => patchSettings({ bonuses: bonuses.checked });
  settingLabel("Health and weapon bonuses", bonuses);
  const selfInjure = el("input");
  selfInjure.type = "checkbox";
  selfInjure.onchange = () => patchSettings({ selfInjure: selfInjure.checked });
  settingLabel("Weapons can injure their owner", selfInjure);
  const invite = !solo
    ? createInviteCard({
        code,
        link: url(`?room=${code}`),
        qr: (link) => QRCode.toDataURL(link, { margin: 1, width: 360 }),
      })
    : undefined;
  const tv = button("OPEN TV SCREEN");
  tv.onclick = () =>
    window.open(
      url(`?room=${code}&display=1`),
      "_blank",
      "popup,width=1280,height=800,noopener",
    );
  const play = el("section", "", "liero-play"),
    hud = el("div", "", "liero-hud"),
    score = el("div", "", "liero-scores");
  const round = el("strong"),
    weapon = el("span"),
    clock = el("span");
  hud.append(round, weapon, clock);
  const arenaWrap = el("div", "", "liero-arena"),
    canvas = el("canvas");
  canvas.setAttribute("aria-label", "Live neon cave deathmatch");
  canvas.tabIndex = 0;
  const overlay = el("div", "", "liero-overlay"),
    banner = el("h1"),
    message = el("p"),
    actions = el("div", "", "liero-actions");
  const rematch = button("REMATCH", "fui-button-primary"),
    backLobby = button("LOBBY");
  const chooseAgain = button("CHOOSE WEAPONS", "fui-button-primary");
  chooseAgain.onclick = openLiveLoadout;
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  backLobby.onclick = () =>
    runtime.command({ type: "action", action: "lobby" });
  actions.append(rematch, backLobby, chooseAgain);
  overlay.append(banner, message, actions);
  arenaWrap.append(canvas, overlay);
  const arena = createArena(canvas, arenaDisplay(solo)),
    hints = el("p", keyboardHint(), "liero-hints"),
    pad = el("div", "", "liero-pad");
  for (const [label, bits] of [
    ["LEFT", LEFT],
    ["RIGHT", RIGHT],
    ["AIM ↑", UP],
    ["AIM ↓", DOWN],
    ["JUMP", JUMP],
    ["ROPE", ROPE],
    ["CARVE", CARVE],
    ["PREV", PREV],
    ["NEXT", NEXT],
    ["FIRE", FIRE],
  ] as const) {
    const key = button(label, bits === FIRE ? "liero-fire" : "");
    key.dataset.bits = String(bits);
    key.onpointerdown = (event) => {
      if (!canControl()) return;
      event.preventDefault();
      key.setPointerCapture(event.pointerId);
      controls.setTouch(`touch:${event.pointerId}`, bits);
    };
    const release = (event: PointerEvent) =>
      controls.setTouch(`touch:${event.pointerId}`, 0);
    key.onpointerup = release;
    key.onpointercancel = release;
    key.onlostpointercapture = release;
    key.onkeydown = (event) => {
      if ((event.code === "Space" || event.code === "Enter") && canControl()) {
        event.preventDefault();
        controls.set(`pad:${bits}`, bits);
      }
    };
    key.onkeyup = (event) => {
      if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        controls.set(`pad:${bits}`, 0);
      }
    };
    key.onblur = () => controls.set(`pad:${bits}`, 0);
    pad.append(key);
  }
  const weaponBar = el("div", "", "liero-weapon-bar");
  const weaponButtons = [SLOT1, SLOT2, SLOT3, SLOT4, SLOT5].map(
    (bits, index) => {
      const key = button(`${index + 1}`),
        name = el("span"),
        charge = el("progress");
      charge.max = 1;
      charge.value = 1;
      charge.setAttribute("aria-label", `Weapon slot ${index + 1} charge`);
      key.append(name, charge);
      key.dataset.slot = String(index);
      key.setAttribute("aria-label", `Select weapon slot ${index + 1}`);
      key.onpointerdown = (event) => {
        if (!canControl()) return;
        event.preventDefault();
        key.setPointerCapture(event.pointerId);
        controls.set(`touch:${event.pointerId}`, bits);
      };
      const release = (event: PointerEvent) =>
        controls.set(`touch:${event.pointerId}`, 0);
      key.onpointerup = release;
      key.onpointercancel = release;
      key.onlostpointercapture = release;
      key.onkeydown = (event) => {
        if (
          (event.code === "Space" || event.code === "Enter") &&
          canControl()
        ) {
          event.preventDefault();
          controls.set(`weapon:${index}`, bits);
        }
      };
      key.onkeyup = (event) => {
        if (event.code === "Space" || event.code === "Enter") {
          event.preventDefault();
          controls.set(`weapon:${index}`, 0);
        }
      };
      key.onblur = () => controls.set(`weapon:${index}`, 0);
      weaponBar.append(key);
      return { key, name, charge };
    },
  );
  const connection = el("div", "", "liero-connection");
  connection.append(el("strong", code, "liero-code"), status.element);
  play.append(hud, score, arenaWrap, weaponBar, hints, pad);
  play.hidden = true;
  main.append(connection, nameEntry.form, lobby, play, liveLoadout.dialog);
  app.replaceChildren(top, main);
  createRoomLayout({
    element: lobby,
    invite: invite?.element,
    roster,
    capacity: 5,
    join: nameEntry.form,
    addAI: addBot,
    primaryAction: start,
    actions: [loadoutHome, note, tv, start],
    settings: [settingsPanel],
    compact: solo,
    background: attract,
    ownSlot: () =>
      last?.seats.find((seat) => seat.id === me && !seat.watcher)?.slot,
    onMove: (slot) => {
      const seat = last?.seats.find((seat) => seat.id === me);
      if (seat) runtime.command({ type: "join", name: seat.name, slot });
    },
    playerName: () => social.playerName(undefined) ?? undefined,
    friends: social.friends,
  });
  const canControl = () =>
    !display &&
    last?.stage === "running" &&
    !!last.seats.find(
      (seat) => seat.id === me && !seat.watcher && seat.connected,
    ) &&
    last.world?.worms.find((worm) => worm.id === me)?.weaponsReady !== false &&
    !menu.isOpen() &&
    !document.querySelector("dialog[open]") &&
    !playtestInputBlocked(document);
  const remembered = seatName(
    social.playerName(store.getItem(names.name)) ?? "",
  );
  let scoreKey = "",
    shownLoadout = "",
    shownPreset = "";
  const callbacks: FuseroCallbacks = {
    state(frame, settings) {
      const previousStage = last?.stage;
      last = frame;
      void audio.observe(frame.world?.effects ?? [], frame.matchId);
      if (previousStage !== frame.stage) controls.release();
      observeConfirmedPlay(
        metrics,
        frame,
        () => runtime.confirmedFrame(),
        (view) => ({
          matchId: view.matchId,
          round: view.round,
          active: view.stage === "running" && view.world?.phase === "play",
          roundActive: view.stage === "running" && view.world?.phase === "play",
          ended: view.stage === "over",
          roundEnded: view.stage === "over",
          seated:
            !display &&
            view.seats.some((seat) => seat.id === me && !seat.watcher),
          playerCount: view.seats.filter((seat) => !seat.watcher).length,
          botCount: view.seats.filter((seat) => seat.bot).length,
          mode: solo ? "solo" : settings.display ? "shared" : "online",
        }),
      );
      const seats = frame.seats.filter((seat) => !seat.watcher),
        own = seats.find((seat) => seat.id === me),
        inLobby = frame.stage === "lobby";
      main.dataset.phase = frame.stage;
      main.dataset.round = String(frame.round);
      lobby.hidden = !inLobby;
      play.hidden = inLobby;
      if (
        previousStage !== "running" &&
        frame.stage === "running" &&
        !display &&
        !document.querySelector("dialog[open]")
      )
        canvas.focus({ preventScroll: true });
      nameEntry.form.hidden = display || !!own || !inLobby;
      roster.update(
        seats.map((seat) => ({
          ...seat,
          host: false,
          you: seat.id === me,
          color: COLORS[seat.slot % COLORS.length]!,
        })),
      );
      for (const [id, row] of roster.entries()) {
        let remove = row.querySelector<HTMLButtonElement>(".liero-remove");
        const removable =
          host && seats.some((seat) => seat.id === id && seat.bot);
        if (removable && !remove) {
          remove = button("×", "liero-remove");
          remove.setAttribute("aria-label", "Remove bot");
          remove.onclick = () =>
            runtime.command({ type: "bot", action: "remove", id });
          row.append(remove);
        }
        if (remove) remove.hidden = !removable;
      }
      start.hidden = !host || display;
      start.disabled = seats.length === 0;
      addBot.hidden = !host || seats.length >= 5 || display;
      tv.hidden = solo || display || !host;
      note.textContent =
        seats.length === 0
          ? "Take a seat, add a bot or invite a friend to start."
          : host
            ? "Ready when you are."
            : "Waiting for the host to start.";
      const liveWorm = frame.world?.worms.find((worm) => worm.id === me);
      const selecting =
        frame.stage === "running" &&
        liveWorm?.weaponsReady === false &&
        !display;
      const loadoutSettings = inLobby ? frame.settings : frame.play;
      if (liveLoadout.dialog.open && (!own || frame.stage !== "running"))
        liveLoadout.dialog.close();
      changeWeapons.hidden = display || !own || frame.stage !== "running";
      loadoutPanel.hidden =
        (!inLobby && !liveLoadout.dialog.open) || display || !own;
      const preset = loadoutSettings.restrictionPreset;
      const selected = frame.loadouts[me] ?? defaultLoadout(loadoutSettings);
      const loadoutKey = `${preset}:${selected.join(",")}`;
      if (preset !== shownPreset) {
        shownPreset = preset;
        const allowed = allowedWeaponIds(loadoutSettings);
        for (const field of loadoutSelects)
          field.replaceChildren(
            ...allowed.map((id) => {
              const option = el("option", CLASSIC_WEAPONS[id]!.name);
              option.value = String(id);
              return option;
            }),
          );
        shownLoadout = "";
      }
      if (loadoutKey !== shownLoadout && !liveLoadout.dialog.open) {
        shownLoadout = loadoutKey;
        loadoutSelects.forEach((field, index) => {
          field.value = String(selected[index]);
        });
      }
      for (const field of loadoutSelects)
        field.disabled =
          (!inLobby && !liveLoadout.dialog.open) || !own || display;
      for (const control of [
        levelChoice,
        restrictions,
        killLimit,
        timeLimit,
        loading,
        bonuses,
        selfInjure,
      ])
        control.disabled = !host || !inLobby || display;
      if (document.activeElement !== levelChoice)
        levelChoice.value = settings.level;
      if (document.activeElement !== restrictions) restrictions.value = preset;
      if (document.activeElement !== killLimit)
        killLimit.value = String(frame.settings.killLimit);
      if (document.activeElement !== timeLimit)
        timeLimit.value = String(
          frame.settings.timeLimitMs < 0
            ? -1
            : frame.settings.timeLimitMs / 60_000,
        );
      if (document.activeElement !== loading)
        loading.value = String(frame.settings.loadingTime);
      if (document.activeElement !== bonuses)
        bonuses.checked = frame.settings.bonuses;
      if (document.activeElement !== selfInjure)
        selfInjure.checked = frame.settings.selfInjure;
      menu.update({
        controls: controlHints(),
        canLobby: host && !inLobby && !display,
        display,
        touch: matchMedia("(pointer: coarse)").matches,
        spectator: display || !own,
      });
      if (inLobby && !own && !display && remembered && !joined) {
        joined = true;
        runtime.command({ type: "join", name: remembered });
      }
      if (own) joined = false;
      const world = frame.world;
      if (!world) return;
      play.style.setProperty(
        "--world-aspect",
        String(world.terrain.width / world.terrain.height),
      );
      round.textContent =
        frame.play.killLimit > 0
          ? `DEATHMATCH · ${frame.play.killLimit} KILLS`
          : "DEATHMATCH";
      const worm = world.worms.find((worm) => worm.id === me);
      const selectedWeapon = worm?.slots[worm.weapon];
      weapon.textContent = worm
        ? `${selectedWeapon ? CLASSIC_WEAPONS[selectedWeapon.weaponId]!.name.toUpperCase() : "WEAPON"} · ${worm.alive ? `${Math.max(0, Math.round(worm.health))}% HEALTH` : "KILLED"}${selectedWeapon?.reloading ? " · RELOADING" : selectedWeapon ? ` · ${Math.round(Math.max(0, selectedWeapon.charge) * 100)}% CHARGE` : ""}`
        : "SPECTATING";
      clock.textContent =
        frame.play.timeLimitMs > 0
          ? `${Math.max(0, Math.ceil((frame.play.timeLimitMs - world.elapsedMs) / 1000))}s`
          : "NO TIME LIMIT";
      const scoreModel = world.worms.map((worm) => ({
        id: worm.id,
        slot: worm.slot,
        name: frame.seats.find((seat) => seat.id === worm.id)?.name ?? "Worm",
        score: classicScore(worm, frame.play),
        lives: worm.lives,
      }));
      const key = JSON.stringify(scoreModel);
      if (key !== scoreKey) {
        scoreKey = key;
        score.replaceChildren(
          ...scoreModel.map((worm) => {
            const chip = el(
              "span",
              `${worm.name}  ${worm.score}${frame.play.killLimit > 0 ? ` / ${frame.play.killLimit}` : ""}${worm.lives >= 0 ? ` · ${worm.lives} lives` : worm.lives === -1 ? " · OUT" : ""}`,
            );
            chip.style.setProperty(
              "--worm-color",
              COLORS[worm.slot % COLORS.length]!,
            );
            return chip;
          }),
        );
      }
      pad.hidden = display || !own || frame.stage !== "running" || selecting;
      weaponBar.hidden =
        display || !worm || frame.stage !== "running" || selecting;
      weaponButtons.forEach(({ key, name, charge }, index) => {
        const slot = worm?.slots[index],
          definition = slot ? CLASSIC_WEAPONS[slot.weaponId] : undefined;
        name.textContent = definition?.name ?? "";
        charge.value = slot ? Math.max(0, Math.min(1, slot.charge)) : 0;
        key.classList.toggle("selected", worm?.weapon === index);
        key.classList.toggle("reloading", slot?.reloading === true);
        key.setAttribute("aria-pressed", String(worm?.weapon === index));
        key.title = definition
          ? `${index + 1}: ${definition.name}${slot?.reloading ? " — reloading" : ""}`
          : `Slot ${index + 1}`;
      });
      hints.hidden = display;
      const ended = frame.stage === "over",
        dead = !!worm && !worm.alive && !ended;
      overlay.hidden = !ended && !dead && !selecting;
      const winner =
        frame.seats.find((seat) => seat.id === (frame.winner || world.winner))
          ?.name ?? "Nobody";
      const respawnIn =
        worm?.respawnAtMs === null
          ? 0
          : Math.max(
              0,
              Math.ceil(((worm?.respawnAtMs ?? 0) - world.elapsedMs) / 1000),
            );
      banner.textContent = selecting
        ? "CHOOSE YOUR WEAPONS"
        : dead
          ? worm.lives === -1
            ? "OUT OF LIVES"
            : respawnIn > 0
              ? `RESPAWN IN ${respawnIn}`
              : "READY TO RESPAWN"
          : `${winner.toUpperCase()} WINS`;
      message.textContent = selecting
        ? "The cave keeps running. Confirm your five weapons to resume."
        : dead
          ? worm.lives === -1
            ? "Watch the remaining worms fight it out."
            : frame.play.maxRespawnTimeMs === 0
              ? "You return automatically after the respawn delay."
              : "Press FIRE or JUMP to return to the cave."
          : host
            ? "Play again, or return to the lobby."
            : "Waiting for the host. You can leave from the menu.";
      rematch.hidden = backLobby.hidden = !ended || !host || display;
      chooseAgain.hidden = !selecting;
      actions.hidden = (!ended || !host || display) && !selecting;
      runtime.flush();
    },
    event() {},
    status: (text) => status.show(roomFailure(text)),
    ready(id, creator) {
      me = id;
      host = creator;
    },
    ended() {
      controls.release();
      status.show("Room ended. Return to the menu to reconnect.", "error");
    },
  };
  const runtime = new FuseroRuntime(
    code,
    {
      ...DEFAULT_SETTINGS,
      display:
        !solo &&
        !display &&
        session.kind === "room" &&
        session.role === "host" &&
        store.getItem(names.shared) === "1",
    },
    callbacks,
    session.kind === "room"
      ? {
          displayOnly: display,
          transport: (events) =>
            social.transport(
              code,
              session.token,
              events,
              (next) =>
                new PeerTransport(code, session.token, next, {
                  apiUrl: endpoints.apiUrl,
                  gameId: GAME,
                  maxFastBytes: MAX_PACKET_BYTES,
                }),
            ),
        }
      : { humanName: remembered ?? undefined, autoStartSolo: false },
  );
  const keyboardHeld = new Set<string>();
  // Native PC fire+rope is Ctrl+X. While the arena owns input, it must reach the game
  // before the document-level report shortcut; reporting remains available in the menu.
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        keyboardPlatform !== "pc" ||
        event.code !== "KeyX" ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        isEditableReportTarget(event.target) ||
        !canControl()
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      keyboardHeld.add(event.code);
      controls.set(event.code, KEY_BITS[event.code]!);
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
    const bits = KEY_BITS[event.code];
    if (
      !bits ||
      (event.target instanceof HTMLButtonElement &&
        (event.code === "Space" || event.code === "Enter")) ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement ||
      !canControl()
    )
      return;
    event.preventDefault();
    keyboardHeld.add(event.code);
    controls.set(event.code, bits);
  });
  document.addEventListener("keyup", (event) => {
    if (KEY_BITS[event.code]) {
      keyboardHeld.delete(event.code);
      controls.set(event.code, 0);
    }
    // Chromium may swallow other key-up events while native Mac Command-jump is held.
    if (keyboardPlatform === "mac" && event.code === "MetaLeft") {
      for (const code of keyboardHeld) controls.set(code, 0);
      keyboardHeld.clear();
    }
  });
  window.addEventListener("blur", () => controls.release());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) controls.release();
  });
  let raf = 0,
    frames = 0,
    began = performance.now(),
    fps = 0;
  const draw = (now: number) => {
    controls.update(canControl());
    const timing = runtime.frameTiming();
    const newer = timing?.newer,
      older = timing?.older;
    if (newer?.world && !play.hidden) {
      const span = older ? newer.tick - older.tick : 0;
      const fraction =
        span > 0
          ? Math.max(0, Math.min(1, (timing!.tick - older!.tick) / span))
          : 1;
      arena.draw(
        interpolateArena(
          newer.world,
          older?.matchId === newer.matchId
            ? (older.world ?? undefined)
            : undefined,
          fraction,
        ),
        new Map(newer.seats.map((seat) => [seat.id, seat.name])),
        me,
      );
    }
    frames++;
    if (now - began >= 1000) {
      fps = Math.round((frames * 1000) / (now - began));
      frames = 0;
      began = now;
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  Object.defineProperty(window, "fusero", {
    configurable: true,
    value: {
      state: () => last,
      hash: () => {
        const state = runtime.roomState();
        return state ? fuseroGame.hash(state) : "";
      },
      fps: () => fps,
      camera: () => arena.camera(),
      scale: () => NATIVE_DRAW_SCALE,
      keyboard: () => ({
        platform: keyboardPlatform,
        bindings: { ...KEY_BITS },
      }),
      audio: () => audio.snapshot(),
    },
  });
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => {
      cancelAnimationFrame(raf);
      controls.release();
      menu.dispose();
      audio.dispose();
    },
    reload: () => location.reload(),
  });
  runtime.start();
}

const query = new URLSearchParams(location.search);
if (query.get("solo") === "1") room(true);
else if (query.has("room")) room(false);
else landing();
