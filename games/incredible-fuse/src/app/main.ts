import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "fuse-ui/results.css";
import "fuse-ui/social.css";
import "./incredibleFuse.css";
import QRCode from "qrcode";
import { MAX_PACKET_BYTES, uuid } from "fuse-netcode";
import {
  PeerTransport,
  createEndpoints,
  createRoom,
  installRoomLifecycle,
  validRoomCode,
} from "fuse-network-fe";
import {
  button,
  createAppPortal,
  createBackLink,
  createGameMenu,
  createInviteCard,
  createLandingCard,
  createNameEntry,
  createNotice,
  createResultsScreen,
  createRoomLayout,
  createRoster,
  createSharedTvOption,
  createTopBar,
  el,
  requestedRoomSlot,
} from "fuse-ui";
import { gamePagePath } from "fuse-ui/game-path";
import {
  createPlayMetrics,
  observeConfirmedPlay,
  startGameAnalytics,
} from "fuse-ui/play-metrics";
import { createGameSocial } from "fuse-ui/social";
import {
  CAPACITY,
  DEFAULT_SETTINGS,
  incredibleFuseGame,
  matchResult,
  seatName,
} from "../game/index.js";
import { FREE_WORKSHOP, getPuzzle, PUZZLES } from "../game/machine.js";
import { createAttract } from "./attract.js";
import { createBench } from "./bench.js";
import {
  downloadWorkshop,
  localWorkshopPicker,
  readLocalWorkshop,
} from "./local-workshop.js";
import { dueReports, sendReport } from "./reports.js";
import {
  IncredibleFuseRuntime,
  type IncredibleFuseCallbacks,
} from "./runtime.js";
import { keys, roomFailure, safeStore, sessionFor } from "./session.js";

const GAME = incredibleFuseGame.id;
const TITLE = "The Incredible Fuse";
const analytics = startGameAnalytics(GAME);
const observePlay = createPlayMetrics(analytics.track, () => performance.now());
const endpoints = createEndpoints(
  {
    basePath: import.meta.env.BASE_URL + gamePagePath(GAME),
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
const app = document.querySelector<HTMLElement>("#app")!;
const query = new URLSearchParams(location.search);
const colors = ["#5bd7d1", "#ffb365", "#add876", "#ef88aa", "#b59ce3"];
const roleColor = (slot: number) => colors[slot % colors.length]!;
const help = {
  goal: "Arrange the spare parts so the running machine reaches the puzzle’s goal. In a room, everyone works on the same machine. Rewind a run to keep editing.",
  controls: [
    {
      keys: "Click / drag",
      action:
        "Choose a spare part and place it on the bench. Select a placed part to move it.",
    },
    {
      keys: "Arrows / Enter",
      action:
        "On the board, move the cursor and place or select a part. Hold Shift for fine adjustments.",
    },
    {
      keys: "R / F / Delete",
      action: "Rotate, flip or remove the selected part.",
    },
    {
      keys: "Attach wire / belt / rope",
      action:
        "Select one part, choose an attachment, then select the other part. Select a connected part to detach the link.",
    },
    { keys: "Cmd/Ctrl + Z", action: "Undo the most recent edit." },
    {
      keys: "Space",
      action: "Run or rewind the machine while the board is focused.",
    },
  ],
  touchControls: [
    { keys: "Tap", action: "Pick a spare part and tap the board to place it." },
    {
      keys: "Drag",
      action: "Move a placed part, or select it and tap its destination.",
    },
    {
      keys: "Rotate / Flip / Remove / Undo",
      action: "Change the selected part or undo an edit.",
    },
    {
      keys: "Attach wire / belt / rope",
      action: "Tap a part, choose its attachment, then tap the other part.",
    },
    {
      keys: "Run machine / Rewind",
      action: "Test your machine and return to the workbench.",
    },
  ],
};

function pageUrl(params: Record<string, string> = {}) {
  const next = new URLSearchParams(params);
  if (query.has("mute")) next.set("mute", "");
  return endpoints.appUrl(next.size ? "?" + next.toString() : "");
}

function header(extra: HTMLElement[] = []) {
  const bar = el("header", "", "machine-header");
  const brand = el("a", TITLE, "machine-brand");
  brand.href = pageUrl();
  const portal = createAppPortal({
    document,
    current: GAME,
    base: import.meta.env.BASE_URL,
    search: location.search,
  });
  bar.append(portal.element, brand, social.element(), ...extra);
  return createTopBar({ element: bar, gameId: GAME });
}

function puzzleChoice(initial: number) {
  const label = el("label", "Puzzle", "machine-puzzle-choice");
  const select = el("select");
  select.setAttribute("aria-label", "Puzzle");
  const goal = el("small");
  [...PUZZLES, getPuzzle(FREE_WORKSHOP)].forEach((puzzle, index) => {
    const option = el(
      "option",
      index === FREE_WORKSHOP ? puzzle.title : index + 1 + ". " + puzzle.title,
    );
    option.value = String(index);
    select.append(option);
  });
  function update(index: number) {
    select.value = String(index);
    goal.textContent = getPuzzle(index).goal;
  }
  select.addEventListener("change", () => update(select.selectedIndex));
  update(initial);
  label.append(select, goal);
  return { element: label, select, update };
}

function landing() {
  const choice = puzzleChoice(0);
  const card = createLandingCard({
    title: TITLE,
    tagline:
      "One goal. A bench full of spare parts. Build the chain reaction that makes it work.",
    howToPlay: help,
    background: createAttract,
    async onCreate() {
      const room = await createRoom(endpoints.apiUrl, fetch, GAME).catch(
        (error: unknown) => {
          throw new Error(
            roomFailure(error instanceof Error ? error.message : String(error)),
          );
        },
      );
      store.setItem(names.host(room.code), room.token);
      location.href = pageUrl({ room: room.code });
    },
    soloText: "Start puzzle",
    soloInBar: true,
    onSolo: () => {
      location.href = pageUrl({ solo: "1", puzzle: choice.select.value });
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = pageUrl({ room: code });
    },
  });
  card.soloDetails.append(
    choice.element,
    localWorkshopPicker({
      onOpen: () => {
        location.href = pageUrl({
          solo: "1",
          puzzle: String(FREE_WORKSHOP),
          local: "1",
        });
      },
    }),
  );
  choice.select.addEventListener("change", () => {
    if (card.solo)
      card.solo.textContent =
        choice.select.selectedIndex === FREE_WORKSHOP
          ? "Open workshop"
          : "Start puzzle";
  });
  app.replaceChildren(header(), card.element);
}

function workshop() {
  const session = sessionFor(
    location.search,
    store,
    GAME,
    validRoomCode,
    () => uuid().replaceAll("-", "") + uuid().replaceAll("-", ""),
  );
  if (session.kind === "invalid") {
    app.replaceChildren(
      header(),
      el("p", "Invalid room code"),
      createBackLink({ href: pageUrl() }),
    );
    return;
  }
  if (session.kind === "landing") return landing();
  const solo = session.kind === "solo";
  const display = session.kind === "room" && session.role === "display";
  const code = session.kind === "room" ? session.code : "SOLO";
  const initialPuzzle = Number(query.get("puzzle"));
  let settings = {
    ...DEFAULT_SETTINGS,
    display:
      session.kind === "room" &&
      session.role === "host" &&
      store.getItem(names.shared) === "1",
    puzzleIndex:
      solo &&
      Number.isInteger(initialPuzzle) &&
      initialPuzzle >= 0 &&
      initialPuzzle <= FREE_WORKSHOP
        ? initialPuzzle
        : 0,
  };
  const openingFile =
    solo &&
    settings.puzzleIndex === FREE_WORKSHOP &&
    query.get("local") === "1";
  const blueprint = openingFile ? readLocalWorkshop() : undefined;
  if (openingFile && !blueprint) {
    app.replaceChildren(
      header(),
      el(
        "p",
        "This tab has no saved machine. Open the file again from Single player.",
      ),
      createBackLink({ href: pageUrl() }),
    );
    return;
  }
  let me = "";
  let ownSeat: { slot: number; name: string } | undefined;
  const live = createNotice({ className: "machine-live" });
  const status = createNotice();
  const leave = () => {
    runtime.stop();
    location.href = pageUrl();
  };
  const menu = createGameMenu({
    ...help,
    onLobby: () => runtime.command({ type: "action", action: "lobby" }),
    onLeave: leave,
  });
  const main = el("main", "", "machine-room");
  const lobby = el("section", "", "machine-lobby");
  const stage = el("section", "", "machine-stage");
  stage.hidden = true;
  const bench = createBench({
    onCommand: (command) => runtime.play(command),
  });
  stage.append(bench.element);
  const save = button("Save machine", "fui-button");
  save.hidden = true;
  save.onclick = () => {
    const machine = runtime.roomState()?.machine;
    if (solo && machine?.puzzle === FREE_WORKSHOP) downloadWorkshop(machine);
  };
  if (solo) stage.append(save);
  const completion = el("dialog", "", "machine-completion");
  completion.setAttribute("aria-label", "Puzzle complete");
  const inspectResult = button("Puzzle complete · View result", "fui-button");
  inspectResult.hidden = true;
  inspectResult.onclick = () => completion.showModal();
  stage.append(inspectResult);
  const results = createResultsScreen({
    document,
    onBack: () => completion.close(),
    backText: "View machine",
    onAction: (id) => {
      if (id === "next") {
        location.href = pageUrl({
          solo: "1",
          puzzle: String(settings.puzzleIndex + 1),
        });
        return;
      }
      runtime.command({
        type: "action",
        action: id === "replay" ? "rematch" : "lobby",
      });
    },
  });
  results.element.removeAttribute("role");
  completion.append(results.element);
  completion.addEventListener("close", () => {
    if (!inspectResult.hidden) inspectResult.focus();
  });
  const controlled = () => !display && runtime.managing;
  const roster = createRoster({ emptyText: "Waiting for builders" });
  const choice = puzzleChoice(settings.puzzleIndex);
  choice.select.onchange = () => {
    if (
      !runtime.command({
        type: "settings",
        settings: { ...settings, puzzleIndex: choice.select.selectedIndex },
      })
    )
      choice.update(settings.puzzleIndex);
  };
  const start = button("Start puzzle", "fui-button-primary");
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  const name = createNameEntry({
    normalize: (raw) => seatName(raw) ?? "",
    initial: social.playerName(store.getItem(names.name)) ?? "",
    onInput: (value) => store.setItem(names.name, value),
    onSubmit: (value) => {
      store.setItem(names.name, value);
      runtime.command({
        type: "join",
        name: value,
        slot: requestedRoomSlot(name.form),
      });
    },
  });
  name.form.hidden = true;
  const shared = createSharedTvOption({
    onChange: (display) => {
      const sent = runtime.command({
        type: "settings",
        settings: { ...settings, display },
      });
      if (sent) store.setItem(names.shared, display ? "1" : "0");
      return sent;
    },
    onOpenScreen: () =>
      window.open(pageUrl({ room: code, display: "1" }), "_blank", "noopener"),
  });
  const invite = solo
    ? undefined
    : createInviteCard({
        code,
        link: endpoints.appUrl("?room=" + code),
        qr: (text) => QRCode.toDataURL(text, { width: 360, margin: 1 }),
      });
  if (!solo) stage.prepend(live.element);
  main.append(name.form, lobby, stage, completion);
  app.replaceChildren(header([menu.element]), main);
  const layout = createRoomLayout({
    element: lobby,
    roster,
    capacity: CAPACITY,
    compact: solo,
    join: name.form,
    friends: social.friends,
    background: createAttract,
    mainMenuHref: pageUrl(),
    heading: solo ? "Solo workshop" : "Workshop room",
    ownSlot: () => ownSeat?.slot,
    onMove: (slot) => {
      if (ownSeat) runtime.command({ type: "join", slot, name: ownSeat.name });
    },
    playerName: () => social.playerName(store.getItem(names.name)) ?? undefined,
    primaryAction: start,
    actionsInHeader: true,
    invite: invite?.element,
    extras: solo ? [] : [shared.element],
    layout: "configuration",
    configuration: [choice.element],
    status: status.element,
  });
  const sent = new Set<string>();
  let resultKey = "";
  let celebrationTimer: number | undefined;
  const callbacks: IncredibleFuseCallbacks = {
    ready(id) {
      me = id;
    },
    state(frame, nextSettings) {
      const waiting = frame.phase === "lobby";
      const playing = frame.phase === "running";
      const canManage = controlled();
      settings = nextSettings;
      const mine = frame.players.find((player) => player.id === me);
      ownSeat = waiting ? mine : undefined;
      observeConfirmedPlay(
        observePlay,
        frame,
        () => runtime.confirmedFrame(),
        (view) => {
          const seated =
            !display && view.players.some((player) => player.id === me);
          return {
            matchId: view.matchId,
            round: view.round,
            roundActive: seated && view.phase === "running",
            roundEnded: seated && view.phase === "over",
            active: seated && view.phase === "running",
            ended: seated && view.phase === "over",
            playerCount: view.players.length,
            botCount: 0,
            seated,
            mode: solo ? "solo" : nextSettings.display ? "shared" : "online",
          };
        },
      );
      main.dataset.phase = frame.phase;
      if (lobby.hidden === waiting) lobby.hidden = !waiting;
      stage.hidden = waiting;
      save.hidden = !playing || frame.machine.puzzle !== FREE_WORKSHOP;
      const needsSeat =
        Boolean(me) &&
        !display &&
        !mine &&
        (waiting ||
          (playing &&
            frame.players.length < CAPACITY &&
            !frame.watchers.some((watcher) => watcher.id === me)));
      if (name.form.hidden === needsSeat) name.form.hidden = !needsSeat;
      start.hidden = !canManage;
      start.disabled = !waiting || !frame.players.some((p) => p.connected);
      const action =
        settings.puzzleIndex === FREE_WORKSHOP
          ? "Open workshop"
          : "Start puzzle";
      if (start.textContent !== action) start.textContent = action;
      shared.update(settings.display, canManage && !solo && waiting);
      choice.select.disabled = !canManage;
      if (choice.select.value !== String(settings.puzzleIndex))
        choice.update(settings.puzzleIndex);
      menu.update({
        canLobby: canManage && !waiting,
        display,
        spectator: !mine,
        touch: window.matchMedia("(pointer:coarse)").matches,
      });
      if (waiting)
        roster.update(
          frame.players.map((p) => ({
            id: p.id,
            slot: p.slot,
            name: p.name,
            avatar: p.avatarId,
            host: p.id === frame.managerId,
            ready: p.connected,
            status: p.connected ? "Ready" : "Offline",
            color: roleColor(p.slot),
          })),
        );
      if (!waiting)
        bench.update(frame.machine, !display && Boolean(mine?.connected));
      bench.element.inert = frame.phase === "over";
      if (frame.phase === "over") {
        const state = runtime.roomState();
        const result = state && matchResult(state);
        const key = JSON.stringify([frame.matchId, result?.players]);
        if (key !== resultKey) {
          if (!resultKey) {
            celebrationTimer = window.setTimeout(() => {
              inspectResult.hidden = false;
              completion.showModal();
            }, 1400);
          }
          resultKey = key;
          const puzzle = getPuzzle(frame.machine.puzzle);
          results.show({
            game: TITLE,
            kicker: "Puzzle complete",
            headline: puzzle.title,
            summary: puzzle.goal,
            accent: "#70ddd3",
            emblem: "✓",
            standings: solo
              ? undefined
              : {
                  title: "Workshop crew",
                  nameLabel: "Builder",
                  columns: [],
                  rows: (result?.players ?? []).map((p) => ({
                    id: p.playerId,
                    placement: p.matchPlacement,
                    name: p.name,
                    color: roleColor(p.slot),
                    you: p.playerId === me,
                    values: [],
                  })),
                },
          });
        }
        results.update({
          actions: canManage
            ? [
                { id: "lobby", label: "Choose puzzle" },
                {
                  id: "replay",
                  label: "Replay",
                  primary: !solo || settings.puzzleIndex + 1 >= PUZZLES.length,
                },
                ...(solo && settings.puzzleIndex + 1 < PUZZLES.length
                  ? [{ id: "next", label: "Next puzzle", primary: true }]
                  : []),
              ]
            : [],
          status: canManage ? "" : "Waiting for the host",
        });
      } else if (results.open) {
        window.clearTimeout(celebrationTimer);
        inspectResult.hidden = true;
        completion.close();
        results.hide();
        resultKey = "";
      }
      const state = runtime.roomState();
      if (
        state &&
        !display &&
        (session.kind === "room" || social.isSignedIn())
      ) {
        for (const report of dueReports(
          state,
          me,
          runtime.confirmedTick(),
          sent,
        )) {
          sent.add(report.key);
          const route = session.kind === "room" ? "rooms/" + code : "me";
          void sendReport(
            endpoints.apiUrl(
              "/api/games/" + GAME + "/" + route + "/" + report.path,
            ),
            report,
            {
              fetch: social.reportFetch,
              ...(session.kind === "room" ? { roomToken: session.token } : {}),
            },
          );
        }
      }
    },
    status(message) {
      const text = roomFailure(message);
      const tone = text === message ? "info" : "error";
      status.show(text, tone);
      live.show(text, tone);
    },
    event() {},
    ended() {
      live.show("Room ended", "error");
      status.show("Room ended", "error");
    },
  };
  const runtime = new IncredibleFuseRuntime(
    code,
    settings,
    callbacks,
    session.kind === "room"
      ? {
          displayOnly: display,
          transport: (events) =>
            social.transport(
              code,
              session.token,
              events,
              (handlers) =>
                new PeerTransport(code, session.token, handlers, {
                  apiUrl: endpoints.apiUrl,
                  gameId: GAME,
                  maxFastBytes: MAX_PACKET_BYTES,
                }),
            ),
        }
      : {
          humanName: social.playerName(store.getItem(names.name)) ?? undefined,
        },
    blueprint,
  );
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => {
      window.clearTimeout(celebrationTimer);
      menu.dispose();
      bench.dispose();
      layout.dispose();
    },
    reload: () => location.reload(),
  });
  runtime.start();
}

if (query.has("room") || query.get("solo") === "1") workshop();
else landing();
