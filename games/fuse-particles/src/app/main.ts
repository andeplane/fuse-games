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
import "./fuseParticles.css";
import { createBattle, MAPS, type MapId } from "../game/simulation.js";
import { createArena, TEAM_COLORS } from "./arena.js";
import { createBattleCharts } from "./charts.js";
import { createCommands } from "./commands.js";
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
  createResultsScreen,
  createRoster,
  createSharedTvOption,
  el,
} from "fuse-ui";
import {
  CAPACITY,
  DEFAULT_SETTINGS,
  fuseParticlesGame,
  seatName,
  type FuseParticlesSettings,
} from "../game/index.js";
import { dueReports, sendReport } from "./reports.js";
import {
  FuseParticlesRuntime,
  type FuseParticlesCallbacks,
} from "./runtime.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "./session.js";

const GAME = fuseParticlesGame.id;
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
function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "fuseParticles-top"),
    brand = el("a", "", "fuseParticles-brand");
  brand.href = endpoints.appUrl();
  brand.append(el("span", "FUSEPARTICLES"));
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
    title: "FUSEPARTICLES",
    tagline:
      "Upgrade your swarm, capture territory and outlast every rival core.",
    soloText: "PLAY SOLO VS BOTS",
    async onCreate() {
      const room = await createRoom(endpoints.apiUrl, fetch, GAME).catch(
        (error: unknown) => {
          throw new Error(
            roomFailure(error instanceof Error ? error.message : String(error)),
          );
        },
      );
      store.setItem(names.host(room.code), room.token);
      location.href = endpoints.appUrl(`?room=${room.code}`);
    },
    onSolo: () => {
      location.href = endpoints.appUrl("?solo=1");
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = endpoints.appUrl(`?room=${code}`);
    },
  });
  const back = el("a", "All games", "fuseParticles-back");
  back.href = import.meta.env.BASE_URL;
  app.replaceChildren(header([back]), card.element);
}

const GOAL =
  "Particles spawn automatically. Earn gold from kills and territory, then spend it on upgrades and towers. The last core standing wins.";
const CONTROLS = [
  {
    keys: "Q / W / E / A / S",
    action: "Open Build, Research, Upgrades, Abilities or Towers",
  },
  { keys: "1–8", action: "Use a numbered command in the open panel" },
  {
    keys: "Click",
    action: "Select a tower site on the map or in the site picker",
  },
];
const TOUCH_CONTROLS = [
  { keys: "Tap a category", action: "Open its commands" },
  { keys: "Tap a site", action: "Choose where to build or upgrade a tower" },
];

function room(solo: boolean) {
  const session = sessionFor(
    location.search,
    store,
    GAME,
    validRoomCode,
    secret,
  );
  if (session.kind === "invalid" || session.kind === "landing") {
    app.replaceChildren(header(), el("p", "Invalid room code"));
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO";
  const display = session.kind === "room" && session.role === "display";
  let me = "",
    host = solo;
  let settings: FuseParticlesSettings = {
    ...DEFAULT_SETTINGS,
    display:
      session.kind === "room" &&
      session.role === "host" &&
      store.getItem(names.shared) === "1",
  };
  let ownSeat: { slot: number; name: string } | undefined;
  let lastFrame: Parameters<FuseParticlesCallbacks["state"]>[0] | undefined;
  let resultKey = "",
    mapKey = "";
  const sent = new Set<string>();
  const leave = () => {
    runtime.stop();
    location.href = endpoints.appUrl();
  };
  const status = createNotice({ className: "fuseParticles-room-status" });
  const live = createNotice({ className: "fuseParticles-status" });
  const menu = createGameMenu({
    controls: CONTROLS,
    touchControls: TOUCH_CONTROLS,
    goal: GOAL,
    onLobby: () => runtime.command({ type: "action", action: "lobby" }),
    onLeave: leave,
  });
  const lobby = el("section", "", "fuseParticles-lobby");
  const roster = createRoster({ emptyText: "Nobody has joined yet" });
  const addBot = button("Add AI", "fuseParticles-add-bot");
  addBot.onclick = () =>
    runtime.command({
      type: "bot",
      action: "add",
      slot: requestedRoomSlot(addBot),
    });
  const start = button("Start match", "fui-button-primary fuseParticles-start");
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  const nameEntry = createNameEntry({
    normalize: (raw) => seatName(raw) ?? "",
    initial: social.playerName(store.getItem(names.name)) ?? "",
    onInput: (value) => store.setItem(names.name, value),
    onSubmit: (name) => {
      store.setItem(names.name, name);
      runtime.command({
        type: "join",
        name,
        slot: requestedRoomSlot(nameEntry.form),
      });
    },
    buttonText: "Join",
  });
  const sharedTv = createSharedTvOption({
    onChange: (display) => {
      const accepted = runtime.command({
        type: "settings",
        settings: { ...settings, display },
      });
      if (accepted) store.setItem(names.shared, display ? "1" : "0");
      return accepted;
    },
    onOpenScreen: () =>
      window.open(
        endpoints.appUrl(`?room=${code}&display=1`),
        "_blank",
        "noopener",
      ),
  });
  const invite = solo
    ? undefined
    : createInviteCard({
        code,
        link: endpoints.appUrl(`?room=${code}`),
        qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
      });
  const mapLabel = el("label", "Map ", "fp-map-label");
  const mapChoice = el("select", "", "fui-button");
  for (const map of MAPS) {
    const option = el("option", map[0]!.toUpperCase() + map.slice(1));
    option.value = map;
    mapChoice.append(option);
  }
  mapLabel.append(mapChoice);
  mapChoice.onchange = () =>
    runtime.command({
      type: "settings",
      settings: { ...settings, map: mapChoice.value as MapId },
    });
  const regenerate = button("Regenerate");
  regenerate.onclick = () =>
    runtime.command({
      type: "settings",
      settings: { ...settings, seed: (settings.seed + 1) >>> 0 },
    });
  const mapTools = el("div", "", "fp-map-tools");
  mapTools.append(mapLabel, regenerate);
  const mapPreview = createArena();
  const lobbyNote = el(
    "p",
    "Add AI or invite a friend to start.",
    "fui-lobby-note",
  );
  const main = el("main", "", "fuseParticles-room");
  main.append(nameEntry.form, lobby);
  nameEntry.form.hidden = solo || display;
  createRoomLayout({
    element: lobby,
    roster,
    capacity: CAPACITY,
    join: nameEntry.form,
    addAI: addBot,
    ...(invite ? { invite: invite.element } : {}),
    primaryAction: start,
    heading: solo ? "Solo match" : "Room",
    layout: "configuration",
    compact: solo,
    configuration: [mapTools, mapPreview.element, lobbyNote],
    actionsInHeader: true,
    mainMenuHref: endpoints.appUrl(),
    playerName: () => social.playerName(undefined) ?? undefined,
    ownSlot: () => ownSeat?.slot,
    onMove: (slot) => {
      if (ownSeat) runtime.command({ type: "join", name: ownSeat.name, slot });
    },
    slotColor: (slot) => TEAM_COLORS[slot]!,
    friends: social.friends,
    status: status.element,
    ...(solo ? {} : { extras: [sharedTv.element] }),
  });
  const battleSection = el("section", "", "fp-match");
  const arena = createArena();
  const commands = createCommands(
    (action) => runtime.play(action),
    arena.canvas,
  );
  battleSection.append(arena.element, commands.element);
  const results = createResultsScreen({
    document,
    onBack: leave,
    backText: "Leave",
    onAction: (id) =>
      runtime.command({
        type: "action",
        action: id === "rematch" ? "rematch" : "lobby",
      }),
  });
  main.append(battleSection, results.element);
  battleSection.hidden = true;
  app.replaceChildren(header([live.element, menu.element]), main);
  const callbacks: FuseParticlesCallbacks = {
    ready(id, manager) {
      me = id;
      host = manager;
    },
    status(text) {
      const shown = roomFailure(text);
      status.show(shown, shown === text ? "info" : "error");
      live.show(shown, shown === text ? "info" : "error");
    },
    ended() {
      status.show("Room ended", "error");
      live.show("Room ended", "error");
    },
    event() {},
    state(frame, roomSettings) {
      lastFrame = frame;
      settings = roomSettings;
      const isHost = host || frame.managerId === me;
      const inLobby = frame.phase === "lobby";
      const state = runtime.roomState();
      const confirmedTick = runtime.confirmedTick();
      const resultConfirmed =
        state?.stage === "over" && state.decidedTick <= confirmedTick;
      const fighter = frame.fighters.findIndex((seat) => seat.id === me);
      ownSeat = frame.players.find((seat) => seat.id === me);
      nameEntry.form.hidden = !inLobby || display || Boolean(ownSeat);
      observeConfirmedPlay(
        reportPlay,
        frame,
        () => runtime.confirmedFrame(),
        (confirmed) => ({
          matchId: confirmed.matchId,
          round: confirmed.round,
          roundActive: confirmed.phase === "running",
          roundEnded: confirmed.phase === "over",
          active: confirmed.phase === "running",
          ended: confirmed.phase === "over",
          seated: confirmed.players.some((seat) => seat.id === me) && !display,
          playerCount: confirmed.fighters.length || confirmed.players.length,
          botCount: (confirmed.fighters.length
            ? confirmed.fighters
            : confirmed.players
          ).filter((seat) => seat.bot).length,
          mode: solo ? "solo" : settings.display ? "shared" : "online",
        }),
      );
      main.dataset.phase = frame.phase;
      lobby.hidden = !inLobby;
      battleSection.hidden = inLobby || frame.phase === "over";
      live.element.hidden = inLobby;
      menu.update({
        canLobby:
          isHost && !display && (frame.phase === "running" || resultConfirmed),
        display,
        touch: settings.display || matchMedia("(pointer: coarse)").matches,
        spectator: display || fighter < 0,
      });
      if (inLobby) {
        const usable = frame.players.filter(
          (seat) => seat.connected || seat.bot,
        ).length;
        roster.update(
          frame.players.map((seat) => ({
            ...seat,
            status: seat.bot ? "AI" : seat.connected ? "READY" : "AWAY",
            color: TEAM_COLORS[seat.slot],
            host: seat.id === frame.managerId,
          })),
        );
        for (const [id, row] of roster.entries()) {
          let remove = row.querySelector<HTMLButtonElement>(".fp-remove");
          const removable =
            isHost &&
            !display &&
            frame.players.some((seat) => seat.id === id && seat.bot);
          if (removable && !remove) {
            remove = button("Remove AI", "fp-remove");
            remove.onclick = () =>
              runtime.command({ type: "bot", action: "remove", id });
            row.append(remove);
          }
          if (remove) remove.hidden = !removable;
        }
        addBot.hidden = !isHost || display || frame.players.length >= CAPACITY;
        start.hidden = !isHost || display;
        start.disabled =
          usable < 2 ||
          !frame.players.some((seat) => !seat.bot && seat.connected);
        lobbyNote.hidden = usable >= 2;
        mapChoice.value = settings.map;
        mapChoice.disabled = !isHost || display;
        regenerate.hidden = !isHost || display;
        sharedTv.update(settings.display, isHost && !solo && !display);
        const count = Math.max(2, usable);
        const key = [settings.map, settings.seed, count].join(":");
        if (key !== mapKey) {
          mapKey = key;
          mapPreview.render(
            createBattle(
              settings.seed,
              settings.map,
              Array<boolean>(count).fill(false),
            ),
            [],
          );
        }
      }
      if (frame.phase === "running" && frame.battle) {
        arena.render(
          frame.battle,
          frame.fighters.map((seat) => seat.name),
        );
        commands.update(frame.battle, display ? -1 : fighter, frame.matchId);
      }
      if (frame.phase === "over" && frame.battle) {
        const battle = frame.battle;
        const nextKey = `${frame.matchId}:${state?.decidedTick}:${battle.winner}:${battle.cores.map((core) => [core.hp, core.kills])}`;
        if (nextKey !== resultKey) {
          resultKey = nextKey;
          const winner = frame.fighters[battle.winner ?? -1];
          results.show({
            game: "FUSEPARTICLES",
            context: `${frame.fighters.length} players · ${Math.floor(battle.tick / 20)}s`,
            headline: winner ? `${winner.name} wins` : "Draw",
            accent: TEAM_COLORS[battle.winner ?? -1],
            standings: {
              columns: ["Core HP", "Kills", "Gold"],
              rows: frame.fighters
                .map((seat, index) => ({
                  id: seat.id,
                  name: seat.name,
                  placement:
                    1 +
                    battle.cores.filter(
                      (core) => core.hp > battle.cores[index]!.hp,
                    ).length,
                  color: TEAM_COLORS[index]!,
                  you: seat.id === me,
                  ...(seat.bot ? { tag: "AI" } : {}),
                  values: [
                    battle.cores[index]!.hp,
                    battle.cores[index]!.kills,
                    battle.cores[index]!.gold,
                  ].map((value) => String(Math.floor(value))),
                }))
                .sort((a, b) => a.placement - b.placement),
            },
            sections: [
              {
                title: "Match statistics",
                content: [
                  createBattleCharts(
                    battle,
                    frame.fighters.map((seat) => seat.name),
                  ),
                ],
              },
            ],
          });
        }
        results.update({
          status: resultConfirmed ? undefined : "Confirming match results…",
          actions:
            isHost && !display
              ? [
                  { id: "lobby", label: "Room", disabled: !resultConfirmed },
                  {
                    id: "rematch",
                    label: "Play again",
                    primary: true,
                    disabled: !resultConfirmed,
                  },
                ]
              : [],
        });
      } else if (results.open) {
        results.hide();
        resultKey = "";
      }
      if (!display && state && (session.kind === "room" || social.isSignedIn()))
        for (const report of dueReports(state, me, confirmedTick, sent)) {
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
  };
  const runtime = new FuseParticlesRuntime(
    code,
    settings,
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
          autoStartSolo: false,
        },
  );
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => menu.dispose(),
    reload: () => location.reload(),
  });
  document.addEventListener("keydown", (event) => {
    if (
      lastFrame?.phase !== "running" ||
      display ||
      playtestInputBlocked(document) ||
      document.querySelector("dialog[open]") ||
      menu.isOpen() ||
      event.repeat ||
      (event.target instanceof HTMLElement &&
        event.target.closest("input,select,textarea,[contenteditable]"))
    )
      return;
    if (commands.key(event.key.toLowerCase())) event.preventDefault();
  });
  runtime.start();
}

const query = new URLSearchParams(location.search);
if (query.get("solo") === "1") room(true);
else if (query.has("room")) room(false);
else landing();
