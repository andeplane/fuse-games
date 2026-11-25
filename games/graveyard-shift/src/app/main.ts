import {
  createTopBar,
  createHowToPlay,
  createPlayScreen,
  type HowToPlayOptions,
} from "fuse-ui";
import {
  playtestInputBlocked,
  registerPlaytestInput,
} from "fuse-ui/playtest-input";
import { requestedRoomSlot } from "fuse-ui";
import { createGameSocial } from "fuse-ui/social";
import { createResultsHistory } from "fuse-ui/results-history";
import "fuse-ui/social.css";
import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "fuse-ui/results.css";
import "./style.css";
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
  createLeadClock,
  ticksAhead,
  uuid,
} from "fuse-netcode";
import {
  button,
  createAppPortal,
  createLandingCard,
  createRoomLayout,
  createInviteCard,
  createNameEntry,
  createNotice,
  createRoster,
  createResultsScreen,
  createSharedTvOption,
  el,
} from "fuse-ui";
import {
  UP,
  DOWN,
  LEFT,
  RIGHT,
  VACUUM,
  PULSE,
  DURATION,
  botInput,
  carried,
  type World,
} from "../engine/world.js";
import type { WorldView } from "../engine/view.js";
import { createSmoother, forward, forwardInputs, memoBot } from "./forward.js";
import { GraveyardRuntime } from "../online/runtime.js";
import type { View } from "../online/game.js";
import { readShiftHistory } from "./history.js";
import { seatName } from "../online/names.js";
import { draw, COLORS } from "../render/scene.js";
import {
  keys,
  safeStore,
  sessionFor,
  roomFailure,
  createSeatAdmission,
} from "./session.js";
import { NightAudio } from "./audio.js";
import { resultBar, resultReport, shiftResult } from "./result-report.js";
import { createModalInputGate } from "fuse-ui/modal-input";
import {
  observeConfirmedPlay,
  createPlayMetrics,
  startGameAnalytics,
} from "fuse-ui/play-metrics";
const GAME = "graveyard-shift",
  app = document.querySelector<HTMLElement>("#app")!,
  store = safeStore(() => localStorage),
  names = keys(GAME),
  query = new URLSearchParams(location.search);
/** `?lead=off` draws the old way, the newest folded tick as it is, to compare the feel against. */
const drawAhead = query.get("lead") !== "off",
  /** `?probe` publishes where this device's hunter was last drawn, for `scripts/lead-press-latency.ts`. */
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
const audio = new NightAudio(store, location.search);
let runtime: GraveyardRuntime | undefined;
let latest: View | undefined;
let self = "";
let alive = true;
const url = (search = "") =>
  endpoints.appUrl(
    search + (query.has("mute") ? (search ? "&" : "?") + "mute" : ""),
  );
function navigate(search = "") {
  runtime?.stop();
  audio.stop();
  location.href = url(search);
}
function header(extra: HTMLElement[] = [], leave?: () => void) {
  const h = el("header", "", "top"),
    portal = createAppPortal({
      document,
      current: GAME,
      base: import.meta.env.BASE_URL,
      search: location.search,
    }),
    brand = el("a", "GRAVEYARD SHIFT", "brand");
  brand.href = url();
  if (leave)
    brand.onclick = (event) => {
      if (
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      leave();
    };
  h.append(portal.element, brand, social.element(), ...extra);
  return createTopBar({
    element: h,
    gameId: GAME,
    sound: {
      enabled: () => !(audio.prefs.muted.music && audio.prefs.muted.effects),
      forcedMute: audio.silent,
      setEnabled(on) {
        if (on === (audio.prefs.muted.music && audio.prefs.muted.effects))
          audio.toggle();
      },
    },
  });
}
const HOW_TO_PLAY: HowToPlayOptions = {
  goal: "Bank the most ghost energy at the shrines in 90 seconds. Only banked energy counts; equal scores share placement.",
  controls: [
    { keys: "WASD / arrows", action: "Move" },
    {
      keys: "J / left mouse",
      action: "Hold to vacuum a ghost in front of you",
    },
    { keys: "Space / K", action: "Pulse to disrupt nearby rivals" },
  ],
  touchControls: [
    { keys: "Direction pad", action: "Hold to move" },
    { keys: "Action buttons", action: "Vacuum ghosts or send a pulse" },
  ],
  rules: [
    "Carry up to five ghosts. Stand still at a gold shrine for 1.25 seconds to bank them; moving interrupts delivery.",
  ],
};
function handbook() {
  const d = el("dialog", "", "handbook");
  d.append(
    el("p", "FIELD GUIDE / 01", "eyebrow"),
    el("h2", "Your first night"),
    createHowToPlay(HOW_TO_PLAY),
  );
  const steps = [
    [
      "01 / VACUUM",
      "Face a ghost and hold J or left mouse. Stay in range while its resistance ring drains. Contests reward sustained suction.",
    ],
    [
      "02 / CARRY",
      "Your backpack holds five ghosts. Wisps are worth 1; wraiths are worth 4 and tug you toward them.",
    ],
    [
      "03 / CONTAIN",
      "Stand still at either gold shrine for 1.25 seconds to bank your whole tank. Moving interrupts delivery.",
    ],
    [
      "04 / DISRUPT",
      "Space or K sends an air pulse. It interrupts nearby rivals and releases one of their ghosts. Recharge: 3.5 seconds.",
    ],
  ];
  for (const [a, b] of steps) {
    d.append(el("h3", a), el("p", b));
  }
  d.append(
    el(
      "p",
      "WASD / ARROWS to move • J / MOUSE to vacuum • SPACE / K to pulse. On phones, hold the direction pad and action buttons. Equal banked scores share placement.",
    ),
  );
  const close = button("READY FOR THE NIGHT", "primary");
  close.onclick = () => d.close();
  d.append(close);
  app.append(d);
  d.showModal();
}
function canvas() {
  const c = el("canvas", "", "arena");
  c.width = 1000;
  c.height = 620;
  c.setAttribute(
    "aria-label",
    "Moonlit cemetery arena with hunters, ghosts and two containment shrines",
  );
  return c;
}
document.addEventListener("pointerdown", () => audio.resume());
document.addEventListener("keydown", () => audio.resume());
if (!query.has("room") && query.get("solo") !== "1") landing();
else room();
function landing() {
  app.append(header());
  const hero = el("main", "", "landing"),
    art = el("section", "", "hero"),
    c = canvas();
  const title = el("div", "", "hero-title");
  title.append(
    el("p", "ST. HOLLOW CEMETERY • MIDNIGHT", "eyebrow"),
    el("h1", "GRAVEYARD\nSHIFT"),
    el(
      "p",
      "The dead are restless.\nYour night just got interesting.",
      "tagline",
    ),
  );
  art.append(c, title);
  title.remove();
  hero.classList.add("fui-menu-stage");
  art.classList.add("fui-menu-scene");
  const card = createLandingCard({
    howToPlay: HOW_TO_PLAY,
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    title: "GRAVEYARD SHIFT",
    tagline:
      "Catch ghosts. Fill your tank. Reach a shrine before a rival blows your haul loose.",
    soloText: "START SOLO SHIFT",
    async onCreate() {
      const r = await createRoom(endpoints.apiUrl, fetch, GAME);
      store.setItem(names.host(r.code), r.token);
      navigate(`?room=${r.code}`);
    },
    onSolo: () => navigate("?solo=1"),
    valid: validRoomCode,
    onJoin: (code) => navigate(`?room=${code}`),
  });
  const guide = button("FIELD GUIDE", "guide");
  guide.onclick = handbook;
  card.menu.help.append(
    guide,
    el("p", "2–5 HUNTERS • SOLO + BOTS • 90 SECONDS", "meta"),
  );
  hero.append(art, card.element);
  app.append(hero);
}
function room() {
  const session = sessionFor(
    location.search,
    store,
    GAME,
    validRoomCode,
    () => uuid().replaceAll("-", "") + uuid().replaceAll("-", ""),
  );
  if (session.kind === "invalid" || session.kind === "landing") {
    app.append(header(), el("p", "Invalid room code. Return to the menu."));
    return;
  }
  const solo = session.kind === "solo",
    code = session.kind === "room" ? session.code : "SOLO",
    display = session.kind === "room" && session.role === "display";
  const history = createResultsHistory({
    fetch: social.reportFetch,
    apiUrl: endpoints.apiUrl,
    gameId: GAME,
    ...(session.kind === "room"
      ? { room: { code: session.code, token: session.token } }
      : {}),
    signedIn: social.isSignedIn,
    playerId: () => self,
    now: () => performance.now(),
  });
  const leave = () => {
    const leavingRuntime = runtime;
    history.close(
      () => readShiftHistory(leavingRuntime),
      () => {
        leavingRuntime?.stop();
        audio.stop();
        location.href = url();
      },
    );
  };
  let host = solo,
    shared = false;
  // The room's state is one line: at the room's foot while it waits, in the bar during a shift. What went wrong is
  // said apart from it, above the room. The room's code is on its invitation.
  const status = createNotice({ className: "gs-status" }),
    live = createNotice({ className: "gs-live" }),
    problem = createNotice({ className: "gs-alert" });
  // The room gone: nothing that arrives afterwards may take that off the screen.
  let over = false;
  const say = (text: string, tone: "info" | "error", last = false) => {
    if (over) return;
    over = last;
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
  // Leaving and reconnecting are the bar's menu's: the room has Back, a shift has only the bar.
  const exit = button("LEAVE"),
    retry = button("RECONNECT", "retry"),
    menu = el("div", "", "gs-menu");
  exit.onclick = leave;
  retry.onclick = () => location.reload();
  menu.append(exit, retry);
  app.append(header([live.element, menu], leave));
  const main = el("main", "", "room"),
    lobby = el("section", "", "lobby"),
    roster = createRoster({ emptyText: "Waiting for the night crew" }),
    add = button("+ ADD BOT"),
    ready = button("READY", "primary"),
    help = button("HOW TO PLAY");
  help.onclick = handbook;
  const lobbyNote = el(
      "p",
      "Every human hunter presses READY. Bots are always ready.",
      "fui-lobby-note",
    ),
    rules = el("p", "90 seconds. Two shrines. Only banked energy counts.");
  // Shared TV is the room's choice, made in the room: the host turns it on here and opens the screen beside it.
  // The choice is remembered for the next room this device creates, once the room has taken it.
  const sharedTv = createSharedTvOption({
    className: "gs-tv-option",
    onChange: (display) => {
      const sent =
        runtime?.command({ type: "settings", settings: { display } }) ?? false;
      if (sent) store.setItem(names.shared, display ? "1" : "0");
      return sent;
    },
    onOpenScreen: () =>
      window.open(url(`?room=${code}&display=1`), "_blank", "noopener"),
  });
  add.onclick = () =>
    runtime?.command({
      type: "bot",
      action: "add",
      slot: requestedRoomSlot(add),
    });
  ready.onclick = () => runtime?.readyUp();
  if (!solo) {
    const invite = createInviteCard({
      code,
      link: url(`?room=${code}`),
      qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 240 }),
    });
    lobby.append(invite.element);
  }
  const rememberedName = social.playerName(store.getItem(names.name)) ?? null;
  const admission = createSeatAdmission(rememberedName, (playerName) =>
    runtime?.command({
      type: "join",
      name: playerName,
      slot: requestedRoomSlot(name.form),
    }),
  );
  const name = createNameEntry({
    initial: rememberedName ?? "",
    normalize: (v) => seatName(v) ?? "",
    onInput: (v) => store.setItem(names.name, v),
    buttonText: "JOIN CREW",
    onSubmit: (v) => {
      store.setItem(names.name, v);
      admission.submit(v);
    },
  });
  const play = el("section", "", "play"),
    hud = el("div", "", "hud"),
    timer = el("strong", "01:30", "clock"),
    scores = el("div", "", "scores"),
    c = canvas(),
    hint = el("p", "Move · Vacuum · Carry · Contain", "hint"),
    pad = el("section", "", "pad"),
    personal = el("p", "", "personal");
  hud.append(scores, timer);
  play.append(hud, c, hint, personal, pad);
  const dirs = el("div", "", "directions"),
    abilities = el("div", "", "abilities");
  pad.append(dirs, abilities);
  const sources = new Map<string, number>();
  let bits = 0;
  const update = () => {
    if (modalInput.blocked()) return;
    bits = [...sources.values()].reduce((a, b) => a | b, 0);
    runtime?.input(bits);
  };
  const clear = () => {
    sources.clear();
    bits = 0;
    runtime?.cancel();
  };
  // A phone's live shift is the whole screen; the wide cemetery is drawn turned when the phone is upright.
  const playScreen = createPlayScreen({
    stage: play,
    wide: true,
    onChange: clear,
  });
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
    cancel: clear,
  });
  const hold = (
    label: string,
    bit: number,
    parent: HTMLElement,
    cls: string,
  ) => {
    const b = button(label, cls);
    b.setAttribute("aria-label", label);
    b.onpointerdown = (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      sources.set(`p${e.pointerId}`, bit);
      update();
    };
    const release = (e: PointerEvent) => {
      sources.delete(`p${e.pointerId}`);
      update();
    };
    b.onpointerup = release;
    b.onpointercancel = clear;
    b.onlostpointercapture = (e) => {
      if (sources.has(`p${e.pointerId}`)) clear();
    };
    parent.append(b);
    return b;
  };
  hold("↑", UP, dirs, "up");
  hold("←", LEFT, dirs, "left");
  hold("↓", DOWN, dirs, "down");
  hold("→", RIGHT, dirs, "right");
  hold("VACUUM", VACUUM, abilities, "vacuum");
  const pulse = hold("AIR PULSE", PULSE, abilities, "pulse");
  const keysMap: Record<string, number> = {
    w: UP,
    arrowup: UP,
    s: DOWN,
    arrowdown: DOWN,
    a: LEFT,
    arrowleft: LEFT,
    d: RIGHT,
    arrowright: RIGHT,
    j: VACUUM,
    k: PULSE,
    " ": PULSE,
  };
  document.addEventListener("keydown", (e) => {
    if (modalInput.blocked() || e.repeat) return;
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target instanceof HTMLButtonElement && e.key === " ")
    )
      return;
    const b = keysMap[e.key.toLowerCase()];
    if (b) {
      e.preventDefault();
      sources.set(e.key.toLowerCase(), b);
      update();
    }
  });
  document.addEventListener("keyup", (e) => {
    sources.delete(e.key.toLowerCase());
    update();
  });
  const stopPlaytestInput = registerPlaytestInput(document, { cancel: clear });
  window.addEventListener("pagehide", stopPlaytestInput, { once: true });
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", () => {
    clear();
    audio.visibility(document.hidden);
  });
  c.onpointerdown = (e) => {
    if (modalInput.blocked()) return;
    if (e.button !== 0) return;
    c.setPointerCapture(e.pointerId);
    sources.set(`p${e.pointerId}`, VACUUM);
    update();
  };
  c.onpointerup =
    c.onpointercancel =
    c.onlostpointercapture =
      (e) => {
        sources.delete(`p${e.pointerId}`);
        update();
      };
  // The result: the shared results screen over the page, on the TV and a phone controller too.
  const results = createResultsScreen({
    document,
    onBack: leave,
    backText: "Leave",
    onAction: (id) => {
      if (id === "rematch") runtime?.readyUp();
      else runtime?.command({ type: "action", action: "lobby" });
    },
  });
  /** What the results screen last showed: it is rebuilt only when the result itself changed. */
  let shownResult = "";
  main.append(problem.element, name.form, lobby, play, results.element);
  ready.hidden = true;
  add.hidden = true;
  play.hidden = true;
  name.form.hidden = true;
  app.append(main);
  /** This device's own seat in the lobby, as the last frame had it. */
  let ownSeat: { name: string; slot: number } | undefined;
  createRoomLayout({
    // Seated already: any open seat is a move, and the hunter's colour follows it.
    ownSlot: () => ownSeat?.slot,
    onMove: (slot) => {
      if (ownSeat) runtime?.command({ type: "join", name: ownSeat.name, slot });
    },
    primaryAction: ready,
    playerName: () => social.playerName(undefined) ?? undefined,
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    element: lobby,
    roster,
    friends: social.friends,
    capacity: 5,
    join: name.form,
    addAI: add,
    settings: [rules, help],
    actions: [lobbyNote],
    actionsInHeader: true,
    status: status.element,
    ...(solo
      ? { compact: true, heading: "Solo shift" }
      : { heading: "Room", extras: [sharedTv.element] }),
  });
  let previous: World | undefined;
  runtime = new GraveyardRuntime(
    code,
    {
      display:
        !solo &&
        session.kind === "room" &&
        session.role === "host" &&
        store.getItem(names.shared) === "1",
    },
    {
      state(frame, settings) {
        latest = frame;
        host = solo || frame.managerId === self;
        shared = settings.display;
        runtime?.flush();
        if (!display) {
          const snapshot = readShiftHistory(runtime);
          history.observe(snapshot.receipts, snapshot.confirmedTick);
        }
        const mine = frame.seats.find((s) => s.id === self && !s.watcher);
        ownSeat = frame.stage === "lobby" ? mine : undefined;
        observeConfirmedPlay(
          observePlay,
          frame,
          () => runtime?.confirmedFrame(),
          (frame) => {
            const players = frame.seats.filter((s) => !s.watcher);
            return {
              matchId: frame.matchId,
              roundActive: frame.stage === "running",
              roundEnded: frame.stage === "over",
              active: frame.stage === "running",
              ended: frame.stage === "over",
              playerCount: players.length,
              botCount: players.filter((s) => s.bot).length,
              seated: players.some((seat) => seat.id === self),
              mode: solo ? "solo" : shared ? "shared" : "online",
            };
          },
        );
        main.dataset.phase = frame.stage;
        main.dataset.screen = frame.stage === "lobby" ? "lobby" : "play";
        main.dataset.tick = String(frame.tick);
        main.dataset.layout =
          shared && !display && !!mine ? "controller" : "arena";
        name.form.hidden = solo || display || !!mine;
        lobby.hidden = frame.stage !== "lobby";
        play.hidden = frame.stage === "lobby";
        pad.hidden = display || !mine || frame.stage !== "running";
        // Only the shift itself: the lobby and the results are tapped, and a shared screen's phone is its own pad.
        playScreen.update(
          !display && !(shared && mine) && frame.stage === "running",
        );
        c.hidden = shared && !display && !!mine;
        personal.hidden = display;
        add.hidden = !host || frame.seats.filter((s) => !s.watcher).length >= 5;
        sharedTv.update(
          shared,
          host && !display && !solo && frame.stage === "lobby",
        );
        ready.hidden = display || !mine;
        ready.textContent = frame.ready[self] ? "WAITING FOR CREW…" : "READY";
        // A newcomer without a seat still needs the name form, which the screen would cover.
        const result =
          !mine && !display && !solo
            ? undefined
            : shiftResult(frame, { self, host, solo });
        if (!result) {
          if (results.open) results.hide();
          shownResult = "";
        } else {
          // The bar's own fields do not rebuild the report; an account that turns up after the shift gets its button.
          const shown = JSON.stringify([
            { ...result, host: false, ready: false, waiting: "" },
            result.rows.map((row) => social.friends.publicIdOfMember(row.id)),
          ]);
          const first = !shownResult;
          if (shown !== shownResult) {
            shownResult = shown;
            results.show(
              resultReport(result, {
                color: (slot) => COLORS[slot] ?? "#eef0ff",
                friend: (id) => {
                  const publicId = social.friends.publicIdOfMember(id);
                  return publicId
                    ? social.friends.friendButton(publicId)
                    : undefined;
                },
              }),
            );
          }
          results.update(resultBar(result));
          if (first)
            results.actions
              .querySelector<HTMLButtonElement>("button.is-primary")
              ?.focus();
        }
        if (!display && !host) admission.observe(!!mine);
        roster.update(
          frame.seats
            .filter((s) => !s.watcher)
            .map((s) => ({
              id: s.id,
              slot: s.slot,
              name: s.name,
              status: s.bot
                ? "BOT"
                : !s.connected
                  ? "AWAY"
                  : frame.ready[s.id]
                    ? "READY"
                    : "NOT READY",
              color: COLORS[s.slot]!,
              host: s.id === frame.managerId,
            })),
        );
        for (const [id, row] of roster.entries()) {
          const s = frame.seats.find((s) => s.id === id);
          let b = row.querySelector<HTMLButtonElement>(".remove");
          if (host && s?.bot && !b) {
            b = button("×", "remove");
            b.onclick = () =>
              runtime?.command({ type: "bot", action: "remove", id });
            row.append(b);
          }
        }
        const w = frame.world;
        if (!w) return;
        const seconds = Math.ceil((DURATION - w.tick) / 20);
        timer.textContent = `${Math.floor(seconds / 60)
          .toString()
          .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
        scores.replaceChildren(
          ...w.hunters.map((h) => {
            const card = el("div", "", "score");
            card.style.setProperty("--hunter", COLORS[h.slot]!);
            card.append(
              el(
                "span",
                frame.seats.find((s) => s.id === h.id)?.name ?? "Hunter",
              ),
              el("strong", String(h.score).padStart(3, "0")),
              el("small", `${h.tank.length}/5 · +${carried(w, h)} carried`),
            );
            return card;
          }),
        );
        const me = w.hunters.find((h) => h.id === self);
        if (me) {
          personal.dataset.x = String(me.x);
          personal.dataset.y = String(me.y);
        }
        personal.textContent = me
          ? `${mine?.name ?? "Hunter"} · BANKED ${me.score} · TANK ${me.tank.length}/5 · CARRYING ${carried(w, me)}`
          : "Watching the night crew";
        pulse.textContent = me?.cooldown
          ? `PULSE ${(me.cooldown / 20).toFixed(1)}s`
          : "AIR PULSE";
        hint.textContent = me?.deposit
          ? "CONTAINING… Hold still."
          : me?.tank.length === 5
            ? "TANK FULL — reach either shrine and hold still."
            : "WASD / ARROWS move   ·   J / MOUSE vacuum   ·   SPACE pulse";
        if (previous && me) {
          const old = previous.hunters.find((h) => h.id === self);
          if (old) {
            if (me.score > old.score) audio.cue("deposit");
            else if (me.tank.length > old.tank.length) audio.cue("capture");
            if (me.pulse > old.pulse) audio.cue("pulse");
            if (me.stun > old.stun) audio.cue("hit");
          }
        }
        previous = w;
      },
      event() {},
      status: (s) => {
        const shown = roomFailure(s);
        say(shown, shown === s ? "info" : "error");
      },
      ready(id, isHost) {
        self = id;
        host = isHost;
      },
      ended() {
        playScreen.destroy();
        say(
          "Room ended. Return to the menu to create a new shift.",
          "error",
          true,
        );
      },
    },
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
      : { humanName: social.playerName(store.getItem(names.name)) ?? "Hunter" },
  );
  installRoomLifecycle(window, {
    stop: () => {
      clear();
      runtime?.stop();
    },
    destroy: () => {
      history.dispose();
      modalInput.dispose();
      stopPlaytestInput();
      alive = false;
      audio.stop();
    },
    reload: () => location.reload(),
  });
  runtime.start();
  // ---- drawing: the newest folded night played forward to the clock, once per animation frame ----
  const smoother = createSmoother(),
    leadClock = createLeadClock(),
    drawBot = memoBot(botInput);
  /** What to draw now: the forward run while the night runs, otherwise the newest folded world as it is. */
  const picture = (now: number): WorldView | null | undefined => {
    const timing = runtime?.frameTiming(),
      state = runtime?.roomState(),
      newer = timing?.newer.world;
    if (
      !drawAhead ||
      !runtime ||
      !timing ||
      !newer ||
      state?.stage !== "running" ||
      state.world?.tick !== newer.tick
    )
      return latest?.world;
    const revision = timing.revision ?? 0;
    return smoother.apply(
      forward(
        state.world,
        leadClock(ticksAhead(timing), timing.newer.logTick, now),
        forwardInputs(
          state,
          self,
          runtime.heldNow,
          drawBot(`${state.matchId}:${state.round}:${revision}`),
        ),
      ),
      `${state.matchId}:${state.round}`,
      revision,
      newer.tick,
      state.held,
      now,
      self,
    );
  };
  const render = (now: number) => {
    if (!alive) return;
    const world = c.hidden ? undefined : picture(now);
    if (world) {
      if (probe) {
        const mine = world.hunters.find((h) => h.id === self);
        Reflect.set(window, "__leadProbe", {
          at: performance.now(),
          x: mine?.x,
          y: mine?.y,
        });
      }
      draw(c.getContext("2d")!, world, self);
    }
    audio.frame();
    requestAnimationFrame(render);
  };
  requestAnimationFrame(render);
}
