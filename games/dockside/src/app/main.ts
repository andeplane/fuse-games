import { createPlayScreen, createTopBar } from "fuse-ui";
import { createControls, CONTROLS, TOUCH_CONTROLS } from "./controls.js";
import { createArena, COLORS } from "./arena.js";
import { createRadar } from "./radar.js";
import { COST, laneAtFactory } from "../game/canal.js";
import { requestedRoomSlot } from "fuse-ui";
import { createGameSocial } from "fuse-ui/social";
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
import "fuse-ui/results.css";
import "./dockside.css";
import QRCode from "qrcode";
import {
  PeerTransport,
  createEndpoints,
  createRoom,
  installRoomLifecycle,
  validRoomCode,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES, uuid } from "fuse-netcode";
import {
  button,
  createAppPortal,
  createGameMenu,
  createInviteCard,
  createLandingCard,
  createRoomLayout,
  createNameEntry,
  createNotice,
  createLiveResults,
  createResultsScreen,
  createRoster,
  createSharedTvOption,
  createRoundControls,
  type ResultsReport,
  type ResultsBar,
  el,
} from "fuse-ui";
import {
  DEFAULT_SETTINGS,
  docksideGame,
  seatName,
  type Settings as DocksideSettings,
} from "../game/index.js";

import { createReceiptReporter } from "fuse-ui/receipt-reporting";
import { dueReports, decisionConfirmed } from "./reports.js";
import { DocksideRuntime, type DocksideCallbacks } from "./runtime.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "fuse-ui/room-session";

const GAME = docksideGame.id;
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
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
const app = document.querySelector<HTMLElement>("#app")!;
const GOAL =
  "Escort a drone through the opposing gate. Touch a turret to claim it, or tap Action near a neutral turret. Turrets earn extra credits. Tap Action on your factory’s north or south pad to spend 6 credits and launch on that lane. Both forms carry three weapons. The walker can jump and cross the catwalk. Travel form moves faster.";
function localUrl(query = "") {
  const url = new URL(endpoints.appUrl(query), location.href);
  if (new URLSearchParams(location.search).has("mute"))
    url.searchParams.set("mute", "");
  return url.href;
}
function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "dockside-top"),
    brand = el("a", "", "dockside-brand");
  brand.href = localUrl();
  brand.append(el("span", "DOCKSIDE"), el("small", "A FUSE GAME"));
  // Every game opens the app portal top left; it lists the games that have a portal.json.
  const portal = createAppPortal({
    document,
    current: GAME,
    base: import.meta.env.BASE_URL,
    search: location.search,
  });
  bar.append(portal.element, brand, social.element(), ...extra);
  return createTopBar({ element: bar, gameId: GAME });
}

function landing(): void {
  const card = createLandingCard({
    howToPlay: {
      goal: GOAL,
      controls: CONTROLS,
      touchControls: TOUCH_CONTROLS,
    },
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    title: "Dockside",
    tagline: "Take the bridge. Get your convoy through Canal Lock.",
    soloText: "SOLO PRACTICE",
    async onCreate() {
      const room = await createRoom(endpoints.apiUrl, fetch, GAME).catch(
        (error: unknown) => {
          throw new Error(
            roomFailure(error instanceof Error ? error.message : String(error)),
          );
        },
      );
      store.setItem(names.host(room.code), room.token);
      location.href = localUrl(`?room=${room.code}`);
    },
    onSolo: () => {
      location.href = localUrl("?solo=1");
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = localUrl(`?room=${code}`);
    },
  });
  const back = el("a", "All games", "dockside-back");
  back.href = import.meta.env.BASE_URL;
  app.replaceChildren(header([back]), card.element);
}

function room(solo: boolean): void {
  const session = solo
    ? ({ kind: "solo" } as const)
    : sessionFor(location.search, store, GAME, validRoomCode, secret);
  if (session.kind === "invalid" || session.kind === "landing") {
    app.replaceChildren(
      header(),
      el("p", "Invalid room code", "dockside-error"),
    );
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO",
    role = session.kind === "room" ? session.role : "host",
    display = role === "display";
  document.body.classList.toggle("dockside-display", display);
  const viewer = {
    me: "",
    host: solo,
    solo,
    display,
    shared: false,
  };

  // ---- the page ----
  // The room's line is at the room's foot; during a match the same words are in the bar. `say` writes both, and
  // once the room is over nothing later replaces that.
  const status = createNotice({ className: "dockside-room-status" }),
    live = createNotice({ className: "dockside-status" });
  let over = false;
  const say = (text: string, tone: "info" | "error", last = false) => {
    if (over) return;
    over = last;
    status.show(text, tone);
    live.show(text, tone);
  };
  const menu = createGameMenu({
    controls: CONTROLS,
    touchControls: TOUCH_CONTROLS,
    goal: GOAL,
    onLobby: () => runtime.command({ type: "action", action: "lobby" }),
    onLeave: () => {
      runtime.stop();
      location.href = localUrl();
    },
    onOpenChange: (open) => {
      if (open) controls.release();
      if (!open && main.dataset.phase === "running")
        main.focus({ preventScroll: true });
    },
  });
  const roundControls = createRoundControls({
    controls: CONTROLS,
    touchControls: TOUCH_CONTROLS,
    goal: GOAL,
  });
  const top = header([live.element, menu.element]);

  // Lobby: invitation, roster with bot controls, name entry, start.
  const lobby = el("section", "", "dockside-lobby"),
    roster = createRoster({
      emptyText: "Nobody has joined yet",
      removeBot: {
        className: "dockside-remove",
        onRemove: (id) =>
          runtime.command({ type: "bot", action: "remove", id }),
      },
    }),
    addBot = button("+ ADD BOT", "dockside-add-bot"),
    start = button("START MATCH", "fui-button-primary dockside-start"),
    lobbyNote = el("p", "", "fui-lobby-note");
  // Shared TV is the room's choice, made in the room: the host turns it on here and opens the screen beside it.
  // The choice is remembered for the next room this device creates, once the room has taken it.
  const sharedTv = createSharedTvOption({
    className: "dockside-tv-option",
    onChange: (display) => {
      const sent = runtime.command({
        type: "settings",
        settings: { ...roomSettings, display },
      });
      if (sent) store.setItem(names.shared, display ? "1" : "0");
      return sent;
    },
    onOpenScreen: () =>
      window.open(localUrl(`?room=${code}&display=1`), "_blank", "noopener"),
  });
  const link = endpoints.appUrl(`?room=${code}`);
  if (!solo) {
    const invite = createInviteCard({
      code,
      link,
      qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
    });
    lobby.append(invite.element);
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
  lobby.append(roster.element);
  addBot.onclick = () =>
    runtime.command({
      type: "bot",
      action: "add",
      slot: requestedRoomSlot(addBot),
    });
  start.onclick = () => runtime.command({ type: "action", action: "start" });

  const table = el("section", "", "dockside-table"),
    stage = el("div", "", "dockside-stage"),
    hud = el("div", "", "dockside-hud"),
    identity = el("strong"),
    statusLine = el("span"),
    objective = el("span"),
    hint = el("p", "", "dockside-hint");
  hud.append(identity, statusLine, objective);
  hud.setAttribute("aria-label", "Pilot status");
  let playing = false;
  let controlsMatch = "";
  let farCamera = false;
  const controls = createControls(
    (bits) => runtime.input(bits),
    () => playing && !menu.isOpen(),
    () => {
      farCamera = !farCamera;
    },
  );
  const controllerMap = el("div", "", "dockside-controller-map");
  const controllerRadar = createRadar(controllerMap, COLORS);
  controllerMap.hidden = true;
  controls.pad.hidden = true;
  stage.append(controls.pad);
  table.append(hud, stage, controllerMap, roundControls.element, hint);
  const playScreen = createPlayScreen({
    stage: table,
    onChange: controls.release,
  });
  let arena: ReturnType<typeof createArena> | undefined;
  // The result of a match: the shared results screen over the page, on the TV and a phone controller too.
  const results = createResultsScreen({
    document,
    // The screen covers the page's own bar: whoever is not the host still has a way out of the room.
    onBack: () => {
      runtime.stop();
      location.href = localUrl();
    },
    backText: "Leave",
    onAction: (id) =>
      runtime.command({
        type: "action",
        action: id === "rematch" ? "rematch" : "lobby",
      }),
  });
  const liveResults = createLiveResults(results);

  const main = el("main", "", "dockside-room");
  main.tabIndex = -1;
  main.append(nameEntry.form, lobby, table, results.element);
  app.replaceChildren(top, main);
  /** This device's own seat in the lobby, as the last frame had it. */
  let ownSeat: { name: string; slot: number } | undefined;
  createRoomLayout({
    primaryAction: start,
    playerName: () => social.playerName(undefined) ?? undefined,
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    element: lobby,
    roster,
    capacity: 2,
    join: nameEntry.form,
    // Seated already: any open seat is a move.
    ownSlot: () => ownSeat?.slot,
    onMove: (slot) => {
      if (ownSeat) runtime.command({ type: "join", name: ownSeat.name, slot });
    },
    addAI: addBot,
    friends: social.friends,
    settings: [el("p", GOAL)],
    actions: [lobbyNote],
    actionsInHeader: true,
    status: status.element,
    ...(solo
      ? { compact: true, heading: "Solo practice" }
      : { heading: "Room", extras: [sharedTv.element] }),
  });
  table.hidden = true;
  nameEntry.form.hidden = true;

  // ---- the runtime ----
  const reportReceipts = createReceiptReporter({
    due: dueReports,
    gameId: GAME,
    display: role === "display",
    scope:
      session.kind === "room"
        ? { kind: "room", code, token: session.token }
        : { kind: "solo", signedIn: () => social.isSignedIn() },
    apiUrl: endpoints.apiUrl,
    fetch: social.reportFetch,
    playerId: () => viewer.me,
    confirmedTick: () => runtime.confirmedTick(),
  });
  const remembered = seatName(
    social.playerName(store.getItem(names.name)) ?? "",
  );
  let joinSent = false;
  const callbacks: DocksideCallbacks = {
    state(frame, settings) {
      observeConfirmedPlay(
        reportPlay,
        frame,
        () => runtime.confirmedFrame(),
        (frame) => ({
          matchId: frame.matchId,
          roundActive: frame.stage === "running",
          roundEnded: frame.stage === "over",
          active: frame.stage === "running",
          ended: frame.stage === "over",
          round: 1,
          playerCount: frame.seats.filter((s) => !s.watcher).length,
          botCount: frame.seats
            .filter((s) => !s.watcher)
            .filter((seat) => seat.bot).length,
          seated: frame.seats
            .filter((s) => !s.watcher)
            .some((seat) => seat.id === viewer.me),
          mode: solo ? "solo" : settings.display ? "shared" : "online",
        }),
      );
      viewer.host = !display && runtime.managing;
      const confirmed = runtime.confirmedFrame();
      reportReceipts(confirmed);
      const pendingResult =
        frame.stage === "over" && !decisionConfirmed(frame, confirmed);
      viewer.shared = settings.display;
      roomSettings = settings;
      const seats = frame.seats.filter((s) => !s.watcher),
        mine = seats.find((s) => s.id === viewer.me);
      const inLobby = frame.stage === "lobby",
        liveMatch = frame.stage === "running";
      ownSeat = inLobby ? mine : undefined;
      const askName = inLobby && !display && !mine;
      const touch = viewer.shared || matchMedia("(pointer: coarse)").matches;
      const slot = display
          ? -1
          : frame.roster.findIndex((p) => p.id === viewer.me),
        w = frame.world;
      if (
        playing &&
        (!(liveMatch && slot >= 0) || controlsMatch !== frame.matchId)
      )
        controls.resetMatch();
      playing = liveMatch && slot >= 0;
      playScreen.update(playing && !viewer.shared);
      controlsMatch = frame.matchId;
      menu.update({
        canLobby: viewer.host && !display && !inLobby && !pendingResult,
        display,
        touch,
        spectator: slot < 0,
      });
      roundControls.update({
        round: frame.matchId,
        visible: liveMatch && !!w && w.tick < 65,
        display,
        touch,
        spectator: slot < 0,
      });
      main.dataset.phase = frame.stage;
      lobby.hidden = !inLobby;
      table.hidden = !liveMatch;
      nameEntry.form.hidden = !askName;
      if (askName && remembered && !joinSent) {
        joinSent = true;
        runtime.command({
          type: "join",
          slot: requestedRoomSlot(nameEntry.form),
          name: remembered,
        });
      }
      if (mine) joinSent = false;
      roster.update(
        seats.map((s) => ({
          id: s.id,
          slot: s.slot,
          name: s.name,
          status: s.bot ? "AI" : s.connected ? "READY" : "AWAY",
          avatar: s.avatarId,
          removableBot: s.bot && viewer.host,
          host: s.id === frame.managerId,
          color: COLORS[s.slot]!,
        })),
      );
      start.hidden = !viewer.host || display;
      start.disabled = seats.length !== 2;
      addBot.hidden = !viewer.host || display || seats.length >= 2;
      lobbyNote.textContent =
        seats.length < 2
          ? "Invite a second pilot or add a practice pilot."
          : "";
      sharedTv.update(
        viewer.shared,
        viewer.host && !display && !solo && inLobby,
      );
      if (w && liveMatch) {
        controls.poll();
        const rig = w.rigs[slot],
          controller = viewer.shared && playing;
        stage.hidden = controller;
        controllerMap.hidden = !controller;
        const padHost = controller ? table : stage;
        if (controls.pad.parentElement !== padHost) {
          controls.release();
          padHost.append(controls.pad);
        }
        controls.pad.classList.toggle("controller-only", controller);
        const center = rig ? controls.map.frame(rig, w.tick) : undefined;
        const expandedMap = playing && controls.map.open;
        if (controller) controllerRadar.draw(w, slot, expandedMap, center);
        else {
          arena ??= createArena(stage);
          arena.draw(w, display ? -1 : slot, farCamera, expandedMap, center);
        }
        identity.textContent = rig
          ? slot === 0
            ? "WEST · YOU"
            : "EAST · YOU"
          : "CANAL LOCK";
        identity.style.color = COLORS[slot] ?? "";
        statusLine.textContent = rig
          ? rig.respawn
            ? `Repair ${Math.ceil(rig.respawn / 20)}s`
            : `${rig.travel ? "Travel" : "Walker"} · ${rig.hp}/5 HP`
          : "Gate race";
        objective.textContent = rig
          ? `${rig.credits} ${rig.credits === 1 ? "credit" : "credits"} · ${w.drones.filter((d) => d.team === slot).length}/2 convoys`
          : "First convoy through the enemy gate wins";
        const lane = rig ? laneAtFactory(rig, slot) : -1;
        hint.textContent = expandedMap
          ? "Directions pan · Action centers on your rig · Map returns to play"
          : rig
            ? lane >= 0
              ? `${lane === 0 ? "North" : "South"} pad · ${rig.credits >= COST ? "Launch ready" : "Drone costs 6 credits"}`
              : touch
                ? "Touch a turret to capture it."
                : "W/S drive · A/D turn · Q/E jink · J/K/L fire · R lock · F action"
            : "";
        controls.pad.hidden = !playing || !touch;
        runtime.flush();
      }
      const result =
        frame.stage === "over" && w
          ? {
              winners: frame.winners,
              w,
              host: viewer.host && !display,
              waiting: viewer.host ? "" : "Waiting for the host",
              rows: frame.roster,
            }
          : undefined;
      liveResults.render(result, {
        friends: social.friends,
        report: (
          { winners, rows: entrants, w: world },
          friend,
        ): ResultsReport => ({
          game: "DOCKSIDE",
          context: "Canal Lock",
          headline:
            winners.length === 2
              ? "Both convoys scored"
              : `${entrants.find((p) => p.id === winners[0])?.name ?? "Pilot"} wins`,
          standings: {
            columns: ["LAUNCHED", "INTERCEPTED", "CAPTURES"],
            rows: entrants
              .map((p) => ({
                id: p.id,
                name: p.name,
                placement: winners.includes(p.id) ? 1 : 2,
                color: COLORS[p.slot]!,
                you: p.id === viewer.me,
                tag: p.bot ? "AI" : undefined,
                friend:
                  p.bot || p.id === viewer.me ? undefined : friend?.(p.id),
                values: [
                  world.rigs[p.slot]!.launched,
                  world.rigs[p.slot]!.intercepted,
                  world.rigs[p.slot]!.captures,
                ].map(String),
              }))
              .sort((a, b) => a.placement - b.placement),
          },
          highlights: { cards: [] },
        }),
        bar: (): ResultsBar => ({
          actions:
            viewer.host && !display && !pendingResult
              ? [
                  { id: "lobby", label: "Back to lobby" },
                  { id: "rematch", label: "REMATCH", primary: true },
                ]
              : [],
          status: pendingResult
            ? "Confirming delivery…"
            : viewer.host
              ? ""
              : "Waiting for the host",
        }),
      });
    },
    event() {},
    status(text) {
      const shown = roomFailure(text);
      say(shown, shown === text ? "info" : "error");
    },
    ready(id) {
      viewer.me = id;
    },
    ended() {
      say("Room ended", "error", true);
      // A service that does not host this game closes the socket the same way: its game routes say which it was.
      void fetch(endpoints.apiUrl(`/api/games/${GAME}/leaderboard`))
        .then(async (response) => {
          const body = (await response.json()) as { error?: unknown };
          const text = roomFailure(String(body.error ?? ""));
          if (text === NOT_OPEN) {
            status.show(text, "error");
            live.show(text, "error");
          }
        })
        .catch(() => {
          /* offline: "Room ended" stands */
        });
    },
  };
  const shared =
    !solo && role === "host" && store.getItem(names.shared) === "1";
  /** The room's settings as the last frame had them: the Shared TV tick changes one of them and keeps the rest. */
  let roomSettings: DocksideSettings = { ...DEFAULT_SETTINGS, display: shared };
  const runtime = new DocksideRuntime(
    code,
    roomSettings,
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
      playScreen.destroy();
      controls.dispose();
      arena?.dispose();
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
