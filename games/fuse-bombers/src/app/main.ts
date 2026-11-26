import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/portal.css";
import "fuse-ui/components.css";
import "fuse-ui/results.css";
import "./style.css";
import "./screens.css";
import { validRoomCode } from "fuse-network-fe";
import { uuid } from "fuse-netcode";
import { createAppPortal, type AppPortal } from "fuse-ui/portal";
import {
  createGameMenu,
  createResultsScreen,
  createRoundControls,
  createTopBar,
} from "fuse-ui";
import Phaser from "phaser";
import {
  RoundScene,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  type RoundSceneData,
} from "../render/round-scene.js";
import { css, playerColor } from "../render/palette.js";
import { createAudio } from "./audio/index.js";
import { Flow } from "./flow.js";
import { createBrowserInput } from "./input/index.js";
import { createBombersPlayScreen } from "./play-stage.js";
import {
  GAME,
  social,
  analytics,
  reportPlay,
  showLanding,
  showRoom,
} from "./online.js";
import { resultBar, resultReport } from "./result-report.js";
import { carry, safeStore, sessionFor } from "./session.js";
import { GOAL, ONLINE_CONTROLS } from "./controls.js";

const params = new URLSearchParams(window.location.search);
/** Music and effects; `?mute` disables them for this load. */
const audio = createAudio();
const store = safeStore(() => localStorage);
const session = sessionFor(location.search, store, GAME, validRoomCode, () =>
  `${uuid()}${uuid()}`.replaceAll("-", ""),
);

/**
 * Boots the game: the Phaser round scene fills the window and the match flow's DOM screens sit on top.
 * Debug flags: `?seed=N` fixes the matches, `?speed=N` runs everything N times as fast, `?touch` forces the touch
 * pads, `?debug` exposes `window.fuseBombers = { game, flow, audio }` for browser tests. `?mute` silences audio.
 */
async function boot(): Promise<void> {
  // Phaser rasterises text once, so the pixel font must be ready before the first scene draws.
  try {
    await document.fonts.load('16px "Press Start 2P"');
  } catch {
    // The monospace fallback is still readable; start without the pixel font rather than not at all.
  }
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "app",
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    backgroundColor: "#0b1020",
    banner: false,
    audio: { noAudio: true }, // Sound is ./audio's, not Phaser's.
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });
  game.scene.add(RoundScene.KEY, RoundScene);
  if (session.kind === "room" || session.kind === "solo")
    return showRoom(session, { store, audio, game });
  // Every (re)start of the round scene needs the audio attached again; the attract round behind the lobby stays
  // silent so the lobby music plays.
  let detachAudio: (() => void) | undefined;
  let attractMode = true;
  const attachAudio = (): void => {
    detachAudio?.();
    const scene = game.scene.getScene(RoundScene.KEY);
    detachAudio = scene && !attractMode ? audio.attachRound(scene) : undefined;
  };
  // Scenes get their event emitter when the game boots.
  game.events.once(Phaser.Core.Events.READY, attachAudio);
  const root = document.createElement("div");
  root.id = "screen";
  document.body.append(root);
  const portal = mountPortal();
  const top = portal.element.parentElement!;
  const brand = document.createElement("a");
  brand.textContent = "FUSE BOMBERS";
  brand.href = import.meta.env.BASE_URL;
  let flow: Flow | undefined;
  const leave = () =>
    location.assign(
      `${import.meta.env.BASE_URL}${GAME}/?${carry(location.search, "")}`,
    );
  // The finished match: the shared results screen. Nothing is focused, so Enter and Esc stay the flow's menu keys
  // (and Space, a rider's fire key, presses nothing); `fui-app` gives its buttons the shared look.
  const results = createResultsScreen({
    document,
    onBack: leave,
    backText: "Leave",
    onAction: (id) => flow?.choose(id === "rematch" ? "again" : "lobby"),
  });
  const resultsHost = document.createElement("div");
  resultsHost.className = "fui-app fb-results-host";
  resultsHost.append(results.element);
  document.body.append(resultsHost);
  let shownResult = "";
  // The bar's menu and the game's own inside it pause the round alike: either one open owns the keys.
  let barOpen = false;
  const pause = () => {
    const open = barOpen || menu.isOpen();
    flow?.setSharedMenuOpen(open);
    // Resume at the arena: Space on a control of the bar would press it again instead of firing.
    if (!open && flow) {
      game.canvas.tabIndex = -1;
      game.canvas.focus({ preventScroll: true });
    }
  };
  const menu = createGameMenu({
    title: "FUSE BOMBERS",
    controls: ONLINE_CONTROLS,
    goal: GOAL,
    onLobby: () => flow?.returnToLobby(),
    onLeave: leave,
    onOpenChange: pause,
  });
  // In the header before the bar takes it, the menu is the bar's "Game controls", as in every other game.
  top.append(brand, social.element(), menu.element);
  createTopBar({
    element: top,
    brand,
    gameId: GAME,
    sound: audio.master,
    onOpenChange: (open) => {
      barOpen = open;
      pause();
    },
  });
  const roundControls = createRoundControls({
    controls: ONLINE_CONTROLS,
    goal: GOAL,
  });
  roundControls.element.classList.add("fb-round-controls");
  document.body.append(roundControls.element);
  const input = createBrowserInput(window, { forceTouch: params.has("touch") });
  // A phone's live match is the whole screen: the arena, its overlay and the pads, turned when the phone is upright.
  const playScreen = createBombersPlayScreen({
    resize: (width, height) => game.scale.setGameSize(width, height),
    stage: document.getElementById("app") ?? document.body,
    riders: [root, input.touchLayer, roundControls.element],
    onChange: () => input.hub.cancel(),
  });
  flow = new Flow({
    playMetrics: reportPlay,
    input,
    root,
    seed: Number(params.get("seed")) || Math.floor(Math.random() * 2 ** 31),
    speed: Number(params.get("speed")) || 1,
    uiState: (state) => {
      playScreen.update(state.live);
      menu.update({
        canLobby: !state.lobby,
        spectator: state.spectator,
        controls: state.controls,
      });
      roundControls.update({
        round: state.round,
        visible: state.countdown && !menu.isOpen(),
        spectator: state.spectator,
        controls: state.controls,
      });
    },
    show: (source, players, attract) => {
      if (!attract) portal.close(); // A match started; screens.css hides the portal until the lobby.
      const data: RoundSceneData = { source, players };
      game.scene.start(RoundScene.KEY, data);
      attractMode = attract;
      attachAudio();
    },
    music: (kind) => audio.music(kind),
    result: (result) => {
      if (!result) {
        if (results.open) results.hide();
        shownResult = "";
        return;
      }
      const key = JSON.stringify(result);
      if (key !== shownResult) {
        shownResult = key;
        results.show(
          resultReport(result, { color: (slot) => css(playerColor(slot)) }),
        );
      }
      results.update(resultBar(result));
    },
  });
  if (params.has("debug"))
    Object.assign(window, { fuseBombers: { game, flow, runner: flow, audio } }); // `runner.view` for browser-check.mjs
}

/**
 * The app portal (every Fuse game) in the top-left corner, after `#screen` so screens.css shows it in the lobby
 * only; its corner becomes the shared bar. Focused from the keyboard, a control there keeps Enter and Space
 * (`pressesFocusedControl`); a mouse click leaves no focus behind, so Enter starts the match again, as after the
 * sound toggle.
 */
function mountPortal(): AppPortal {
  const portal = createAppPortal({
    document,
    current: GAME,
    base: import.meta.env.BASE_URL,
    search: location.search,
  });
  const corner = document.createElement("div");
  corner.className = "portal-corner";
  corner.append(portal.element);
  corner.addEventListener("click", (event) => {
    // The bar's menu is a dialog, and focus inside it is its own: Escape must find it there to close it.
    const inMenu =
      event.target instanceof Element && event.target.closest("dialog");
    if (
      event.detail > 0 &&
      !inMenu &&
      document.activeElement instanceof HTMLElement
    )
      document.activeElement.blur();
  });
  document.body.append(corner);
  return portal;
}

if (session.kind === "landing") showLanding(store, "", audio);
else if (session.kind === "invalid")
  showLanding(store, `${session.code} is not a room code`, audio);
else
  boot().catch((error: unknown) => {
    analytics.reportBootFailure(error);
    console.error("Fuse Bombers failed to start", error);
  });

// Developer aid: a readout of the one-button input layer.
if (params.has("inputdebug")) {
  import("./input/debug.js")
    .then(({ startInputDebug }) => startInputDebug())
    .catch((error: unknown) => {
      console.error("Input debug overlay failed to start", error);
    });
}
