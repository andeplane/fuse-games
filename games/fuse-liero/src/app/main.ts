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
import { playtestInputBlocked } from "fuse-ui/playtest-input";
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
  FRAG_TARGET,
  ROUND_STEPS,
  COUNTDOWN_STEPS,
  LEFT,
  RIGHT,
  UP,
  DOWN,
  JUMP,
  FIRE,
  ROPE,
  NEXT,
} from "../engine/index.js";
import { lieroGame, type View } from "../online/game.js";
import { seatName } from "../online/names.js";
import { LieroRuntime, type LieroCallbacks } from "../online/runtime.js";
import { keys, safeStore, sessionFor, roomFailure } from "./session.js";
import { createArena, COLORS } from "./arena.js";
import { HeldControls, KEY_BITS } from "./controls.js";

const GAME = lieroGame.id;
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
const url = (query = "") =>
  endpoints.appUrl(query + (muted ? `${query ? "&" : "?"}mute` : ""));
const CONTROLS = [
  { keys: "A D / ← →", action: "Move" },
  { keys: "W S / ↑ ↓", action: "Aim" },
  { keys: "Space", action: "Jump" },
  { keys: "F / J", action: "Fire" },
  { keys: "R / K", action: "Hold ninja rope; release to let go" },
  { keys: "Q / E", action: "Switch weapon" },
];
const TOUCH = [
  { keys: "LEFT / RIGHT", action: "Move" },
  { keys: "AIM ↑ / ↓", action: "Aim" },
  { keys: "JUMP / FIRE", action: "Jump and fire" },
  { keys: "ROPE", action: "Hold to attach; release to let go" },
  { keys: "WEAPON", action: "Switch weapon" },
];
const GOAL = `First to ${FRAG_TARGET} frags wins the cave. Rockets dig tunnels; grenades bounce; scattergun hits up close. You respawn after being knocked out. Two caves win the match.`;

function header(
  extra: HTMLElement[] = [],
  onOpenChange?: (open: boolean) => void,
) {
  const bar = el("header", "", "liero-top"),
    brand = el("a", "FUSE LIERO", "liero-brand");
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
  return createTopBar({ element: bar, gameId: GAME, onOpenChange });
}

/** Menu-only simulation, separate from actual play and disposed when hidden. */
function attract(host: HTMLElement) {
  const canvas = el("canvas", "", "liero-attract");
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);
  const arena = createArena(canvas);
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
  return {
    advance() {
      stepWorld(
        world,
        new Map(world.worms.map((worm) => [worm.id, botInput(world, worm)])),
      );
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
    title: "FUSE LIERO",
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
    const back = el("a", "Back to Fuse Liero");
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
  const controls = new HeldControls((bits) => runtime.input(bits));
  const menu = createGameMenu({
    controls: CONTROLS,
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
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  backLobby.onclick = () =>
    runtime.command({ type: "action", action: "lobby" });
  actions.append(rematch, backLobby);
  overlay.append(banner, message, actions);
  arenaWrap.append(canvas, overlay);
  const arena = createArena(canvas),
    hints = el(
      "p",
      "A D move · W S aim · Space jump · F fire · hold R rope · Q weapon",
      "liero-hints",
    ),
    pad = el("div", "", "liero-pad");
  for (const [label, bits] of [
    ["LEFT", LEFT],
    ["RIGHT", RIGHT],
    ["AIM ↑", UP],
    ["AIM ↓", DOWN],
    ["JUMP", JUMP],
    ["ROPE", ROPE],
    ["WEAPON", NEXT],
    ["FIRE", FIRE],
  ] as const) {
    const key = button(label, bits === FIRE ? "liero-fire" : "");
    key.dataset.bits = String(bits);
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
    pad.append(key);
  }
  const connection = el("div", "", "liero-connection");
  connection.append(el("strong", code, "liero-code"), status.element);
  play.append(hud, score, arenaWrap, hints, pad);
  play.hidden = true;
  main.append(connection, nameEntry.form, lobby, play);
  app.replaceChildren(top, main);
  createRoomLayout({
    element: lobby,
    invite: invite?.element,
    roster,
    capacity: 5,
    join: nameEntry.form,
    addAI: addBot,
    primaryAction: start,
    actions: [note, tv, start],
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
    !menu.isOpen() &&
    !document.querySelector("dialog[open]") &&
    !playtestInputBlocked(document);
  const remembered = seatName(
    social.playerName(store.getItem(names.name)) ?? "",
  );
  let scoreKey = "";
  const callbacks: LieroCallbacks = {
    state(frame, settings) {
      const previousStage = last?.stage;
      last = frame;
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
          roundEnded: view.stage === "between" || view.stage === "over",
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
      start.disabled = seats.length < 2;
      addBot.hidden = !host || seats.length >= 5 || display;
      tv.hidden = solo || display || !host;
      note.textContent =
        seats.length < 2
          ? "Add a bot or invite a friend to start."
          : host
            ? "Ready when you are."
            : "Waiting for the host to start.";
      menu.update({
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
      round.textContent = `CAVE ${frame.round} · FIRST TO ${FRAG_TARGET}`;
      const worm = world.worms.find((worm) => worm.id === me);
      weapon.textContent = worm
        ? `${["ROCKET", "GRENADE", "SCATTERGUN"][worm.weapon]} · ${worm.health > 0 ? `${worm.health} HP` : "RESPAWNING"}`
        : "SPECTATING";
      clock.textContent = `${Math.max(0, Math.ceil((COUNTDOWN_STEPS + ROUND_STEPS - world.step) / 60))}s`;
      const scoreModel = world.worms.map((worm) => ({
        id: worm.id,
        slot: worm.slot,
        name: frame.seats.find((seat) => seat.id === worm.id)?.name ?? "Worm",
        frags: worm.frags,
        wins: frame.wins[worm.id] ?? 0,
      }));
      const key = JSON.stringify(scoreModel);
      if (key !== scoreKey) {
        scoreKey = key;
        score.replaceChildren(
          ...scoreModel.map((worm) => {
            const chip = el(
              "span",
              `${worm.name}  ${worm.frags} / ${FRAG_TARGET}${worm.wins ? ` · ${worm.wins} caves` : ""}`,
            );
            chip.style.setProperty(
              "--worm-color",
              COLORS[worm.slot % COLORS.length]!,
            );
            return chip;
          }),
        );
      }
      pad.hidden = display || !own || frame.stage !== "running";
      hints.hidden = display;
      const countdown = world.phase === "countdown",
        ended = frame.stage === "over" || frame.stage === "between";
      overlay.hidden = !countdown && !ended;
      const winner =
        frame.seats.find((seat) => seat.id === (frame.winner || world.winner))
          ?.name ?? "Nobody";
      banner.textContent = countdown
        ? "DIG IN"
        : `${winner.toUpperCase()} WINS${frame.stage === "over" ? " THE MATCH" : " THE CAVE"}`;
      message.textContent = countdown
        ? "Find your worm. The cave is about to erupt."
        : frame.stage === "between"
          ? `Next cave in ${Math.ceil(frame.resumeIn / 20)}s`
          : host
            ? "Play again, or return to the lobby."
            : "Waiting for the host. You can leave from the menu.";
      actions.hidden = frame.stage !== "over" || !host || display;
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
  const runtime = new LieroRuntime(
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
      : { humanName: remembered ?? undefined },
  );
  document.addEventListener("keydown", (event) => {
    const bits = KEY_BITS[event.code];
    if (
      !bits ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLButtonElement ||
      !canControl()
    )
      return;
    event.preventDefault();
    controls.set(event.code, bits);
  });
  document.addEventListener("keyup", (event) => {
    if (KEY_BITS[event.code]) controls.set(event.code, 0);
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
    if (last?.world && !play.hidden)
      arena.draw(
        last.world,
        new Map(last.seats.map((seat) => [seat.id, seat.name])),
        me,
      );
    frames++;
    if (now - began >= 1000) {
      fps = Math.round((frames * 1000) / (now - began));
      frames = 0;
      began = now;
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  Object.defineProperty(window, "fuseLiero", {
    configurable: true,
    value: {
      state: () => last,
      hash: () => {
        const state = runtime.roomState();
        return state ? lieroGame.hash(state) : "";
      },
      fps: () => fps,
      camera: () => arena.camera(),
    },
  });
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => {
      cancelAnimationFrame(raf);
      controls.release();
      menu.dispose();
    },
    reload: () => location.reload(),
  });
  runtime.start();
}

const query = new URLSearchParams(location.search);
if (query.get("solo") === "1") room(true);
else if (query.has("room")) room(false);
else landing();
