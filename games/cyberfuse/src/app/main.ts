import { placement } from "../game/result.js";
import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "fuse-ui/results.css";
import "fuse-ui/social.css";
import "fuse-ui/game-audio.css";
import "./cyberfuse.css";
import QRCode from "qrcode";
import {
  createEndpoints,
  createRoom,
  PeerTransport,
  validRoomCode,
  installRoomLifecycle,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES, uuid } from "fuse-netcode";
import {
  button,
  el,
  createAppPortal,
  createTopBar,
  createLandingCard,
  createGameMenu,
  createInviteCard,
  createRoomLayout,
  createNameEntry,
  createNotice,
  createResultsScreen,
  createRoster,
  createSharedTvOption,
  requestedRoomSlot,
} from "fuse-ui";
import {
  registerPlaytestInput,
  playtestInputBlocked,
} from "fuse-ui/playtest-input";
import { createGameSocial } from "fuse-ui/social";
import {
  startGameAnalytics,
  createPlayMetrics,
  observeConfirmedPlay,
} from "fuse-ui/play-metrics";
import {
  bindAudioInput,
  browserAudioDependencies,
  createAudioControl,
  createGameAudio,
} from "fuse-ui/game-audio";
import { safeStorage } from "fuse-ui/safe-storage";
import {
  cyberfuseGame,
  DEFAULT_SETTINGS,
  seatName,
  type CyberfuseSettings,
  type CyberfuseView,
} from "../game/index.js";
import { createScene } from "../render/index.js";
import { createMissionSounds } from "../render/audio.js";
import { bindControls, guide } from "./controls.js";
import { createDifficulty } from "./difficulty.js";
import { encodeGameplayQuery, decodeGameplayQuery } from "../options/index.js";
import { createBriefing } from "./briefing.js";
import {
  rememberMissionPassword,
  missionPassword,
} from "../progression/index.js";
import { createHud } from "./hud.js";
import { CyberfuseRuntime, type CyberfuseCallbacks } from "./runtime.js";
import { createReceiptReporter } from "fuse-ui/receipt-reporting";
import { dueReports } from "./reports.js";
import { safeStore, keys, sessionFor, roomFailure } from "./session.js";

const GAME = cyberfuseGame.id;
const app = document.querySelector<HTMLElement>("#app")!;
const base = import.meta.env.BASE_URL,
  apiOrigin = import.meta.env.VITE_API_ORIGIN;
const endpoints = createEndpoints(
  { basePath: base + "cyberfuse/", apiOrigin },
  location.origin,
);
const analytics = startGameAnalytics(GAME);
const reportPlay = createPlayMetrics(analytics.track, () => performance.now());
const social = createGameSocial({
  gameId: GAME,
  base,
  apiOrigin,
  document,
  window,
  fetch: (input, init) => fetch(input, init),
  track: analytics.track,
});
const store = safeStore(() => localStorage),
  names = keys(GAME);
const query = new URLSearchParams(location.search);
const audio = createGameAudio(
  browserAudioDependencies(safeStorage(() => localStorage)),
  { forceMute: query.has("mute") },
);
bindAudioInput(audio, document, window);
const volume = createAudioControl(document, audio, { music: false });
const colors = [
  "#5ce4dc",
  "#ff8b63",
  "#b5ef80",
  "#d5a7ff",
  "#ffe28a",
  "#94baff",
];
const background = async (host: HTMLElement) =>
  (await import("./attract.js")).createAttract(host);
const home = (qs = "") => {
  const url = new URL(endpoints.appUrl(qs), location.href);
  for (const flag of ["mute", "probe"])
    if (query.has(flag)) url.searchParams.set(flag, "");
  return url.href;
};
const source =
  "https://github.com/andeplane/fuse-games/tree/main/games/cyberfuse";
function header(
  extra: HTMLElement[] = [],
  onOpenChange?: (open: boolean) => void,
) {
  const bar = el("header", "", "cyberfuse-top"),
    brand = el("a", "Cyberfuse", "cyberfuse-brand");
  brand.href = home();
  bar.append(
    createAppPortal({ document, current: GAME, base, search: location.search })
      .element,
    brand,
    social.element(),
    volume.element,
    ...extra,
  );
  return createTopBar({
    element: bar,
    gameId: GAME,
    sound: volume.sound,
    onOpenChange,
  });
}

function landing() {
  let choice: CyberfuseSettings = { ...DEFAULT_SETTINGS, campaign: 1 };
  const couch = el("input");
  couch.type = "checkbox";
  const couchLabel = el("label", "", "cf-local");
  couchLabel.append(
    couch,
    document.createTextNode("Two players on this keyboard"),
  );
  const soloDifficulty = createDifficulty(choice, (s) => {
    choice = s;
    soloDifficulty.update(s, true);
    briefing.update(s, { cooperative: couch.checked });
  });
  const briefing = createBriefing(choice, store, (s) => {
    choice = s;
    soloDifficulty.update(s, true);
    briefing.update(s, { cooperative: couch.checked });
  });
  const card = createLandingCard({
    title: "Cyberfuse",
    tagline: "C-Dogs squad missions and arcade dogfights.",
    howToPlay: guide,
    background,
    soloText: "Deploy",
    soloInBar: true,
    async onCreate() {
      const room = await createRoom(endpoints.apiUrl, fetch, GAME).catch(
        (e: unknown) => {
          throw new Error(
            roomFailure(String(e instanceof Error ? e.message : e)),
          );
        },
      );
      store.setItem(names.host(room.code), room.token);
      location.href = home("?room=" + room.code);
    },
    onSolo: () => {
      const params = new URLSearchParams({
        solo: "1",
        mode: choice.mode,
        campaign: String(choice.campaign ?? 0),
        mission: String(choice.startMission ?? 0),
      });
      for (const [k, v] of encodeGameplayQuery(choice.gameplay))
        params.set(k, v);
      if (couch.checked) params.set("local", "2");
      if (choice.loadout?.length)
        params.set("loadout", choice.loadout.join(","));
      location.href = home("?" + params);
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = home("?room=" + code);
    },
  });
  couch.onchange = () => {
    choice = { ...choice, startMission: 0 };
    briefing.update(choice, { cooperative: couch.checked });
  };
  card.soloDetails.append(couchLabel, briefing.element, soloDifficulty.element);
  const credit = el("footer", "", "cf-credit"),
    original = el("a", "C-Dogs by Ronny Wester"),
    link = el("a", "Cyberfuse source & licenses");
  original.href =
    "https://github.com/cxong/cdogs-sdl/blob/master/doc/README_DATA.md";
  link.href = source;
  credit.append(
    original,
    document.createTextNode(" · Campaigns adapted under CC BY · "),
    link,
  );
  card.element.append(credit);
  app.replaceChildren(header(), card.element);
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
    app.replaceChildren(header(), el("p", "Invalid room code"));
    return;
  }
  const solo = session.kind === "solo",
    code = session.kind === "room" ? session.code : "SOLO",
    display = session.kind === "room" && session.role === "display";
  let me = "",
    manager = solo,
    ownSeat: { name: string; slot: number } | undefined;
  let settings: CyberfuseSettings = {
    ...DEFAULT_SETTINGS,
    campaign: 1,
    display: !solo && store.getItem(names.shared) === "1",
  };
  if (solo) {
    const campaign = Number(query.get("campaign") ?? 1);
    const proposed = {
      ...settings,
      mode: query.get("mode") === "dogfight" ? "dogfight" : "campaign",
      campaign,
      startMission: Number(query.get("mission") ?? 0),
      ...(decodeGameplayQuery(query)
        ? { gameplay: decodeGameplayQuery(query) }
        : {}),
      loadout: query.get("loadout")?.split(",").map(Number) ?? [],
    };
    settings = cyberfuseGame.seating.parseSettings(proposed) ?? settings;
  }
  const couch = solo && query.get("local") === "2";
  const main = el("main", "", "cyberfuse-room"),
    lobby = el("section", "", "cyberfuse-lobby"),
    arena = el("section", "", "cf-arena"),
    canvas = el("canvas");
  arena.hidden = true;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Cyberfuse mission");
  const status = createNotice(),
    live = createNotice({ className: "cyberfuse-status" });
  const say = (s: string, tone: "info" | "error" = "info") => {
    status.show(s, tone);
    live.show(s, tone);
  };
  let topOpen = false,
    gameMenuOpen = false,
    mapOpen = false;
  const pauseInspection = () => {
    controls.clear();
    runtime.setInspectionPaused(topOpen || gameMenuOpen || mapOpen);
    if (!topOpen && !gameMenuOpen && !mapOpen && phase === "running")
      canvas.focus({ preventScroll: true });
  };
  const hud = createHud((open) => {
      mapOpen = open;
      pauseInspection();
    }),
    scene = createScene(canvas),
    sounds = createMissionSounds(audio);
  let phase = "",
    canPlay = false;
  const menu = createGameMenu({
    ...guide,
    onLobby: () => runtime.command({ type: "action", action: "lobby" }),
    onLeave: () => {
      runtime.stop();
      location.href = home();
    },
    onOpenChange: (open) => {
      gameMenuOpen = open;
      pauseInspection();
    },
  });
  const controls = bindControls(
    (bits) => runtime.input(bits),
    () =>
      canPlay &&
      !menu.isOpen() &&
      !playtestInputBlocked(document) &&
      !document.querySelector("dialog[open]"),
    hud.toggle,
    couch
      ? (bits) => {
          const second = runtime.localPlayerIds[1];
          if (second) runtime.localInput(second, bits);
        }
      : undefined,
    () => mapOpen || gameMenuOpen || topOpen,
  );
  const stopReportControls = registerPlaytestInput(document, {
    cancel: controls.clear,
  });
  arena.append(canvas, hud.element, hud.panel, controls.element);
  const start = button("Start mission", "fui-button-primary"),
    addBot = button("+ Add bot"),
    note = el("p", "", "fui-lobby-note");
  const roster = createRoster({ emptyText: "Take a seat to join the squad" });
  const namesForm = createNameEntry({
    normalize: (raw) => seatName(raw) ?? "",
    initial: social.playerName(store.getItem(names.name)) ?? "",
    buttonText: "Join",
    onInput: (value) => store.setItem(names.name, value),
    onSubmit: (name) =>
      runtime.command({
        type: "join",
        name,
        slot: requestedRoomSlot(namesForm.form),
      }),
  });
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
      window.open(home("?room=" + code + "&display=1"), "_blank", "noopener"),
  });
  const change = (next: CyberfuseSettings) => {
    runtime.command({ type: "settings", settings: next });
  };
  const difficulty = createDifficulty(settings, change);
  const equip = (ids: number[]) => {
    runtime.equip(ids);
  };
  const briefing = createBriefing(settings, store, change, equip),
    betweenBrief = createBriefing(settings, store, change, equip);
  const secondKit = couch
    ? createBriefing(settings, store, change, (ids) => {
        const id = runtime.localPlayerIds[1];
        if (id) runtime.localEquip(id, ids);
      })
    : undefined;
  const secondBetween = couch
    ? createBriefing(settings, store, change, (ids) => {
        const id = runtime.localPlayerIds[1];
        if (id) runtime.localEquip(id, ids);
      })
    : undefined;
  const between = el("section", "", "cf-between"),
    next = button("Deploy", "fui-button-primary");
  const endTitle = el("h2", "Mission complete"),
    accessCode = el("p", "", "cf-password");
  between.append(
    endTitle,
    accessCode,
    betweenBrief.element,
    ...(secondBetween ? [secondBetween.element] : []),
    next,
  );
  between.hidden = true;
  next.onclick = () => runtime.nextMission();
  const results = createResultsScreen({
    document,
    onBack: () => {
      runtime.stop();
      location.href = home();
    },
    backText: "Leave",
    onAction: (id) =>
      runtime.command({
        type: "action",
        action: id === "rematch" ? "rematch" : "lobby",
      }),
  });
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  addBot.onclick = () =>
    runtime.command({
      type: "bot",
      action: "add",
      slot: requestedRoomSlot(addBot),
    });
  const invite = !solo
    ? createInviteCard({
        code,
        link: endpoints.appUrl("?room=" + code),
        qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
      })
    : undefined;
  main.append(namesForm.form, lobby, arena, between, results.element);
  app.replaceChildren(
    header([live.element, menu.element], (open) => {
      topOpen = open;
      pauseInspection();
    }),
    main,
  );
  createRoomLayout({
    element: lobby,
    roster,
    capacity: cyberfuseGame.seating.capacity,
    join: namesForm.form,
    primaryAction: start,
    background,
    addAI: addBot,
    ...(invite ? { invite: invite.element } : {}),
    layout: "configuration",
    configuration: [
      briefing.element,
      ...(secondKit ? [secondKit.element] : []),
    ],
    actions: [note],
    actionsInHeader: true,
    status: status.element,
    extras: solo ? [] : [shared.element],
    friends: social.friends,
    playerName: () => social.playerName(undefined) ?? undefined,
    ownSlot: () => ownSeat?.slot,
    onMove: (slot) => {
      if (ownSeat) runtime.command({ type: "join", name: ownSeat.name, slot });
    },
    settings: [difficulty.element, el("p", guide.goal)],
    compact: solo,
    heading: solo ? "Solo mission" : "Room",
  });
  const reportReceipts = createReceiptReporter({
    due: dueReports,
    gameId: GAME,
    display,
    scope:
      session.kind === "room"
        ? { kind: "room", code, token: session.token }
        : { kind: "solo", signedIn: () => !couch && social.isSignedIn() },
    apiUrl: endpoints.apiUrl,
    fetch: social.reportFetch,
    playerId: () => me,
    confirmedTick: () => runtime.confirmedTick(),
  });
  let joining = false,
    lastResult = "",
    lastLobby = "",
    lastWorldTick = -1,
    lastWorld: CyberfuseView["world"] = null;
  const remembered = seatName(
    social.playerName(store.getItem(names.name)) ?? "",
  );
  function renderResult(frame: CyberfuseView) {
    const key = JSON.stringify([
      frame.results,
      frame.winners,
      frame.outcome,
      manager,
    ]);
    if (key === lastResult) return;
    lastResult = key;
    const dog = settings.mode === "dogfight";
    const winners = frame.results
      .filter((r) => frame.winners.includes(r.id))
      .map((r) => r.name);
    const rows = [...frame.results].sort(
      (a, b) => b.wins - a.wins || b.score - a.score || a.slot - b.slot,
    );
    results.show({
      game: "CYBERFUSE",
      context: dog ? "Dogfight" : "Campaign",
      headline: dog
        ? (winners.join(" & ") || "No survivor") + " · Dogfight over"
        : frame.outcome === "victory"
          ? "Campaign complete"
          : "Squad lost",
      standings: {
        columns: dog ? ["Score", "Wins"] : ["Score", "Bonus", "Kills"],
        rows: rows.map((r) => ({
          id: r.id,
          name: r.name,
          placement: placement(frame.mode, r.wins, rows),
          you: r.id === me,
          color: colors[r.slot % colors.length]!,
          values: dog
            ? [String(r.score), String(r.wins)]
            : [String(r.score), String(r.bonus), String(r.kills)],
        })),
      },
    });
    results.update({
      actions:
        manager && !display
          ? [
              { id: "lobby", label: "Back to lobby" },
              { id: "rematch", label: "Play again", primary: true },
            ]
          : [],
    });
  }
  const callbacks: CyberfuseCallbacks = {
    state(frame, current) {
      settings = current;
      observeConfirmedPlay(
        reportPlay,
        frame,
        () => runtime.confirmedFrame(),
        (f) => ({
          matchId: f.matchId,
          round: f.round,
          roundActive: f.phase === "running",
          roundEnded: f.phase === "between" || f.phase === "over",
          active: f.phase === "running" || f.phase === "between",
          ended: f.phase === "over",
          playerCount:
            f.world?.actors.filter((a) => a.seat !== null).length ?? 0,
          botCount: f.results.filter((p) => p.bot).length,
          seated: !display && !!f.world?.actors.some((a) => a.seat === me),
          mode: solo ? "solo" : current.display ? "shared" : "online",
        }),
      );
      const previous = phase;
      phase = frame.phase;
      ownSeat = frame.players.find((s) => s.id === me);
      canPlay =
        phase === "running" &&
        !display &&
        !!frame.world?.actors.some(
          (a) =>
            (a.seat === me ||
              (couch && a.seat === runtime.localPlayerIds[1])) &&
            a.hp > 0,
        );
      if (previous !== phase) {
        if (mapOpen) {
          mapOpen = false;
          runtime.setInspectionPaused(topOpen || gameMenuOpen);
        }
        controls.clear();
        hud.reset();
        sounds.reset();
        lastWorld = null;
        lastWorldTick = -1;
        if (phase !== "over") {
          results.hide();
          lastResult = "";
        }
      }
      main.dataset.phase = phase;
      main.dataset.screen = phase === "running" ? "game" : phase;
      lobby.hidden = phase !== "lobby";
      arena.hidden = phase !== "running";
      between.hidden = phase !== "between";
      namesForm.form.hidden = phase !== "lobby" || !!ownSeat || display;
      menu.update({
        canLobby: manager && !display && phase !== "lobby",
        spectator: !ownSeat || display,
        display,
        touch: matchMedia("(pointer: coarse)").matches,
      });
      if (phase === "lobby") {
        const signature = JSON.stringify([
          frame.players,
          frame.loadouts,
          frame.managerId,
          me,
          manager,
          current,
        ]);
        if (lastLobby !== signature || previous !== phase) {
          lastLobby = signature;
          roster.update(
            frame.players.map((s) => ({
              id: s.id,
              slot: s.slot,
              name: s.name,
              avatar: s.avatarId,
              status: s.bot ? "AI" : s.connected ? "READY" : "AWAY",
              host: s.id === frame.managerId,
              color: colors[s.slot % colors.length]!,
            })),
          );
          for (const [id, row] of roster.entries()) {
            if (
              manager &&
              !display &&
              frame.players.find((p) => p.id === id)?.bot &&
              !row.querySelector(".cf-remove")
            ) {
              const remove = button("×", "cf-remove");
              remove.setAttribute("aria-label", "Remove bot");
              remove.onclick = () =>
                runtime.command({ type: "bot", action: "remove", id });
              row.append(remove);
            }
          }
          start.hidden = !manager || display;
          start.disabled = !frame.players.length;
          addBot.hidden =
            !manager ||
            display ||
            frame.players.length >= cyberfuseGame.seating.capacity;
          note.textContent = manager ? "" : "Waiting for the host to start";
          shared.update(current.display, manager && !display && !solo);
          difficulty.update(current, manager && !display);
          if (secondKit)
            secondKit.update(current, {
              host: false,
              slot: 1,
              cooperative: true,
              kitOnly: true,
              personalKit: frame.loadouts[runtime.localPlayerIds[1]!] ?? [],
            });
          briefing.update(current, {
            host: manager && !display,
            slot: ownSeat?.slot ?? -1,
            cooperative: frame.players.length > 1,
            personalKit: frame.loadouts[me] ?? [],
          });
        }
        if (!display && !ownSeat && me && remembered && !joining) {
          joining = true;
          runtime.command({
            type: "join",
            name: remembered,
            slot: requestedRoomSlot(namesForm.form),
          });
        }
      } else if (phase === "running" && frame.world) {
        runtime.flush();
        controls.element.hidden = !canPlay;
        if (
          lastWorldTick !== frame.world.tick ||
          lastWorld !== frame.world ||
          previous !== phase
        ) {
          scene.draw(frame.world, display || couch ? undefined : me);
          hud.update(frame.world, me);
          sounds.observe(frame.world, me);
          lastWorld = frame.world;
          lastWorldTick = frame.world.tick;
        }
        if (previous !== phase && !display)
          canvas.focus({ preventScroll: true });
      } else if (phase === "between") {
        endTitle.textContent =
          current.mode === "dogfight" ? "Bout complete" : "Mission complete";
        next.textContent =
          current.mode === "dogfight" ? "Next round" : "Deploy";
        const cooperative =
          (frame.world?.actors.filter((a) => a.seat !== null).length ?? 1) > 1;
        if (secondBetween)
          secondBetween.update(current, {
            missionIndex: frame.round,
            host: false,
            slot: 1,
            cooperative: true,
            kitOnly: true,
            personalKit: frame.loadouts[runtime.localPlayerIds[1]!] ?? [],
          });
        betweenBrief.update(current, {
          missionIndex: frame.round,
          host: manager && !display,
          between: true,
          slot: ownSeat?.slot ?? -1,
          cooperative,
          personalKit: frame.loadouts[me] ?? [],
        });
        accessCode.hidden = current.mode === "dogfight";
        if (!accessCode.hidden) {
          const code = missionPassword(
            current.campaign ?? 0,
            frame.round,
            0,
            cooperative,
          );
          accessCode.textContent = "Mission password · " + code;
          if (
            ownSeat &&
            runtime.confirmedFrame()?.phase === "between" &&
            runtime.confirmedFrame()?.round === frame.round &&
            accessCode.dataset.saved !== code
          ) {
            rememberMissionPassword(
              store,
              current.campaign ?? 0,
              frame.round,
              0,
              cooperative,
            );
            accessCode.dataset.saved = code;
          }
        }
        next.hidden = !manager || display;
      } else if (phase === "over") renderResult(frame);
      const state = runtime.roomState();
      reportReceipts(state);
    },
    event() {},
    status(message) {
      say(roomFailure(message));
    },
    ready(id, host) {
      me = id;
      manager = host;
    },
    ended() {
      say("Room ended", "error");
    },
  };
  const runtime = new CyberfuseRuntime(
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
              (events) =>
                new PeerTransport(code, session.token, events, {
                  apiUrl: endpoints.apiUrl,
                  gameId: GAME,
                  maxFastBytes: MAX_PACKET_BYTES,
                }),
            ),
        }
      : {
          ...(couch
            ? {
                localPlayers: [
                  social.playerName(store.getItem(names.name)) ?? "Player 1",
                  "Player 2",
                ],
                autoStartSolo: false,
              }
            : {}),
          humanName: social.playerName(store.getItem(names.name)) ?? undefined,
        },
  );
  if (
    query.has("probe") &&
    ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)
  )
    Reflect.set(window, "__cyberfuseProbe", () => {
      const room = runtime.roomState(),
        metrics = runtime.metrics();
      return {
        phase: room?.stage,
        round: room?.round,
        objective: room?.world?.objective,
        tick: room?.tick,
        self: me,
        hashChecks: metrics.hashChecks,
        mismatches: metrics.mismatches,
        actors:
          room?.world?.actors.map(({ seat, x, y, hp, weapon, lastShot }) => ({
            seat,
            x,
            y,
            hp,
            weapon,
            lastShot,
          })) ?? [],
      };
    });
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => {
      stopReportControls();
      menu.dispose();
      controls.dispose();
      scene.dispose();
    },
    reload: () => location.reload(),
  });
  runtime.start();
}
if (query.has("room") || query.get("solo") === "1") room();
else landing();
