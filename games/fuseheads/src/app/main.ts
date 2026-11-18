import { createTopBar } from "fuse-ui";
import { playtestInputBlocked } from "fuse-ui/playtest-input";
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
import "./fuseheads.css";
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
  createControllerRow,
  createGameMenu,
  createInviteCard,
  createLandingCard,
  createRoomLayout,
  createNameEntry,
  createNotice,
  createResultsScreen,
  createRoster,
  createSharedTvOption,
  el,
} from "fuse-ui";
import {
  DEFAULT_SETTINGS,
  parseSave,
  fuseheadsGame,
  seatName,
  type FuseheadsSettings,
} from "../game/index.js";
import {
  createInputs,
  controls,
  coopControls,
  goal,
  padBindings,
  touchControls,
} from "./controls.js";
import { createSounds } from "./sound.js";
import { createArena } from "../art/renderer.js";
import { getLevel } from "../levels/index.js";
import { dueReports, sendReport } from "./reports.js";
import { resultReport } from "./result-report.js";
import { FuseheadsRuntime, type FuseheadsCallbacks } from "./runtime.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "./session.js";

const GAME = fuseheadsGame.id;
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
const COLORS = ["#9ad551", "#67c3ee"];
const app = document.querySelector<HTMLElement>("#app")!;
const query = new URLSearchParams(location.search);
const sound = createSounds(store, query.has("mute"), () => new Audio());
window.addEventListener("pagehide", () => sound.stop());
const saveKey = "fuseheads-ruler-save-v1";
function readSave() {
  try {
    return parseSave(JSON.parse(store.getItem(saveKey) ?? "null"));
  } catch {
    return undefined;
  }
}
const resume =
  query.get("solo") === "1" && query.has("continue") ? readSave() : undefined;
const localPair =
  query.get("solo") === "1" &&
  (resume ? resume.players.length === 2 : query.get("players") === "2");
const link = (params: Record<string, string> = {}) => {
  const search = new URLSearchParams(params);
  if (query.has("mute")) search.set("mute", "");
  return endpoints.appUrl(search.size ? "?" + search.toString() : "");
};
function packPicker() {
  const label = el("label", "Level pack ", "fuseheads-choice");
  const select = el("select");
  select.add(new Option("Original levels", "original"));
  select.add(new Option("Bonus levels", "bonus"));
  label.append(select);
  return { label, select };
}
function header(
  extra: HTMLElement[] = [],
  onOpenChange?: (open: boolean) => void,
): HTMLElement {
  const bar = el("header", "", "fuseheads-top"),
    brand = el("a", "", "fuseheads-brand");
  brand.href = link();
  brand.textContent = "FUSEHEADS";
  // Every game opens the app portal top left; it lists the games that have a portal.json.
  const portal = createAppPortal({
    document,
    current: GAME,
    base: import.meta.env.BASE_URL,
    search: location.search,
  });
  bar.append(portal.element, brand, social.element(), ...extra);
  return createTopBar({
    element: bar,
    gameId: GAME,
    onOpenChange,
    sound: sound.master,
  });
}

function landing(): void {
  const pack = packPicker();
  const players = el("select");
  players.add(new Option("One player", "1"));
  players.add(new Option("Two on one keyboard", "2"));
  const count = el("label", "Players ", "fuseheads-choice");
  count.append(players);
  const saved = readSave();
  const loadButton = button(
    saved ? "Continue · Level " + saved.nextLevel : "Continue",
  );
  loadButton.onclick = () => {
    location.href = link({ solo: "1", continue: "1" });
  };
  const card = createLandingCard({
    howToPlay: {
      goal,
      controls: localPair ? coopControls : controls,
      touchControls,
    },
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    title: "FUSEHEADS",
    tagline: "Bonk the platforms. Kick the pests. Save the underworld.",
    soloText: "START GAME",
    soloInBar: true,
    soloActions: saved ? [loadButton] : [],
    async onCreate() {
      const room = await createRoom(endpoints.apiUrl, fetch, GAME).catch(
        (error: unknown) => {
          throw new Error(
            roomFailure(error instanceof Error ? error.message : String(error)),
          );
        },
      );
      store.setItem(names.host(room.code), room.token);
      location.href = link({ room: room.code });
    },
    onSolo: () => {
      location.href = link({
        solo: "1",
        pack: pack.select.value,
        players: players.value,
      });
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = link({ room: code });
    },
  });
  card.soloDetails.append(count, pack.label);
  const back = el("a", "All games", "fuseheads-back");
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
      el("p", "Invalid room code", "fuseheads-error"),
    );
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO",
    role = session.kind === "room" ? session.role : "host",
    display = role === "display";
  document.body.classList.toggle("fuseheads-display", display);
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
  const status = createNotice({ className: "fuseheads-room-status" }),
    live = createNotice({ className: "fuseheads-status" }),
    pack = packPicker();
  let over = false;
  const say = (text: string, tone: "info" | "error", last = false) => {
    if (over) return;
    over = last;
    status.show(text, tone);
    live.show(text, tone);
  };
  const menu = createGameMenu({
    controls: localPair ? coopControls : controls,
    touchControls,
    goal,
    onLobby: () => runtime.command({ type: "action", action: "lobby" }),
    onLeave: () => {
      runtime.stop();
      location.href = link();
    },
    onOpenChange: (open) => {
      inputs.clear();
      if (!open && main.dataset.phase === "running")
        main.focus({ preventScroll: true });
    },
  });
  const top = header([live.element, menu.element], () => inputs.clear());

  // The shared room owns invitations, seats and the start action.
  const lobby = el("section", "", "fuseheads-lobby"),
    roster = createRoster({ emptyText: "Nobody has joined yet" }),
    start = button("START MATCH", "fui-button-primary fuseheads-start"),
    lobbyNote = el("p", "", "fui-lobby-note");
  // Shared TV is the room's choice, made in the room: the host turns it on here and opens the screen beside it.
  // The choice is remembered for the next room this device creates, once the room has taken it.
  pack.select.onchange = () =>
    runtime.command({
      type: "settings",
      settings: {
        ...roomSettings,
        pack: pack.select.value === "bonus" ? "bonus" : "original",
      },
    });
  const sharedTv = createSharedTvOption({
    className: "fuseheads-tv-option",
    onChange: (display) => {
      const sent = runtime.command({
        type: "settings",
        settings: { ...roomSettings, display },
      });
      if (sent) store.setItem(names.shared, display ? "1" : "0");
      return sent;
    },
    onOpenScreen: () =>
      window.open(link({ room: code, display: "1" }), "_blank", "noopener"),
  });
  const inviteLink = link({ room: code });
  if (!solo) {
    const invite = createInviteCard({
      code,
      link: inviteLink,
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
  start.onclick = () => runtime.command({ type: "action", action: "start" });

  const table = el("section", "", "fuseheads-play");
  const canvas = el("canvas", "", "fuseheads-arena");
  canvas.width = 640;
  canvas.height = 480;
  canvas.setAttribute("aria-label", "Fuseheads playfield");
  const arena = createArena(canvas);
  const roundLine = el("p", "", "fuseheads-round");
  const inputs = createInputs(localPair, (mask, slot) =>
    runtime.play(mask, localPair ? slot : undefined),
  );
  const pad = createControllerRow({
    buttons: padBindings.map(({ bit, label }) => ({
      label,
      onPress: () => inputs.touch(bit, true),
      onRelease: () => inputs.touch(bit, false),
    })),
    className: "fui-controller fuseheads-pad",
  });
  table.append(canvas, roundLine, pad.element);

  // The result of a match: the shared results screen over the page, on the TV and a phone controller too.
  const results = createResultsScreen({
    document,
    // The screen covers the page's own bar: whoever is not the host still has a way out of the room.
    onBack: () => {
      runtime.stop();
      location.href = link();
    },
    backText: "Leave",
    onAction: (id) =>
      runtime.command({
        type: "action",
        action: id === "rematch" ? "rematch" : "lobby",
      }),
  });
  /** What the results screen last showed: it is rebuilt only when the result itself changed. */
  let shownResult = "";
  let stopFinale: (() => void) | undefined;

  const main = el("main", "", "fuseheads-room");
  main.tabIndex = -1;
  main.dataset.local = String(solo);
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
    friends: social.friends,
    settings: [pack.label],
    actions: [lobbyNote],
    actionsInHeader: true,
    status: status.element,
    ...(solo
      ? { compact: true, heading: "Solo match" }
      : { heading: "Room", extras: [sharedTv.element] }),
  });
  table.hidden = true;
  nameEntry.form.hidden = true;

  // ---- the runtime ----
  const sent = new Set<string>();
  const remembered = seatName(
    social.playerName(store.getItem(names.name)) ?? "",
  );
  let joinSent = false;
  let canControl = false;
  let lastSave = "";
  let inputScope = "";
  const callbacks: FuseheadsCallbacks = {
    state(frame, settings) {
      observeConfirmedPlay(
        reportPlay,
        frame,
        () => runtime.confirmedFrame(),
        (frame) => ({
          matchId: frame.matchId,
          roundActive: frame.phase === "running",
          roundEnded: frame.phase === "between" || frame.phase === "over",
          active: frame.phase === "running",
          ended: frame.phase === "over",
          round: resume ? frame.round - resume.nextLevel + 1 : frame.round,
          roundKey: frame.round,
          playerCount: frame.players.filter(
            (seat) => seat.participating && seat.connected,
          ).length,
          botCount: frame.players.filter((seat) => seat.bot).length,
          seated: frame.players.some(
            (seat) =>
              seat.id === viewer.me &&
              seat.connected &&
              (frame.phase === "lobby" || seat.participating),
          ),
          mode: solo ? "solo" : settings.display ? "shared" : "online",
        }),
      );
      viewer.shared = settings.display;
      roomSettings = settings;
      const lobbyOpen = frame.phase === "lobby";
      const seat = frame.players.find((player) => player.id === viewer.me);
      const seated = Boolean(seat) && !display;
      const askName = lobbyOpen && !display && !seated;
      ownSeat = lobbyOpen ? seat : undefined;
      const state = runtime.roomState();
      const scope = frame.matchId + ":" + frame.round;
      canControl =
        seated &&
        Boolean(seat?.participating && seat.connected) &&
        frame.phase === "running";
      if (inputScope !== scope || !canControl) inputs.clear();
      inputScope = scope;
      const controller = viewer.shared && seated;
      menu.update({
        canLobby: viewer.host && !display && !lobbyOpen,
        display,
        touch: controller || window.matchMedia("(pointer: coarse)").matches,
        spectator: !seated,
      });
      main.dataset.phase = frame.phase;
      main.dataset.round = String(frame.round);
      main.dataset.controller = String(controller);
      table.hidden = lobbyOpen || frame.phase === "over";
      lobby.hidden = !lobbyOpen;
      nameEntry.form.hidden = !askName;
      if (lobbyOpen) {
        roster.update(
          frame.players.map((p) => ({
            id: p.id,
            slot: p.slot,
            name: p.name,
            avatar: p.avatarId,
            host: p.id === frame.managerId,
            status: p.connected ? "Ready" : "Away",
            color: COLORS[p.slot]!,
          })),
        );
        start.hidden = !viewer.host || display;
        start.disabled = !frame.players.some((p) => p.connected);
        lobbyNote.textContent = viewer.host ? "" : "Waiting for the host";
        pack.select.disabled = !viewer.host || display;
        pack.select.value = settings.pack;
        sharedTv.update(viewer.shared, viewer.host && !display && !solo);
      }
      if (solo && frame.phase === "between") {
        const saved = runtime.savePoint();
        if (saved) {
          const encoded = JSON.stringify(saved);
          if (encoded !== lastSave) {
            store.setItem(saveKey, encoded);
            lastSave = encoded;
          }
        }
      }
      if (frame.world && !document.hidden)
        sound.observe(frame.matchId, frame.world);
      if (frame.world && !table.hidden) {
        const level = getLevel(frame.round, frame.world.pack);
        const label = level.name + " · " + level.stage;
        if (!controller) arena.draw(frame.world);
        canvas.hidden = controller;
        const actor = frame.world.players.find((p) => p.slot === seat?.slot);
        roundLine.textContent =
          frame.phase === "between"
            ? label + " cleared!"
            : controller && actor
              ? seat?.name +
                " · " +
                actor.score +
                " pts · " +
                actor.lives +
                " lives"
              : label;
        pad.element.hidden = !canControl;
      }
      if (frame.phase === "over") {
        const report = resultReport(frame, viewer.me);
        const key = JSON.stringify(report);
        if (key !== shownResult) {
          stopFinale?.();
          const finale =
            frame.world?.pack === "original" && frame.outcome === "cleared"
              ? el("div")
              : undefined;
          if (finale)
            report.sections = [{ title: "Grand finale", content: [finale] }];
          results.show(report);
          shownResult = key;
          if (finale)
            void import("../art/finale.js").then(({ createFinale }) => {
              if (finale.isConnected) stopFinale = createFinale(finale);
            });
        }
        results.update({
          actions:
            viewer.host && !display
              ? [
                  { id: "lobby", label: "Lobby" },
                  { id: "rematch", label: "Play again", primary: true },
                ]
              : [],
        });
      } else if (results.open) {
        stopFinale?.();
        stopFinale = undefined;
        results.hide();
        shownResult = "";
      }
      if (askName && remembered && !joinSent) {
        joinSent = true;
        runtime.command({
          type: "join",
          slot: requestedRoomSlot(nameEntry.form),
          name: remembered,
        });
      }
      if (seated) joinSent = false;
      if (
        role !== "display" &&
        !localPair &&
        state &&
        (session.kind === "room" || social.isSignedIn())
      )
        for (const report of dueReports(
          state,
          viewer.me,
          runtime.confirmedTick(),
          sent,
        )) {
          sent.add(report.key);
          void sendReport(
            endpoints.apiUrl(
              `/api/games/${GAME}/${session.kind === "room" ? `rooms/${code}` : "me"}/${report.path}`,
            ),
            report,
            {
              fetch: social.reportFetch,
              ...(session.kind === "room" ? { roomToken: session.token } : {}),
            },
          );
        }
    },
    event() {
      // A rollback can correct the frame after the first presentation.
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
  let roomSettings: FuseheadsSettings = {
    ...DEFAULT_SETTINGS,
    display: shared,
    pack:
      resume?.pack ?? (query.get("pack") === "bonus" ? "bonus" : "original"),
  };
  const runtime = new FuseheadsRuntime(
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
          ...(resume ? { resume } : {}),
          ...(localPair
            ? {
                localPlayers: [
                  social.playerName(store.getItem(names.name)) || "Player 1",
                  "Player 2",
                ],
              }
            : {}),
          humanName: social.playerName(store.getItem(names.name)) ?? undefined,
        },
  );
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => {
      stopFinale?.();
      menu.dispose();
    },
    reload: () => location.reload(),
  });
  function key(event: KeyboardEvent) {
    const down = event.type === "keydown";
    if (
      !canControl ||
      (down &&
        (menu.isOpen() ||
          playtestInputBlocked(document) ||
          document.querySelector("dialog[open]") ||
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement))
    )
      return;
    if (inputs.key(event.code, down)) event.preventDefault();
  }
  document.addEventListener("keydown", key);
  document.addEventListener("keyup", key);
  window.addEventListener("blur", inputs.clear);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) inputs.clear();
  });
  runtime.start();
}

if (query.get("solo") === "1") room(true);
else if (query.has("room")) room(false);
else landing();
