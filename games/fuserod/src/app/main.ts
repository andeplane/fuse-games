import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "fuse-ui/social.css";
import "fuse-ui/results.css";
import "./fuserod.css";
import {
  createAppPortal,
  createBackLink,
  createGameMenu,
  createLandingCard,
  createResultsScreen,
  createTopBar,
  el,
  button,
} from "fuse-ui";
import { createGameSocial } from "fuse-ui/social";
import {
  bindAudioInput,
  browserAudioDependencies,
  createGameAudio,
} from "fuse-ui/game-audio";
import { createResultsHistory } from "fuse-ui/results-history";
import {
  startGameAnalytics,
  createPlayMetrics,
  observeConfirmedPlay,
} from "fuse-ui/play-metrics";
import {
  createEndpoints,
  createRoom,
  PeerTransport,
  validRoomCode,
  memberToken,
  installRoomLifecycle,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES } from "fuse-netcode";
import {
  DEFAULT_SETTINGS,
  type FuserodSettings,
  type FuserodView,
} from "../game/index.js";
import { drawGarage } from "../art/renderer.js";
import { artCanvas } from "../art/catalog.js";
import { drawScene } from "../art/scenes.js";
import { mountCruise, type TownStop } from "../cruise/index.js";
import { activeCar, setup, MODELS } from "../garage/campaign.js";
import {
  loadCampaign,
  mountGarage,
  motorSetup,
  settleRace,
} from "../garage/index.js";
import { FuserodRuntime, type FuserodCallbacks } from "./runtime.js";
import { controls, touchControls, goal, drivingControls } from "./controls.js";
import { safeStore, keys, sessionFor, roomFailure } from "./session.js";
import { createAttract } from "./attract.js";
import { raceLobby } from "./lobby.js";
import { raceScreen, colors } from "./race-screen.js";
import { raceSound } from "./sound.js";

const gameId = "fuserod",
  base = import.meta.env.BASE_URL;
const endpoints = createEndpoints(
  { basePath: base + gameId + "/", apiOrigin: import.meta.env.VITE_API_ORIGIN },
  location.origin,
);
const query = new URLSearchParams(location.search);
const url = (search = "") =>
  endpoints.appUrl(
    search + (query.has("mute") ? (search ? "&mute" : "?mute") : ""),
  );
import { drawScene } from "../art/scenes.js";
import "../art/cursor.css";
const app = document.querySelector<HTMLElement>("#app")!;
const storage = safeStore(() => localStorage),
  names = keys(gameId);
const campaignStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};
const audio = createGameAudio(browserAudioDependencies(storage), {
  forceMute: query.has("mute"),
});
const unbindAudio = bindAudioInput(audio, document, window);
window.addEventListener(
  "pagehide",
  () => {
    audio.setHidden(true);
    unbindAudio();
  },
  { once: true },
);
const analytics = startGameAnalytics(gameId);
const observe = createPlayMetrics(analytics.track, () => performance.now());
const social = createGameSocial({
  gameId,
  base,
  apiOrigin: import.meta.env.VITE_API_ORIGIN,
  document,
  window,
  fetch: (input, init) => fetch(input, init),
  track: analytics.track,
});
const header = (
  items: HTMLElement[] = [],
  onOpenChange?: (open: boolean) => void,
) => {
  const bar = el("header", "", "rod-header"),
    brand = el("a", "FUSEROD", "rod-wordmark");
  brand.href = url();
  bar.append(
    createAppPortal({
      document,
      current: gameId,
      base,
      search: location.search,
    }).element,
    brand,
    social.element(),
    ...items,
  );
  return createTopBar({
    element: bar,
    brand,
    gameId,
    onOpenChange,
    sound: {
      forcedMute: audio.forcedMute,
      enabled: () => !audio.prefs.muted,
      setEnabled: (enabled) => audio.setMuted(!enabled),
      onChange: audio.onChange,
    },
  });
};
function landing() {
  app.classList.add("fuserod-pointer");
  const card = createLandingCard({
    title: "FUSEROD",
    tagline:
      "Tune a hot rod in your garage, then take it to the strip or the canyon.",
    soloText: "OPEN GARAGE",
    soloInBar: true,
    background: createAttract,
    howToPlay: { goal, controls, touchControls },
    valid: validRoomCode,
    onSolo: () => location.assign(url("?solo=1")),
    onJoin: (code) => location.assign(url("?room=" + code)),
    async onCreate() {
      const room = await createRoom(endpoints.apiUrl, fetch, gameId);
      storage.setItem(names.host(room.code), room.token);
      location.assign(url("?room=" + room.code));
    },
  });
  card.menu.dialog.addEventListener("toggle", () => {
    const credits = card.menu.dialog.querySelector(".fui-menu-credits");
    if (!credits || credits.querySelector("canvas")) return;
    const canvas = el("canvas", "", "rod-story");
    credits.prepend(canvas);
    drawScene(canvas, "credits");
  });
  app.replaceChildren(header(), card.element);
}
function garage(startAt?: TownStop) {
  const host = el("main", "", "rod-garage");
  app.replaceChildren(header(), host);
  let dispose = () => {};
  const cruise = (start: TownStop) => {
    const car = activeCar(loadCampaign(campaignStorage));
    if (!car) return;
    dispose();
    window.removeEventListener("pagehide", cleanup);
    const build = setup(car);
    const go = (stop: TownStop) => {
      window.removeEventListener("pagehide", cleanup);
      garage(stop);
    };
    dispose = mountCruise(host, {
      start,
      tune: { ...motorSetup(build), automatic: build.automatic },
      model: build.modelIndex,
      paint: car.paint,
      onArrive: go,
      onBack: () => go(start),
    });
    window.addEventListener("pagehide", cleanup, { once: true });
  };
  const cleanup = () => dispose();
  dispose = mountGarage(host, {
    storage: campaignStorage,
    backHref: url(),
    startAt,
    drawCar: drawGarage,
    drawItem: artCanvas,
    drawScene,
    onCruise: cruise,
    onRace: () => location.assign(url("?solo=1&race=1")),
  });
  window.addEventListener("pagehide", cleanup, { once: true });
}
function play() {
  const session = sessionFor(
    location.search,
    storage,
    gameId,
    validRoomCode,
    memberToken,
  );
  if (session.kind === "invalid" || session.kind === "landing") {
    app.replaceChildren(
      header(),
      createBackLink({ href: url() }),
      el("p", "Invalid room code."),
    );
    return;
  }
  const online = session.kind === "room" ? session : undefined;
  let challenge: ReturnType<typeof loadCampaign>["pending"] = null;
  if (!online) {
    try {
      challenge = loadCampaign(campaignStorage).pending;
    } catch {
      garage();
      return;
    }
  }
  if (!online && !challenge) {
    garage();
    return;
  }
  const settings: FuserodSettings = { ...DEFAULT_SETTINGS };
  if (challenge) {
    settings.route = challenge.route;
    settings.variant = challenge.variant;
    settings.dialInTicks =
      challenge.variant === "grudge" ? challenge.dialInTicks : 0;
    settings.king = challenge.king;
    settings.automatic = challenge.car.automatic;
    Object.assign(settings, motorSetup(challenge.car));
    settings.opponent =
      challenge.rivalRank >= 4 ? 2 : challenge.rivalRank >= 2 ? 1 : 0;
  }
  const display = online?.role === "display";
  let me = "",
    host = false,
    canDrive = false,
    runtime: FuserodRuntime;
  const leave = () => location.assign(url(online ? "" : "?solo=1"));
  const status = el("p", "", "rod-status");
  status.setAttribute("role", "status");
  const menu = createGameMenu({
    goal,
    controls,
    touchControls,
    onLeave: leave,
    onLobby: () =>
      online ? runtime.command({ type: "action", action: "lobby" }) : leave(),
    onOpenChange: (open) => {
      if (open) pad.clear();
    },
  });
  const pad = drivingControls(
    () => canDrive && !menu.isOpen(),
    (v) => runtime.input(v),
  );
  const track = raceScreen();
  const sound = raceSound(audio);
  track.element.append(pad.element);
  const lobby = online
    ? raceLobby({
        code: online.code,
        link: url("?room=" + online.code),
        displayLink: url("?room=" + online.code + "&display=1"),
        runtime: () => runtime,
        name:
          social.playerName(storage.getItem(names.name)) ??
          storage.getItem(names.name) ??
          "",
        saveName: (n) => storage.setItem(names.name, n),
        socialName: () => social.playerName(undefined) ?? undefined,
      })
    : null;
  const results = createResultsScreen({
    document,
    onBack: leave,
    backText: online ? "Leave" : "Garage",
    onAction: (id) =>
      id === "garage"
        ? leave()
        : runtime.command({
            type: "action",
            action: id === "retry" ? "rematch" : "lobby",
          }),
  });
  const main = el("main", "", "rod-main");
  if (lobby) main.append(lobby.element);
  main.append(track.element, status, results.element);
  app.replaceChildren(
    header([menu.element], (open) => {
      if (open) pad.clear();
    }),
    main,
  );
  const history = createResultsHistory({
    gameId,
    fetch: social.reportFetch,
    apiUrl: endpoints.apiUrl,
    ...(online ? { room: { code: online.code, token: online.token } } : {}),
    signedIn: social.isSignedIn,
    playerId: () => me,
    now: () => performance.now(),
  });
  let resultKey = "";
  const label = (r: FuserodView["racers"][number]) =>
    challenge && r.bot ? challenge.rivalName : r.name;
  const appearance = challenge
    ? {
        model: challenge.car.modelIndex,
        paint: challenge.car.paint,
        fittings: challenge.car.fittings,
      }
    : undefined;
  const rivalModel = challenge ? MODELS[challenge.rivalCar] : undefined;
  const rivalAppearance = rivalModel
    ? { model: rivalModel.sprite, paint: rivalModel.paint }
    : undefined;
  const callbacks: FuserodCallbacks = {
    ready(id, isHost) {
      me = id;
      host = isHost;
    },
    event() {},
    status(message) {
      status.textContent = roomFailure(message);
    },
    ended() {
      status.textContent = "Room closed";
      canDrive = false;
      pad.clear();
      const retry = button("Reconnect");
      retry.onclick = () => location.reload();
      status.append(retry);
    },
    state(frame, config) {
      const final = runtime.confirmedFrame();
      observeConfirmedPlay(
        observe,
        frame,
        () => final,
        (v) => {
          const seated =
            v.phase === "lobby"
              ? v.players.filter((p) => !p.watcher)
              : v.racers;
          const entrant = v.racers.find((r) => r.id === me);
          const active = v.phase === "running" && entrant?.countdown === 0 && !entrant.falseStart;
          return {
            matchId: v.matchId,
            round: 1,
            active,
            roundActive: active,
            ended: v.phase === "over",
            roundEnded: v.phase === "over",
            seated: !display && seated.some((p) => p.id === me),
            playerCount: seated.length,
            botCount: seated.filter((p) => p.bot).length,
            mode: !online ? "solo" : config.display ? "shared" : "online",
          };
        },
      );
      if (!display) history.observe(frame.history, runtime.confirmedTick());
      main.dataset.phase = frame.phase;
      track.element.hidden = frame.phase === "lobby";
      if (lobby) {
        lobby.element.hidden = frame.phase !== "lobby";
        if (!lobby.element.hidden)
          lobby.render(frame, config, me, host, display, frame.managerId);
      }
      canDrive =
        !display &&
        frame.phase === "running" &&
        frame.racers.some(
          (r) =>
            r.id === me &&
            !r.broken &&
            !r.crashed &&
            !r.laneFault &&
            !r.breakout &&
            !r.falseStart,
        );
      pad.element.hidden = !canDrive;
      if (!canDrive) pad.clear();
      menu.update({
        canLobby: !display && host && frame.phase !== "lobby",
        touch: matchMedia("(pointer: coarse)").matches,
        display,
        spectator:
          display || !frame.players.some((p) => p.id === me && !p.watcher),
      });
      sound.update(frame, me);
      if (frame.phase === "running") track.render(frame, me,config.automatic);
      if (
        final?.phase !== "over" ||
        final.matchId !== frame.matchId ||
        frame.phase !== "over"
      ) {
        if (results.open) results.hide();
        resultKey = "";
        return;
      }
      if (resultKey === final.matchId) return;
      resultKey = final.matchId;
      let receipt = "";
      const self = final.racers.find((r) => r.id === me);
      if (challenge && self) {
        const save = settleRace(campaignStorage, challenge.id, {
          won: final.winnerId === me,
          elapsedTicks: self.elapsedTicks,
          damage: self.broken || self.crashed ? 24 : 2,
        });
        receipt = save.ok ? save.state.receipt : save.error;
      }
      const winner = final.racers.find((r) => r.id === final.winnerId);
      const incident = final.policePhase === 4 ? "ticket" : self?.crashed ? "wreck" : undefined;
      const picture = el("canvas", "", "rod-story");
      const ruling = self?.falseStart ? "False start" : self?.breakout ? "Dial-in breakout" : self?.laneFault ? "Lane fault" : self?.broken ? "Engine failure" : incident === "wreck" ? "Crash" : incident === "ticket" ? "Caught by patrol" : "";
      results.show({
        ...(incident ? { sections: [{ title: ruling, content: [picture] }] } : {}),
        game: "FUSEROD",
        headline: winner
          ? winner.id === me
            ? "You win"
            : label(winner) + " wins"
          : "Race retired",
        summary: [ruling, receipt].filter(Boolean).join(" · "),
        context:
          final.route.toUpperCase() +
          " · " +
          (final.raceTicks / 20).toFixed(2) +
          " s",
        standings: {
          columns: ["DISTANCE", "SPEED"],
          rows: [...final.racers]
            .sort((a, b) => a.place - b.place)
            .map((r) => ({
              id: r.id,
              name: label(r),
              placement: r.place,
              you: r.id === me,
              color: colors[r.slot % 5]!,
              values: [
                Math.round(r.distance) + " m",
                Math.round(r.speed) + " km/h",
              ],
            })),
        },
      });
      if (incident) drawScene(picture, incident, appearance);
      results.update({
        actions: !online
          ? [{ id: "garage", label: "Return to garage", primary: true }]
          : host && !display
            ? [
                { id: "lobby", label: "Room" },
                { id: "retry", label: "Rematch", primary: true },
              ]
            : [],
      });
    },
  };
  runtime = new FuserodRuntime(
    online?.code ?? "SOLO",
    settings,
    callbacks,
    online
      ? {
          displayOnly: display,
          transport: (events) =>
            social.transport(
              online.code,
              online.token,
              events,
              (e) =>
                new PeerTransport(online.code, online.token, e, {
                  apiUrl: endpoints.apiUrl,
                  gameId,
                  maxFastBytes: MAX_PACKET_BYTES,
                }),
            ),
        }
      : {},
  );
  let animation = 0;
  const draw = () => {
    const timing = runtime.frameTiming();
    if (timing?.newer.phase === "running" && !document.hidden)
      track.paint(timing, me, appearance, rivalAppearance);
    animation = requestAnimationFrame(draw);
  };
  installRoomLifecycle(window, {
    stop: () => {
      cancelAnimationFrame(animation);
      sound.silence();
      runtime.stop();
    },
    destroy: () => {
      pad.dispose();
      history.dispose();
      menu.dispose();
    },
    reload: () => location.reload(),
  });
  runtime.start();
  animation = requestAnimationFrame(draw);
}
if (query.has("room") || (query.get("solo") === "1" && query.has("race")))
  play();
else if (query.get("solo") === "1") garage();
else landing();
