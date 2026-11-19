import {
  playtestInputBlocked,
  registerPlaytestInput,
} from "fuse-ui/playtest-input";
import type {
  Action,
  MapDefinition,
  World,
  Outcome,
  Player,
} from "../engine/types.js";
import { AI_STRATEGIES, type AiStrategy } from "../engine/types.js";
import {
  dominanceCells,
  isSprout,
  loadMap,
  RULES,
  sproutSlots,
  TERRITORY,
} from "../engine/index.js";
import { updateContent } from "./dom-update.js";
import {
  createMainMenu,
  escapeIsTaken,
  roomLayoutMarkup,
  mountAttract,
  createTopBar,
} from "fuse-ui";
import { planNeuronPlacement } from "./neuron-placement.js";
import { minimapMarkup, minimapCell } from "../render/minimap.js";
import { battleFocusCell } from "../render/battle-focus.js";
import { structureArt, teamArtFilter } from "../render/art.js";
import {
  spatialize,
  type Locate,
  type PresentationAudio,
  type SoundCue,
} from "./audio.js";
import { createAttractScene } from "./attract-scene.js";
import {
  renderBoard,
  hexCenter,
  hexPoints,
  structureArtwork,
  neuronPortraitUrl,
  type BoardAnimation,
} from "../render/board.js";
import type {
  BoardCamera,
  CameraFactory,
  PanDirection,
} from "../render/camera.js";
import type { LightRenderer } from "../render/light-field.js";
import { DEFAULT_MAP, ROOM_MAPS, bundledMap } from "../online/maps.js";
import { TEAM_PALETTES } from "../render/creep.js";

const TEAM_COLORS = TEAM_PALETTES.map((p) => p.glow);
/** The most networks any Versus map seats, in words for the lobby copy. */
const MAX_ROOM_SEATS = Math.max(2, ...ROOM_MAPS.map((map) => map.seats));
const MAX_ROOM_SEATS_TEXT =
  ["two", "three", "four", "five", "six", "seven", "eight"][
    MAX_ROOM_SEATS - 2
  ] ?? String(MAX_ROOM_SEATS);
import { POWERUP_STYLE } from "../render/powerup-art.js";
import { sporeIconUrl } from "../render/spore-art.js";
import {
  OPENINGS,
  guideMarkup,
  isGuideSection,
  type GuideSection,
} from "./guide.js";
import { randomOpening } from "../engine/ai.js";
import {
  TUTORIAL_MAP,
  TUTORIAL_STEPS,
  nextStep,
  type TutorialContext,
} from "./tutorial.js";
import {
  REPORT_METRICS,
  TEAM_NAMES,
  clock,
  breakdownMarkup,
  chartPanelMarkup,
  findingsMarkup,
  reportPlayers,
  type ReportMetric,
  type ReportPlayer,
} from "./match-report.js";
import { matchResult, resultBar, resultReport } from "./result-report.js";
import { POWERUP_PRESENTATION } from "../engine/powerups.js";
import {
  isBuildKind,
  canAttack,
  STRUCTURES,
  isResearchKind,
  constructionAvailability,
  constructionQueueAvailability,
  constructionUpgradeSource,
  CONSTRUCTIONS,
  constructionDispatchAvailability,
  connectedFrontier,
  planSupport,
  type BuildKind,
} from "../engine/catalog.js";
import {
  renderCommands,
  commandPageCount,
  RESEARCH_PRESENTATION,
  BUILD_PRESENTATION,
  requirementText,
  waitingText,
  type CommandPanel,
} from "./command-card.js";
import type {
  GameMode,
  MapRepository,
  MapSummary,
  NeuralSession,
  PreferencesStore,
  PresentationPreferences,
  SessionFactory,
  OnlineDependencies,
  OnlineSession,
  OpeningChoice,
} from "./contracts.js";
import { isOpeningChoice } from "./contracts.js";
import {
  createGameMenu,
  createLiveResults,
  createResultsScreen,
  createRoundControls,
} from "fuse-ui";

interface BoardArrow {
  pan: PanDirection;
  column: number;
  row: number;
}

const BOARD_ARROWS = new Map<string, BoardArrow>([
  ["ArrowLeft", { pan: "left", column: -1, row: 0 }],
  ["ArrowRight", { pan: "right", column: 1, row: 0 }],
  ["ArrowUp", { pan: "up", column: 0, row: -1 }],
  ["ArrowDown", { pan: "down", column: 0, row: 1 }],
]);

const CRAFT_CONTROLS = [
  {
    keys: "Click / tap",
    action:
      "Select your brain or a neuron, choose Build, then place on open ground",
  },
  {
    keys: "Q W E / A S D",
    action: "Use the commands shown in the command dock",
  },
  {
    keys: "Arrow keys · drag · minimap",
    action: "Move around the battlefield; scroll to zoom",
  },
  { keys: "Shift + click", action: "Queue more buildings" },
  { keys: "Esc", action: "Cancel placement or close a command panel" },
] as const;
const CRAFT_GOAL =
  "Grow a connected network beside resources. Destroy rival brains or hold dominant territory.";

type Screen = "menu" | "setup" | "game" | "multiplayer" | "room" | "guide";
type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T };

/** The opening picker: Random first, then every opening by name. */
function openingOptions(selected: OpeningChoice): string {
  return (["random", ...AI_STRATEGIES] as const)
    .map(
      (kind) =>
        `<option value="${kind}" ${kind === selected ? "selected" : ""}>${kind[0]!.toUpperCase()}${kind.slice(1)}</option>`,
    )
    .join("");
}

function escape(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}

function units(value: number): string {
  return (value / 1000).toFixed(1);
}

/** Territory against the dominance bar, and the network's sprout slots. */
function territoryChips(world: Readonly<World>, player: Player): string {
  const needed = dominanceCells(world);
  const growing = player.queue.filter((j) => j.paid && isSprout(j)).length;
  const rivals = world.players.length > 1;
  return `<div class="territory-chip" title="Cells your connected network claims.${rivals ? ` Hold ${needed} for a minute to win by dominance.` : ""}"><small>TERRITORY</small><strong>⬡ ${player.territory}${rivals ? `<span>/${needed}</span>` : ""}</strong></div><div title="Neurons growing at once; more territory grows more."><small>SPROUTS</small><strong>${growing}/${sproutSlots(player)}</strong></div>`;
}

/** Active powerup buffs with their remaining seconds. */
function buffChips(world: Readonly<World>, player: Player): string {
  return player.buffs
    .filter((b) => b.expiresAt > world.tick)
    .map(
      (b) =>
        `<span class="buff-chip" style="--buff:${POWERUP_STYLE[b.kind].color}" title="${escape(POWERUP_PRESENTATION[b.kind].description)}">${escape(POWERUP_PRESENTATION[b.kind].label.toUpperCase())} ${Math.ceil((b.expiresAt - world.tick) / RULES.ticksPerSecond)}s</span>`,
    )
    .join("");
}

export interface AppDependencies {
  maps: MapRepository;
  preferences: PreferencesStore;
  createSession: SessionFactory;
  debug: boolean;
  /** Full-screen play, where the browser supports it. */
  fullscreen?: {
    active(): boolean;
    toggle(): void;
    onChange(callback: () => void): () => void;
  };
  /** The Fuse app portal, placed first in every page header. */
  portal?: () => HTMLElement;
  /** Shared account and friends controls. */
  social?: () => HTMLElement;
  /** Friend controls for the results screen: a room member's account and its button. */
  friends?: {
    publicIdOfMember(memberId: string): string | undefined;
    friendButton(publicId: string): HTMLElement;
    /** Opens the friends panel, where a friend is invited into the room. */
    open?(): void;
  };
  /** Draws random openings; Math.random unless a test injects one. */
  random?: () => number;
  animationClock: () => number;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  sprites?: Readonly<Record<string, string>>;
  buildingSprites?: import("../render/sprite-raster.js").BuildingSprites;
  createCamera?: CameraFactory;
  /** Online Versus rooms; omitted where the page cannot reach the room service. */
  online?: OnlineDependencies;
  /** A room code from the page address, opened on load. */
  initialRoom?: string;
  /** Additive GPU light over the battlefield; omitted or null renders without it. */
  createLightRenderer?: (canvas: HTMLCanvasElement) => LightRenderer | null;
  audio?: PresentationAudio;
  forcedMute?: boolean;
  /** Input surface used for control guidance; supplied by the browser adapter. */
  touch?: boolean;
}

/**
 * The interface sound for a clicked action. A command's result (a placed
 * plan, research begun) sounds again from its match event, and `null` leaves
 * the cue to the action's own handler.
 */
export function actionCue(action: string | undefined): SoundCue | null {
  if (!action) return "select";
  if (action.startsWith("build-") || action === "toggle-mute") return null;
  if (
    [
      "close-panel",
      "back-menu",
      "close-help",
      "cancel-placement",
      "cancel-confirm",
      "tutorial-close",
      "leave-room",
    ].includes(action)
  )
    return "back";
  if (action === "cancel-build" || action === "cancel-research")
    return "cancel";
  if (
    action === "auto-expand" ||
    action === "charge" ||
    action === "fullscreen" ||
    action.startsWith("particle-")
  )
    return "toggle";
  if (
    action === "help" ||
    action === "guide" ||
    action === "guide-section" ||
    action === "next-command-page" ||
    action === "report-metric" ||
    action.startsWith("mode-")
  )
    return "panel";
  return "select";
}

export function mountFuseCraft(
  root: HTMLElement,
  dependencies: AppDependencies,
): { dispose(): void } {
  let screen: Screen = "menu";
  let mode: GameMode = "skirmish";
  let catalog: LoadState<MapSummary[]> | null = null;
  let selectedId: string | null = null;
  let mapState: LoadState<MapDefinition> | null = null;
  let selectedSlot = 0;
  let selectedCell: number | null = null;
  let placement: BuildKind | null = null;
  let placementCell: number | null = null;
  let placementMessage = "";
  let pending: "reset" | "leave" | null = null;
  let lightTarget: HTMLCanvasElement | null = null;
  let online: OnlineSession | null = null;
  let roomCode = "";
  let roomError: string | null = null;
  let creatingRoom = false;
  let playerName = dependencies.online?.savedName() ?? "";
  /** This room has already seated its viewer once on arriving (or found no name to seat). */
  let autoSeated = false;
  let roomJoinSlot: number | undefined;
  let roomBackground: { root: HTMLElement; stop(): void } | undefined;
  let roomQr: { code: string; url: string } | null = null;
  let lightRenderer: LightRenderer | undefined;
  let launchError: string | null = null;
  let launching = false;
  let session: NeuralSession | null = null;
  let unsubscribe: (() => void) | null = null;
  let aborter: AbortController | null = null;
  let generation = 0;
  let animation: BoardAnimation | null = null;
  let camera: BoardCamera | null = null;
  let frame: number | null = null;
  let disposed = false;
  let preferences: PresentationPreferences = dependencies.preferences.read();
  dependencies.audio?.configure(preferences);
  let instantConstruction = false;
  let instantResearch = false;
  // The opening chosen in setup, and the one drawn for the current match.
  let aiStrategy: OpeningChoice = "random";
  let opponentOpening: AiStrategy = "balanced";
  let powerups = true;
  let firstAiStrategy: OpeningChoice = "random";
  let firstOpening: AiStrategy = "pressure";
  let notices: Outcome[] = [];
  // How to Play: the open section, and whether it is open over a match.
  let guideSection: GuideSection = "goal";
  let helpOpen = false;
  let portal: HTMLElement | undefined;
  // The guided first game: the coach's current step, or null.
  let tutorial: { step: number } | null = null;
  // Why the tutorial's map could not be loaded, shown on the setup screen.
  let tutorialError: string | null = null;
  // The control focused before How to play opened over a match.
  let helpReturn: HTMLElement | null = null;
  // The end-of-match report: which chart it shows.
  let reportMetric: ReportMetric = "territory";
  /** The world and players the chart was drawn from, for its metric tabs. */
  let shownReport: {
    world: Readonly<World>;
    players: readonly ReportPlayer[];
  } | null = null;
  let noticeTick = -1;
  let noticeMatch = "";
  let panel: CommandPanel = "inspect";
  let commandPage = 0;
  const attractScene = createAttractScene();
  const controlsOptions = {
    document: root.ownerDocument,
    controls: CRAFT_CONTROLS,
    touchControls: [
      {
        keys: "Tap",
        action:
          "Select your brain or a neuron, choose Build, then tap open ground",
      },
      {
        keys: "Command dock",
        action: "Tap Build, Research or Charge for the selected structure",
      },
      { keys: "Drag / minimap", action: "Move around the battlefield" },
      { keys: "Pinch", action: "Zoom in or out" },
    ],
    goal: CRAFT_GOAL,
  };
  function menuInputChanged(open: boolean) {
    releaseCameraKeys();
    const blocked = open || !!root.ownerDocument.querySelector("dialog[open]");
    camera?.setEdgeScroll(!blocked && preferences.edgeScroll);
    if (
      !blocked &&
      screen === "game" &&
      session?.canControl &&
      !pending &&
      !helpOpen &&
      !results.open
    )
      root
        .querySelector<SVGSVGElement>("#nd-board")
        ?.focus?.({ preventScroll: true });
  }
  const gameMenu = createGameMenu({
    ...controlsOptions,
    onLobby: () => online?.lobby(),
    onLeave: () => {
      if (session?.view().finished) showMenu();
      else {
        pending = "leave";
        render();
      }
    },
    onOpenChange: menuInputChanged,
  });
  const roundControls = createRoundControls(controlsOptions);
  // The result: the shared results screen over the battlefield.
  const results = createResultsScreen({
    document: root.ownerDocument,
    // Online, whoever is not the host still has a way out of the room.
    onBack: () => showMenu(),
    backText: "Leave",
    onAction: (id) => {
      if (id === "menu") showMenu();
      else if (id === "lobby") online?.lobby();
      else if (online) online.rematch();
      else restart();
    },
  });
  const liveResults = createLiveResults(results);
  // Smokes and tests find the result by the old card's id.
  results.element.id = "match-result";
  const reportPart = (className: string) => {
    const part = root.ownerDocument.createElement("div");
    part.className = className;
    return part;
  };
  const reportFindings = reportPart("report-part"),
    reportChart = reportPart("report-part"),
    reportBreakdown = reportPart("match-report");

  function stopAnimation() {
    if (frame !== null) dependencies.cancelFrame(frame);
    frame = null;
    animation = null;
  }

  function animate(now: number) {
    if (disposed || screen !== "game") return;
    animation?.animate(now);
    updateMinimapView();
    frame = dependencies.requestFrame(animate);
  }

  function updateMinimapView() {
    const view = root
      .querySelector("#nd-board")
      ?.getAttribute("viewBox")
      ?.split(" ");
    const outline = root.querySelector(".minimap-view");
    if (view && outline)
      ["x", "y", "width", "height"].forEach((key, i) =>
        outline.setAttribute(key, view[i]!),
      );
  }

  function restart() {
    if (online) {
      pending = null;
      online.lobby();
      return;
    }
    // A random opening is drawn again for every new match.
    if (
      (mode === "skirmish" || mode === "watch") &&
      (aiStrategy === "random" ||
        (mode === "watch" && firstAiStrategy === "random"))
    ) {
      pending = null;
      launch();
      return;
    }
    camera?.dispose();
    camera = null;
    placement = null;
    placementCell = null;
    panel = "inspect";
    commandPage = 0;
    pending = null;
    session?.reset();
    // A restarted tutorial starts its coaching over, brain unselected.
    if (tutorial) tutorial = { step: 0 };
    selectedCell = tutorial
      ? null
      : (session
          ?.view()
          .structures.find(
            (s) => s.ownerId === session?.localPlayerId && s.kind === "brain",
          )?.cell ?? null);
    render();
  }

  function cancelLoads() {
    generation++;
    aborter?.abort();
    aborter = null;
  }

  function disposeSession() {
    camera?.dispose();
    camera = null;
    stopAnimation();
    unsubscribe?.();
    unsubscribe = null;
    session?.dispose();
    session = null;
    online = null;
  }

  function showMenu() {
    gameMenu.close();
    cancelLoads();
    if (online) dependencies.online?.leaveRoom();
    disposeSession();
    pending = null;
    helpOpen = false;
    tutorial = null;
    tutorialError = null;
    launchError = null;
    screen = "menu";
    render();
  }

  async function startTutorial() {
    screen = "setup";
    mode = "sandbox";
    tutorialError = null;
    const attempt = { step: 0 };
    tutorial = attempt;
    await loadSelectedMap(TUTORIAL_MAP);
    // A newer attempt, or leaving the menu, owns the tutorial now.
    if (tutorial !== attempt) return;
    if (
      screen === "setup" &&
      selectedId === TUTORIAL_MAP &&
      mapState?.status === "ready"
    ) {
      launch();
      return;
    }
    tutorial = null;
    if (screen === "setup" && mapState?.status === "error") {
      tutorialError = mapState.message;
      render();
    }
  }

  /**
   * This device holds a seat in the match: it controls it while it runs and,
   * online, still sees the match as a player once it is over.
   */
  function participant(world: Readonly<World>): boolean {
    if (!session) return false;
    if (session.canControl) return true;
    const self = session.localPlayerId;
    return online !== null && world.players.some((p) => p.id === self);
  }

  /** Which opening each AI played, revealed once the match is over. */
  function aiOpenings(world: Readonly<World>): Map<string, AiStrategy> {
    const openings = new Map<string, AiStrategy>();
    if (online) {
      const room = online.room();
      for (const seat of room.seats)
        if (seat.bot)
          openings.set(
            seat.id,
            room.aiStrategy === "random"
              ? randomOpening(world.matchId, seat.slot)
              : room.aiStrategy,
          );
    } else if (mode === "skirmish" || mode === "watch")
      for (const p of world.players)
        if (mode === "watch" || p.id !== session?.localPlayerId)
          openings.set(
            p.id,
            p.id === session?.localPlayerId ? firstOpening : opponentOpening,
          );
    return openings;
  }
  /** The dominance countdown: who holds the dominant share and for how long. */
  function renderDominance(world: Readonly<World>) {
    const banner = root.querySelector<HTMLElement>("#dominance-banner");
    if (!banner) return;
    const holder = world.finished
      ? undefined
      : world.players
          .filter((p) => p.alive && p.dominanceSince !== null)
          .sort((a, b) => a.dominanceSince! - b.dominanceSince!)[0];
    banner.hidden = !holder;
    if (!holder) return;
    const left = Math.max(
      0,
      holder.dominanceSince! + TERRITORY.dominanceTicks - world.tick,
    );
    const playing = participant(world);
    const you = playing && holder.id === session?.localPlayerId;
    banner.style.setProperty("--team", TEAM_COLORS[holder.slot] ?? "#63cfff");
    banner.classList.toggle("yours", you);
    // Spectators get a neutral countdown: nobody watching is being defeated.
    const stake = you ? "victory" : playing ? "defeat" : "a dominance win";
    updateContent(
      banner,
      `<strong>${you ? "You dominate the cortex" : `${escape(sideName(world, holder.id))} dominates the cortex`}</strong><span>${clock(left)} to ${stake} · ${holder.territory}/${dominanceCells(world)} cells</span>`,
    );
  }

  /** The coach panel: the current step, advanced by what the player has done. */
  function renderCoach(world: Readonly<World>) {
    const coach = root.querySelector<HTMLElement>("#tutorial-coach");
    root
      .querySelectorAll(".tutorial-target")
      .forEach((element) => element.classList.remove("tutorial-target"));
    if (!coach) return;
    coach.hidden = !tutorial || !session?.localPlayerId;
    if (!tutorial || !session?.localPlayerId) return;
    const context: TutorialContext = {
      world,
      playerId: session.localPlayerId,
      selectedCell,
    };
    tutorial = { step: nextStep(tutorial.step, context) };
    const index = tutorial.step;
    const step = TUTORIAL_STEPS[index]!;
    const last = index === TUTORIAL_STEPS.length - 1;
    updateContent(
      coach,
      `<p class="coach-progress">TUTORIAL · ${index + 1}/${TUTORIAL_STEPS.length}</p><h2>${escape(step.title)}</h2><p>${escape(step.text)}</p>${step.keys ? `<p class="coach-keys">${step.keys.map((k) => `<kbd>${escape(k)}</kbd>`).join(" then ")}</p>` : ""}<div class="button-row">${last ? '<button data-action="tutorial-play" class="primary">Play vs AI</button><button data-action="tutorial-close" class="secondary">Keep exploring</button>' : `${step.done ? "" : '<button data-action="tutorial-next" class="primary">Next</button>'}<button data-action="tutorial-close" class="secondary">Skip tutorial</button>`}</div>`,
    );
    if (step.target)
      root
        .querySelectorAll(step.target)
        .forEach((element) => element.classList.add("tutorial-target"));
  }

  async function loadCatalog() {
    cancelLoads();
    const token = generation;
    aborter = new AbortController();
    catalog = { status: "loading" };
    tutorialError = null;
    mapState = null;
    render();
    try {
      const value = await dependencies.maps.list(aborter.signal);
      if (disposed || token !== generation || screen !== "setup") return;
      catalog = { status: "ready", value };
      if (!selectedId || !value.some((item) => item.id === selectedId))
        selectedId = value[0]?.id ?? null;
      render();
      if (selectedId) await loadSelectedMap(selectedId);
    } catch (error) {
      if (disposed || token !== generation || screen !== "setup") return;
      catalog = {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "The map catalog could not be loaded.",
      };
      render();
    }
  }

  async function loadSelectedMap(id: string) {
    cancelLoads();
    const token = generation;
    aborter = new AbortController();
    selectedId = id;
    selectedSlot = 0;
    mapState = { status: "loading" };
    tutorialError = null;
    launchError = null;
    render();
    try {
      const raw = await dependencies.maps.load(id, aborter.signal);
      const value = loadMap(raw);
      if (disposed || token !== generation || screen !== "setup") return;
      mapState = { status: "ready", value };
      selectedSlot = value.spawns[0]?.slot ?? 0;
      render();
    } catch (error) {
      if (disposed || token !== generation || screen !== "setup") return;
      mapState = {
        status: "error",
        message:
          error instanceof Error ? error.message : "This map is invalid.",
      };
      render();
    }
  }

  function launch() {
    if (launching || mapState?.status !== "ready") return;
    launching = true;
    launchError = null;
    render();
    try {
      const draw = (choice: OpeningChoice): AiStrategy =>
        choice === "random"
          ? AI_STRATEGIES[
              Math.min(
                AI_STRATEGIES.length - 1,
                Math.floor(
                  (dependencies.random ?? Math.random)() * AI_STRATEGIES.length,
                ),
              )
            ]!
          : choice;
      opponentOpening = draw(aiStrategy);
      firstOpening = draw(firstAiStrategy);
      const settings = {
        aiStrategy: opponentOpening,
        instantConstruction: dependencies.debug && instantConstruction,
        instantResearch: dependencies.debug && instantResearch,
        ...(mode === "skirmish" || mode === "watch" ? { powerups } : {}),
      };
      const created = dependencies.createSession(
        mapState.value,
        selectedSlot,
        mode,
        settings,
        mode === "watch"
          ? { watchStrategies: [firstOpening, opponentOpening] }
          : undefined,
      );
      disposeSession();
      session = created;
      panel = "inspect";
      placement = null;
      placementCell = null;
      // The tutorial asks the player to select the brain themselves.
      selectedCell = tutorial
        ? null
        : (mapState.value.spawns.find((spawn) => spawn.slot === selectedSlot)
            ?.cellIndex ?? null);
      unsubscribe = created.subscribe(() => {
        if (screen === "game") renderGame();
      });
      screen = "game";
      render();
    } catch (error) {
      launchError =
        error instanceof Error ? error.message : "The session could not start.";
    } finally {
      launching = false;
      render();
    }
  }

  function gameWorld(): Readonly<World> | null {
    return session?.view() ?? null;
  }

  function guideScreenMarkup(): string {
    return `${header("How to play")}<main class="nd-panel guide-panel">${guideMarkup(guideSection)}</main>`;
  }

  function modal(): string {
    if (!pending && helpOpen)
      return `<div class="nd-modal-backdrop"><section class="nd-modal guide-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><div class="guide-modal-head"><h2 id="help-title">How to play</h2><button data-action="close-help" class="secondary">Close</button></div>${guideMarkup(guideSection)}</section></div>`;
    if (!pending) return "";
    const world = gameWorld();
    const watching = !!session && !!world && !participant(world);
    return `<div class="nd-modal-backdrop"><section class="nd-modal" role="alertdialog" aria-modal="true" aria-labelledby="discard-title"><p class="eyebrow">Progress will be discarded</p><h2 id="discard-title">${pending === "reset" ? "Reset this session?" : "Return to the menu?"}</h2><p>${pending === "reset" ? "The same map and spawn will start from the beginning." : watching ? "This battle will be discarded." : "Your current network and research will be lost."}</p><div class="button-row"><button data-action="cancel-confirm" class="secondary">${watching ? "Keep watching" : "Keep playing"}</button><button data-action="confirm-${pending}" class="danger">${pending === "reset" ? "Reset session" : "Leave session"}</button></div></section></div>`;
  }

  /**
   * The app's bar, and under it a page's own head: Back at the top left, the title, and the page's main action at
   * the right, as on every other page. The menu, the battlefield and the room (which has the shared room's head)
   * pass no title.
   */
  function header(
    title = "",
    options: { back?: string; actions?: string } = {},
  ): string {
    return `<header class="nd-header"><div class="brand">FUSE <strong>CRAFT</strong></div>${dependencies.debug ? '<span class="debug-badge">DEBUG</span>' : ""}</header>${title ? `<div class="screen-heading fui-page-head"><button class="fui-back" data-action="${options.back ?? "back-menu"}" aria-label="Back">Back</button><h1 class="fui-page-title">${escape(title)}</h1>${options.actions ? `<div class="fui-page-actions">${options.actions}</div>` : ""}</div>` : ""}`;
  }

  function menuMarkup(): string {
    return `<div class="attract-scene" aria-hidden="true"><svg id="nd-attract-board"></svg></div><div class="attract-shade"></div>${header()}<main class="menu-layout fui-landing"><p class="eyebrow">GROW · CONNECT · DEFEND</p><h1 class="fui-landing-title">FUSE<br><span>CRAFT</span></h1><p class="fui-landing-tagline">Build your network.<br>Keep the signal alive.</p><nav class="fui-landing-actions" aria-label="Main menu"><button data-action="new-game" class="fui-button-primary menu-button"><span aria-hidden="true">▶</span> Single player</button>${dependencies.online ? '<button data-action="multiplayer" class="menu-button">Multiplayer</button>' : ""}<button data-action="tutorial" class="menu-button">Tutorial</button><button data-action="guide" class="menu-button">How to play</button></nav></main><footer class="menu-footer">A FUSE GAME <span>${dependencies.online ? "PLAYER VS AI · ONLINE VERSUS" : "SKIRMISH · PLAYER VS AI"}</span></footer>`;
  }

  function playerOptions(): HTMLElement {
    const panel = root.ownerDocument.createElement("div");
    panel.className = "settings-panel";
    panel.innerHTML = `<label class="setting-row"><span>Effects volume</span><input type="range" min="0" max="1" step="0.05" data-setting="volume" value="${preferences.volume}" ${dependencies.forcedMute ? "disabled" : ""}></label><label class="setting-row"><span><strong>Reduced motion</strong><small>Reduce particle animation and flashes</small></span><input type="checkbox" data-setting="reducedMotion" ${preferences.reducedMotion ? "checked" : ""}></label><label class="setting-row"><span><strong>Edge scrolling</strong><small>Move the camera when the mouse rests at the board's edge</small></span><input type="checkbox" data-setting="edgeScroll" ${preferences.edgeScroll ? "checked" : ""}></label>`;
    return panel;
  }

  function setupMarkup(): string {
    const mapOptions =
      catalog?.status === "ready"
        ? catalog.value
            .map(
              (map) =>
                `<option value="${escape(map.id)}" ${selectedId === map.id ? "selected" : ""}>${escape(map.title)}</option>`,
            )
            .join("")
        : "";
    const catalogBlock = tutorialError
      ? `<div class="error-card" role="alert"><strong>Tutorial map unavailable</strong><p>${escape(tutorialError)}</p><button data-action="tutorial">Retry tutorial</button></div>`
      : !catalog || catalog.status === "loading"
        ? '<p role="status">Loading maps…</p>'
        : catalog.status === "error"
          ? `<div class="error-card" role="alert"><strong>Map catalog unavailable</strong><p>${escape(catalog.message)}</p><button data-action="retry-catalog">Retry</button></div>`
          : catalog.value.length === 0
            ? '<div class="empty-card">No maps are available yet. <button data-action="retry-catalog">Retry</button></div>'
            : `<label class="field-label" for="map-picker">Map</label><select id="map-picker" data-field="map">${mapOptions}</select>`;
    const loaded = mapState?.status === "ready" ? mapState.value : null;
    const details =
      !selectedId || catalog?.status !== "ready"
        ? ""
        : !mapState || mapState.status === "loading"
          ? '<p role="status">Validating selected map…</p>'
          : mapState.status === "error"
            ? `<div class="error-card" role="alert"><strong>Map unavailable or invalid</strong><p>${escape(mapState.message)}</p><button data-action="retry-map">Retry map</button></div>`
            : `<div class="map-meta"><strong>${loaded?.width} × ${loaded?.height} hexes</strong><span>◈ Biomass deposits</span><span>◇ Insight deposits</span><span>▰ Blocked ground</span></div><label class="field-label" for="spawn-picker">Spawn</label><select id="spawn-picker" data-field="spawn">${loaded?.spawns.map((spawn) => `<option value="${spawn.slot}" ${selectedSlot === spawn.slot ? "selected" : ""}>Spawn ${spawn.slot + 1} · tile ${spawn.cellIndex}</option>`).join("")}</select>`;
    // Start is at the top, beside Back, never under the page.
    return `${header("New game", { actions: `<button data-action="start" class="primary" ${loaded && !launching ? "" : "disabled"}>${launching ? "Starting…" : mode === "watch" ? "Watch match →" : "Start →"}</button>` })}
      <main class="setup-layout"><section class="nd-panel">
        <p class="section-index">01 / SCENARIO</p><div class="choice-grid">
        <button data-action="mode-skirmish" class="choice ${mode === "skirmish" ? "active" : ""}" aria-pressed="${mode === "skirmish"}"><strong>Player vs AI</strong><span>Grow, research and destroy the rival brain.</span></button>
        <button data-action="mode-watch" class="choice ${mode === "watch" ? "active" : ""}" aria-pressed="${mode === "watch"}"><strong>Watch AI vs AI</strong><span>Choose two openings and follow their battle.</span></button>
        <button data-action="mode-sandbox" class="choice ${mode === "sandbox" ? "active" : ""}" aria-pressed="${mode === "sandbox"}"><strong>Open sandbox</strong><span>One player, no AI. Grow at your pace.</span></button>
        <button data-action="mode-combat-lab" class="choice ${mode === "combat-lab" ? "active" : ""}" aria-pressed="${mode === "combat-lab"}"><strong>Combat lab</strong><span>Scripted opposition to test routing and cuts.</span></button>
        </div><p class="section-index">02 / FIELD</p>${catalogBlock}${details}</section>
        <aside class="nd-panel setup-summary"><p class="section-index">SESSION BRIEF</p>
        <h2>${mode === "watch" ? "Follow the battle" : mode === "skirmish" ? "Take the field" : mode === "sandbox" ? "An open beginning" : "A controlled confrontation"}</h2>
        <p>${mode === "watch" ? "Two AI players · Equal resources · Watch, pan and inspect either network" : mode === "skirmish" ? "You versus one AI · Equal resources · Destroy the enemy brain" : `One local player · No AI controller${mode === "combat-lab" ? " · Scripted opposing network" : ""}`}</p>
        ${mode === "watch" ? `<label class="field-label" for="first-strategy-picker">First AI opening</label><select id="first-strategy-picker" data-field="first-strategy">${openingOptions(firstAiStrategy)}</select>` : ""}
        ${mode === "skirmish" || mode === "watch" ? `<label class="field-label" for="strategy-picker">${mode === "watch" ? "Second AI opening" : "Opponent opening"}</label><select id="strategy-picker" data-field="strategy">${openingOptions(aiStrategy)}</select><p class="muted">Different openings, equal resources. Random keeps you guessing: scout what the AI builds and counter it. Its opening is revealed when the match ends.</p>` : ""}
        ${mode === "skirmish" || mode === "watch" ? `<label class="toggle-field"><input type="checkbox" data-field="powerups" ${powerups ? "checked" : ""}> Random powerups <small>Contested pickups spawn between the brains; the first network to touch one claims it.</small></label>` : ""}
        ${
          dependencies.debug
            ? `<fieldset class="debug-options"><legend>Debug options</legend>
          <p>Clear tile boundaries are on. Particle travel always takes normal time.</p>
          <label><input type="checkbox" data-debug="construction" ${instantConstruction ? "checked" : ""}> Instant construction after delivery</label>
          <label><input type="checkbox" data-debug="research" ${instantResearch ? "checked" : ""}> Instant research</label>
          <small>Resource costs and prerequisites still apply.</small></fieldset>`
            : mode === "watch"
              ? "<p>Select a structure to inspect it. Use the minimap or either player's card to move around the field.</p>"
              : "<p>Build beside resources. Connect your network. Select frontline nodes and use <strong>Charge</strong> to supply their weapons.</p>"
        }
        ${launchError ? `<div class="error-card" role="alert">${escape(launchError)}<button data-action="start">Retry launch</button></div>` : ""}
        </aside></main>`;
  }

  function gameMarkup(): string {
    const roomMap = online?.room().mapId;
    const title = online
      ? ROOM_MAPS.find((m) => m.id === roomMap)?.title
      : catalog?.status === "ready"
        ? catalog.value.find((m) => m.id === selectedId)?.title
        : undefined;
    return `${header()}<main class="game-layout" aria-label="${escape(title ?? "Neural field")} battlefield" ${pending ? "inert" : ""}>
      <section class="board-shell">
      <div id="nd-viewport" class="board-scroll"><svg id="nd-board" class="nd-board" tabindex="0" aria-label="Hex board. Use arrow keys to move selection."></svg><canvas id="nd-light" class="nd-light" aria-hidden="true"></canvas></div>
      <div id="dominance-banner" class="dominance-banner" role="status" hidden></div><aside id="tutorial-coach" class="tutorial-coach" aria-live="polite" hidden></aside>
      </section>
      <aside id="game-sidebar" class="game-sidebar"></aside></main><div id="game-modal">${modal()}</div>`;
  }

  function fullscreenButton(): string {
    const full = dependencies.fullscreen;
    if (!full) return "";
    const on = full.active();
    return `<button data-action="fullscreen" class="secondary" aria-pressed="${on}" aria-label="${on ? "Leave full screen" : "Full screen"}" title="${on ? "Leave full screen (F)" : "Full screen (F)"}">⛶</button>`;
  }

  function toggleMute() {
    preferences = { ...preferences, mute: !preferences.mute };
    dependencies.preferences.write(preferences);
    dependencies.audio?.configure(preferences);
    dependencies.audio?.unlock();
    dependencies.audio?.play("toggle");
    decorate();
  }

  /** Places board sounds relative to what the camera shows. */
  function soundLocator(world: Readonly<World>): Locate | undefined {
    const view = root
      .querySelector("#nd-board")
      ?.getAttribute("viewBox")
      ?.split(" ")
      .map(Number);
    if (view?.length !== 4 || view.some((n) => !Number.isFinite(n)))
      return undefined;
    const [x = 0, y = 0, width = 0, height = 0] = view;
    return (cell) =>
      spatialize({ x, y, width, height }, hexCenter(world.map.width, cell));
  }

  /** Points the camera at the minimap position under a pointer. */
  function minimapFocus(minimap: Element, x: number, y: number) {
    const world = gameWorld();
    const box = minimap.getBoundingClientRect();
    if (!world || !box.width || !box.height) return;
    camera?.focusCell(
      world.map.width,
      minimapCell(
        world,
        (x - box.left) / box.width,
        (y - box.top) / box.height,
      ),
    );
    updateMinimapView();
  }
  // A press on the minimap keeps the camera on the pointer until release.
  let minimapDrag: number | null = null;
  function onPointerDown(event: PointerEvent) {
    if (playtestInputBlocked(root.ownerDocument)) return;
    const minimap = (event.target as Element).closest?.("#nd-minimap");
    if (!minimap || pending || event.button !== 0) return;
    minimapDrag = event.pointerId;
    (
      minimap as Element & { setPointerCapture?(id: number): void }
    ).setPointerCapture?.(event.pointerId);
    minimapFocus(minimap, event.clientX, event.clientY);
  }
  function onPointerUp(event: PointerEvent) {
    if (event.pointerId === minimapDrag) minimapDrag = null;
  }
  function onKeyUp(event: KeyboardEvent) {
    const arrow = BOARD_ARROWS.get(event.key);
    if (arrow) camera?.hold(arrow.pan, false);
  }

  // Keys released while the window is in the background never arrive.
  function onFocusOut(event: FocusEvent) {
    if (event.relatedTarget) return;
    releaseCameraKeys();
  }

  function releaseCameraKeys() {
    for (const { pan } of BOARD_ARROWS.values()) camera?.hold(pan, false);
  }

  function sideName(world: Readonly<World>, id: string): string {
    return (
      TEAM_NAMES[world.players.find((p) => p.id === id)?.slot ?? 0] ?? "Player"
    );
  }

  function watchMarkup(world: Readonly<World>): string {
    const players = [...world.players].sort(
      (a, b) =>
        Number(b.id === session?.localPlayerId) -
        Number(a.id === session?.localPlayerId),
    );
    const structure = world.structures.find((s) => s.cell === selectedCell);
    const selected = structure
      ? `${sideName(world, structure.ownerId)} · ${structure.kind.toUpperCase()} · ${structure.hp} HP`
      : selectedCell === null
        ? "Select a structure"
        : `HEX ${selectedCell}`;
    const resources = players
      .map(
        (p) =>
          `<div><small>${sideName(world, p.id).toUpperCase()}</small><strong>◈ ${units(p.biomass)} <span>◇ ${units(p.insight)}</span> <span>⬡ ${p.territory}</span></strong></div>${buffChips(world, p)}`,
      )
      .join("");
    // Online spectators see each seat's name: the local watch openings are
    // whatever the last single-player match used, not this room's.
    const seats = online?.room().seats ?? [];
    const cards = players
      .map((p) => {
        const label = online
          ? escape(seats.find((seat) => seat.id === p.id)?.name ?? "")
          : escape(
              p.id === session?.localPlayerId ? firstOpening : opponentOpening,
            );
        const brain = world.structures.find(
          (s) => s.ownerId === p.id && s.kind === "brain",
        );
        return `<button class="watch-player" data-watch-player="${escape(p.id)}" style="--team:${TEAM_COLORS[p.slot]}"><strong>${sideName(world, p.id)}${label ? ` · ${label}` : ""}</strong><span>Brain ${brain?.hp ?? 0} HP</span><small>${p.statistics.built} built · ${p.statistics.lost} lost</small></button>`;
      })
      .join("");
    // Only a room's host can send it back to the lobby.
    const restart = online
      ? online.room().manager
        ? '<button data-action="reset" class="secondary">Lobby</button>'
        : ""
      : '<button data-action="reset" class="secondary">Restart</button>';
    return `<div class="battle-topbar watch-topbar"><div class="resource-row">${resources}</div><div class="hud-mini"></div><div class="session-controls">${fullscreenButton()}<button data-action="help" class="secondary" aria-label="How to play" title="How to play">?</button>${online ? "" : restart}</div></div><div class="command-dock watch-dock">${minimapMarkup(world)}<section class="inspector" aria-label="Selected hex"><div class="selection-details"><strong>${escape(selected)}</strong><span>${structure ? (structure.connected ? "Connected to its brain" : "Disconnected") : "Watch either network grow and adapt."}</span><small>Pan, zoom and inspect · Select a player to follow its brain</small></div><button data-action="find-battle" class="secondary" title="Jump to fighting or the nearest opposing networks">Find battle</button></section><nav class="watch-players" aria-label="${online ? "Players" : "AI players"}">${cards}</nav></div>`;
  }

  function sidebarMarkup(world: Readonly<World>): string {
    if (session && !participant(world)) return watchMarkup(world);
    const player = world.players.find(
      (item) => item.id === session?.localPlayerId,
    );
    if (!player) return '<div class="nd-panel">No local player exists.</div>';
    const structure = world.structures.find(
      (item) => item.cell === selectedCell,
    );
    const cell = selectedCell === null ? null : world.map.cells[selectedCell];
    const owned = structure?.ownerId === player.id;
    const queued = player.queue.find((item) => item.cell === selectedCell);
    const priority =
      selectedCell === null
        ? 0
        : (player.priorities[String(selectedCell)] ?? 0);
    const count =
      selectedCell === null
        ? 0
        : world.particles.filter(
            (p) =>
              p.ownerId === (structure?.ownerId ?? player.id) &&
              p.cell === selectedCell &&
              p.mode === "stationed",
          ).length;
    const incoming =
      selectedCell === null
        ? []
        : world.particles.filter(
            (p) =>
              p.ownerId === (structure?.ownerId ?? player.id) &&
              p.to === selectedCell &&
              p.mode === "transit",
          );
    const worker = player.worker;
    const sprite = (name: string) =>
      dependencies.sprites?.[`${name}-v2`] ?? dependencies.sprites?.[name];
    const portrait = structure
      ? structure.kind === "neuron"
        ? neuronPortraitUrl(world, structure.cell)
        : structure.kind === "spore"
          ? sporeIconUrl(
              world.players.find((p) => p.id === structure.ownerId)?.slot ?? 0,
            )
          : sprite(structureArt(structure.kind))
      : cell?.terrain === "deposit"
        ? sprite(`deposit-${cell.resourceKind}`)
        : sprite(
            cell?.terrain === "blocked" ? "blocker-boulder" : "terrain-slate-a",
          );
    const powerup = world.powerups.find((p) => p.cell === selectedCell);
    const detail =
      selectedCell === null
        ? '<div class="selection-summary"><strong>Select a hex</strong><span>Click terrain to build or inspect.</span></div>'
        : `<div class="selection-summary"><div class="tile-heading"><span>HEX ${selectedCell}</span><strong>${structure ? `${structure.kind.toUpperCase()} · ${structure.hp} HP` : powerup ? `POWERUP · ${POWERUP_PRESENTATION[powerup.kind].label.toUpperCase()}` : cell?.terrain === "deposit" ? `${cell.resourceKind.toUpperCase()} DEPOSIT` : cell?.terrain === "blocked" ? "BLOCKED GROUND" : "OPEN GROUND"}</strong></div>
        ${powerup ? `<span>${escape(POWERUP_PRESENTATION[powerup.kind].description)} Fades in ${Math.ceil((powerup.expiresAt - world.tick) / RULES.ticksPerSecond)}s. Touch it with your connected network to claim it; two networks touching it keep it contested.</span>` : ""}
        ${structure ? `<span title="${structure.connected ? "Connected to brain" : "Disconnected from brain"}${incoming.length ? ` · next arrival in ${Math.ceil((Math.min(...incoming.map((p) => p.arrivesAt)) - world.tick) / RULES.ticksPerSecond)}s` : ""}">${structure.connected ? "Connected" : "Disconnected"} · ${count} particles · ${incoming.length} incoming</span>` : ""}
        ${cell?.terrain === "deposit" ? '<span title="Connected neighboring structures harvest this deposit. Several players may share it.">Expand alongside to mine.</span>' : ""}</div>
        ${owned && canAttack(structure.kind) ? `${priority === 0 && structure.kind !== "brain" ? '<span class="supply-warning">No supply assigned — use D / Charge to arm this node.</span>' : ""}<div class="priority-control"><label class="field-label" for="priority-slider">Attack priority · ${priority}/3</label><input id="priority-slider" data-field="priority" type="range" min="0" max="3" step="1" value="${priority}"></div>` : ""}
        ${structure && STRUCTURES[structure.kind].miningBonus ? `<span class="economic-summary" title="One specialist bonus per deposit per player. Requires a connection to the brain. No attack supply needed.">${structure.connected ? "Extracting" : "Extraction paused"} · +${STRUCTURES[structure.kind].miningBonus} shares/deposit · non-stacking</span>` : ""}
        ${
          queued
            ? `<span class="construction-progress" title="Queued construction waits for support, builder and resources.">${
                queued.paid
                  ? `${queued.upgradeFrom !== undefined ? "Specializing" : "Growing"} · ${Math.ceil((queued.duration - queued.progress) / RULES.ticksPerSecond)}s remaining`
                  : waitingText(
                      constructionDispatchAvailability(world, player, queued)
                        .missing,
                      planSupport(world, player).get(queued.cell),
                    )
                      .map(escape)
                      .join(" ") || "Ready for construction"
              }</span>`
            : ""
        }`;
    const researchNames = Object.fromEntries(
      Object.entries(RESEARCH_PRESENTATION).map(([id, item]) => [
        id,
        item.label,
      ]),
    );
    const commands = renderCommands(
      world,
      player,
      selectedCell,
      panel,
      commandPage,
      dependencies.sprites,
      placement,
    );
    const outcomes = notices
      .filter((item) => item.playerId === player.id)
      .slice(-3)
      .map(
        (item) =>
          `<li>${escape(item.type)}${item.reason ? ` · ${escape(item.reason)}` : ""}${item.cell !== undefined ? ` at hex ${item.cell}` : ""}</li>`,
      )
      .join("");
    const placementRequirements =
      placement && placementCell !== null
        ? constructionQueueAvailability(world, player, placement, placementCell)
        : null;
    const placementHints =
      placementRequirements?.allowed && placement && placementCell !== null
        ? constructionDispatchAvailability(world, player, {
            kind: placement,
            cell: placementCell,
            upgradeFrom: constructionUpgradeSource(
              world,
              player,
              placement,
              placementCell,
            )?.id,
          }).missing
        : (placementRequirements?.missing ?? []);
    const upgrading =
      placement &&
      placementCell !== null &&
      constructionUpgradeSource(world, player, placement, placementCell);
    const neuronPlan =
      placement === "neuron" && placementCell !== null
        ? planNeuronPlacement(world, player, placementCell)
        : null;
    const contextDetail = placement
      ? `<div class="placement-instructions" role="status"><strong>${upgrading ? "Upgrade neuron to" : "Place"} ${BUILD_PRESENTATION[placement].label}</strong><p>Shift: queue more · Esc / S: cancel</p><small>${escape(placementMessage) || escape(neuronPlan?.hint ?? "") || (placementRequirements?.allowed && placement && placementCell !== null ? waitingText(placementHints, planSupport(world, player, { cell: placementCell, kind: placement }).get(placementCell)) : placementHints.map(requirementText)).map(escape).join(" ") || (upgrading ? "Neuron stays connected during work. Damage carries over." : CONSTRUCTIONS[placement].upgradesFrom?.length ? "Choose open ground or upgrade your neuron." : "Click or tap open ground.")}</small></div>`
      : panel === "inspect" || panel === "build"
        ? `${detail}<span class="construction-summary">${player.queue.length}/${RULES.queueLimit} queued · builder ${escape(worker.mode)}</span>`
        : panel === "particles"
          ? `<div class="command-context"><strong>Particle profile · ${escape(player.particleKind)}</strong><p>Refit at the brain</p><small>Existing particles change on return or departure. Your finite pool stays the same size.</small></div>`
          : panel === "research"
            ? `<div class="command-context"><strong>Research</strong><p>${player.researchJob ? `${researchNames[player.researchJob.kind]} · researching` : "Choose an upgrade"}</p><small>${player.research.length ? `Complete: ${player.research.map((r) => researchNames[r]).join(", ")}` : "Hover or focus a command for its requirements."}</small></div>`
            : `<div class="command-context"><strong>Recent activity</strong><ul class="event-list" aria-live="polite">${outcomes || "<li>No recent activity.</li>"}</ul></div>`;
    return `<div class="battle-topbar"><div class="resource-row"><div><small>BIOMASS</small><strong>◈ ${units(player.biomass)}</strong></div><div><small>INSIGHT</small><strong>◇ ${units(player.insight)}</strong></div>${territoryChips(world, player)}${buffChips(world, player)}</div><div class="hud-mini"></div>${dependencies.debug ? '<div class="debug-note"></div>' : ""}<div class="session-controls">${fullscreenButton()}<button data-action="help" class="secondary" aria-label="How to play" title="How to play">?</button>${online ? "" : '<button data-action="reset" class="secondary">Reset</button>'}</div></div>
      <div class="command-dock">${minimapMarkup(world)}<section class="inspector" aria-label="${panel === "inspect" || panel === "build" ? "Selected hex" : panel === "research" ? "Research" : "Recent activity"}">${portrait ? `<div class="selection-portrait"><img style="filter:${structure && structure.kind !== "neuron" && structure.kind !== "spore" ? teamArtFilter(world.players.find((p) => p.id === structure.ownerId)?.slot ?? 0) : "none"}" src="${escape(portrait)}" alt="" draggable="false"></div>` : ""}<div class="selection-details">${contextDetail}</div></section><nav class="command-card" data-panel="${panel}" aria-label="${panel === "research" ? "Research commands" : panel === "build" ? "Build commands" : panel === "activity" ? "Activity commands" : "Commands"}">${commands}</nav></div>`;
  }

  function renderGame() {
    const world = gameWorld();
    if (!world) return;
    // Online, the seat stays this device's once the match is over and
    // control ends: it still hears and reads its own victory or defeat.
    const playing = participant(world);
    const self = playing ? (session?.localPlayerId ?? null) : null;
    dependencies.audio?.present(world, self ?? "", soundLocator(world));
    if (world.matchId !== noticeMatch || world.tick < noticeTick) {
      notices = [];
      noticeTick = -1;
      noticeMatch = world.matchId;
    }
    if (world.tick !== noticeTick) {
      notices = [
        ...notices.filter((e) => e.tick > world.tick - 120),
        ...world.outcomes.filter((e) => e.type !== "income"),
      ].slice(-12);
      noticeTick = world.tick;
    }
    const svg = root.querySelector<SVGSVGElement>("#nd-board");
    const sidebar = root.querySelector<HTMLElement>("#game-sidebar");
    if (!svg || !sidebar) return;
    if (!world.finished) {
      liveResults.clear();
      shownReport = null;
    } else {
      const layout = root.querySelector(".game-layout");
      if (layout && results.element.parentElement !== layout)
        layout.append(results.element);
      const room = online?.room();
      const players = reportPlayers(
        world,
        self,
        (id) => room?.seats.find((seat) => seat.id === id)?.name,
      );
      const result = matchResult(world, players, {
        self,
        bot: (id) =>
          room ? !!room.seats.find((seat) => seat.id === id)?.bot : id !== self,
        openings: new Map(
          [...aiOpenings(world)].map(([id, kind]) => [id, OPENINGS[kind].name]),
        ),
        room: room ? { host: room.manager } : null,
      });
      liveResults.render(result, {
        friends: dependencies.friends,
        revision: world.matchId,
        report(result, friend) {
          shownReport = { world, players };
          updateContent(reportFindings, findingsMarkup(world, players, self));
          updateContent(
            reportChart,
            chartPanelMarkup(world, players, reportMetric),
          );
          updateContent(reportBreakdown, breakdownMarkup(world, players));
          return resultReport(result, {
            friend,
            findings: [reportFindings],
            chart: [reportChart],
            breakdown: [reportBreakdown],
          });
        },
        bar: resultBar,
      });
    }
    updateContent(sidebar, sidebarMarkup(world));
    gameMenu.update({
      canLobby: !!online?.room().manager,
      spectator: !playing,
      touch: dependencies.touch,
    });
    const boardShell = root.querySelector(".board-shell");
    if (boardShell && roundControls.element.parentElement !== boardShell)
      boardShell.append(roundControls.element);
    roundControls.update({
      round: world.matchId,
      visible: !world.finished && world.tick < RULES.ticksPerSecond * 8,
      spectator: !playing,
      touch: dependencies.touch,
    });
    renderCoach(world);
    renderDominance(world);
    const rate = sidebar.querySelector<HTMLElement>(".hud-mini");
    const income = (resource: "biomass" | "insight") =>
      (world.outcomes
        .filter(
          (e) =>
            e.type === "income" &&
            e.playerId === session?.localPlayerId &&
            e.resource === resource,
        )
        .reduce((sum, e) => sum + (e.amount ?? 0), 0) *
        20) /
      1000;
    if (rate)
      rate.textContent = `${Math.floor(world.tick / RULES.ticksPerSecond / 60)}:${String(Math.floor(world.tick / RULES.ticksPerSecond) % 60).padStart(2, "0")}${playing ? ` · +${income("biomass").toFixed(1)} ◈ / s · +${income("insight").toFixed(1)} ◇ / s` : online ? " · Spectating" : " · AI vs AI"}`;
    const debugNote = sidebar.querySelector<HTMLElement>(".debug-note");
    if (debugNote)
      debugNote.textContent = `DEBUG · grid${world.settings.instantConstruction ? " · instant build" : ""}${world.settings.instantResearch ? " · instant research" : ""} · normal travel`;
    const lightCanvas = root.querySelector<HTMLCanvasElement>("#nd-light");
    if (lightCanvas !== lightTarget) {
      lightTarget = lightCanvas;
      lightRenderer?.destroy?.();
      lightRenderer =
        (lightCanvas && dependencies.createLightRenderer?.(lightCanvas)) ??
        undefined;
    }
    animation = renderBoard(
      svg,
      world,
      selectedCell,
      dependencies.debug,
      preferences.reducedMotion,
      dependencies.animationClock(),
      dependencies.sprites,
      dependencies.buildingSprites,
      lightRenderer,
    );
    let preview = svg.querySelector<SVGGElement>(".placement-preview");
    if (!preview) {
      preview = svg.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "g",
      );
      preview.setAttribute("class", "placement-preview");
      preview.setAttribute("pointer-events", "none");
      svg.append(preview);
    }
    const owner = world.players.find((p) => p.id === session?.localPlayerId);
    root.classList.toggle("is-placing", placement !== null);
    // The brain's artwork covers the hexes around it, so the hex that looks
    // beside the core can be two steps away. Outline the hexes that touch the
    // connected network: a plan there starts at once.
    const frontier =
      placement && owner
        ? `<g class="placement-frontier">${connectedFrontier(
            world,
            owner,
            placement,
          )
            .map(
              (cell) =>
                `<polygon data-cell="${cell}" points="${hexPoints(world.map.width, cell, 4)}"/>`,
            )
            .join("")}</g>`
        : "";
    if (placement && placementCell !== null && owner) {
      const plan =
        placement === "neuron"
          ? planNeuronPlacement(world, owner, placementCell)
          : null;
      const valid =
        constructionQueueAvailability(world, owner, placement, placementCell)
          .allowed &&
        (!plan || plan.cells.length > 0);
      preview.setAttribute("data-valid", String(valid));
      preview.setAttribute(
        "data-support",
        plan?.hint && plan.cells.length > 0
          ? "chained"
          : (planSupport(world, owner, {
              cell: placementCell,
              kind: placement,
            }).get(placementCell) ?? "connected"),
      );
      preview.setAttribute(
        "data-upgrade",
        String(
          !!constructionUpgradeSource(world, owner, placement, placementCell),
        ),
      );
      const artwork = `<g opacity="0.55">${structureArtwork(world.map.width, placementCell, placement, owner.slot, dependencies.sprites)}</g>`;
      const bridge =
        plan?.cells
          .slice(0, -1)
          .map(
            (cell) =>
              `<polygon class="placement-bridge" data-cell="${cell}" points="${hexPoints(world.map.width, cell, 1.5)}"/>`,
          )
          .join("") ?? "";
      preview.innerHTML = `${frontier}${bridge}<polygon points="${hexPoints(world.map.width, placementCell, 1.5)}"/>${artwork}`;
    } else {
      if (frontier) preview.innerHTML = frontier;
      else preview.replaceChildren();
      preview.removeAttribute("data-valid");
      preview.removeAttribute("data-support");
      preview.removeAttribute("data-upgrade");
    }
    const viewport = root.querySelector<HTMLElement>("#nd-viewport");
    if (!camera && viewport && dependencies.createCamera) {
      camera = dependencies.createCamera(svg, viewport);
      camera.setEdgeScroll(preferences.edgeScroll);
      const player = world.players.find((p) => p.id === session?.localPlayerId);
      const brain = world.structures.find(
        (s) => s.ownerId === player?.id && s.kind === "brain",
      );
      if (brain) camera.focusCell(world.map.width, brain.cell);
      svg.focus?.({ preventScroll: true });
    }
    camera?.refresh();
  }

  function multiplayerMarkup(): string {
    return `${header("Multiplayer")}<main class="setup-layout multiplayer-layout"><section class="nd-panel"><p class="section-index">01 / NEW ROOM</p><h2>Host a Versus match</h2><p>Create a room, share its code or link, add bots if you like, and start when everyone has joined. Two to ${MAX_ROOM_SEATS_TEXT} networks depending on the map, one brain each.</p><button data-action="create-room" class="primary" ${creatingRoom ? "disabled" : ""}>${creatingRoom ? "Creating…" : "Create room"}</button></section><section class="nd-panel"><p class="section-index">02 / JOIN</p><h2>Join a friend</h2><label class="field-label" for="room-code">Room code</label><div class="join-row"><input id="room-code" data-field="room-code" autocomplete="off" spellcheck="false" maxlength="12" value="${escape(roomCode)}" placeholder="CODE"><button data-action="join-room" class="primary">Join</button></div>${roomError ? `<p class="error-card" role="alert">${escape(roomError)}</p>` : ""}</section></main>`;
  }

  function roomMarkup(): string {
    const room = online?.room();
    if (!online || !room) return multiplayerMarkup();
    if (room.closed)
      return `${header("Versus room", { back: "leave-room" })}<main class="setup-layout"><section class="nd-panel"><h2>${room.closed === "kicked" ? "The host removed you from the room" : "The room has ended"}</h2><div class="button-row"><button data-action="leave-room" class="primary">Back to menu</button></div></section></main>`;
    const players = room.seats.filter((seat) => !seat.watcher);
    const seated = players.some((seat) => seat.id === room.self);
    const capacity = ROOM_MAPS.find((map) => map.id === room.mapId)?.seats ?? 2;
    const ready = players.filter((seat) => seat.connected).length;
    const canStart = room.manager && ready >= 2 && ready <= capacity;
    // The shared roster's row: the name, HOST on whoever holds Start, what the seat is, then ADD FRIEND (`decorate`
    // fills its place once the seat is matched to an account) and the host's REMOVE on an AI.
    const seatRows = players.map(
      (seat) =>
        `<li class="fui-roster-row room-seat${seat.connected ? "" : " away"}" style="--rider-color:${TEAM_COLORS[seat.slot] ?? "#63cfff"}"><div class="fui-roster-info"><strong class="fui-roster-name">${escape(seat.name)}${seat.id === room.self ? " (you)" : ""}</strong>${seat.id === room.managerId ? '<span class="fui-roster-host">HOST</span>' : ""}<small class="fui-roster-status">${seat.bot ? "AI" : seat.connected ? "" : "Away"}</small></div>${seat.bot ? "" : `<span id="seat-friend-${escape(seat.id)}" class="seat-friend" data-member="${escape(seat.id)}" data-fui-preserve></span>`}${room.manager && seat.bot && room.stage === "lobby" ? `<button data-action="remove-bot" data-bot-id="${escape(seat.id)}" class="secondary small" aria-label="Remove ${escape(seat.name)}">REMOVE</button>` : ""}</li>`,
    );
    const disabled = room.manager && room.stage === "lobby" ? "" : "disabled";
    return (
      header() +
      roomLayoutMarkup({
        actionsInHeader: true,
        heading: "Room",
        occupied: players.length,
        occupiedSlots: players.map((seat) => seat.slot),
        slotPlayers: players.map((seat, index) => ({
          slot: seat.slot,
          html: seatRows[index]!,
        })),
        canJoin: !seated,
        // Seated already: any open seat is a move, and the team colour is the seat's.
        canMove: seated && room.stage === "lobby",
        canAddAI:
          room.manager && room.stage === "lobby" && players.length < capacity,
        slotColors: TEAM_COLORS,
        capacity,
        // The code once, by the QR code, as in every game's room.
        invite: `<div class="fui-invite">${roomQr?.code === room.code ? `<img class="fui-invite-qr" src="${escape(roomQr.url)}" alt="Scan to join this room"><p class="fui-invite-caption">SCAN TO JOIN</p>` : ""}<strong class="fui-room-code">${escape(room.code)}</strong><button data-action="copy-room-link">COPY LINK</button>${dependencies.friends?.open ? '<button class="fui-room-invite-friends" data-action="invite-friends">INVITE FRIENDS</button>' : ""}</div>`,
        players: `<ul class="room-seats fui-roster"></ul>`,
        join: `${seated ? "" : `<div class="join-row"><label for="player-name">Your name</label><input id="player-name" data-field="player-name" maxlength="32" autocomplete="nickname" value="${escape(playerName)}" placeholder="Name"><button data-action="join-seat" class="primary">Join</button></div>`}`,
        settings: `<label for="room-map">Map</label><select id="room-map" data-field="room-map" ${disabled}>${ROOM_MAPS.map((map) => `<option value="${map.id}" ${map.id === room.mapId ? "selected" : ""}>${escape(map.title)} · ${map.seats} players</option>`).join("")}</select><label for="room-strategy">Bot opening</label><select id="room-strategy" data-field="room-strategy" ${disabled}>${openingOptions(room.aiStrategy)}</select><label class="toggle-field"><input type="checkbox" data-field="room-powerups" ${room.powerups ? "checked" : ""} ${disabled}> Random powerups</label>`,
        primaryAction: room.manager
          ? `<button data-action="start-room" class="primary" ${canStart ? "" : "disabled"}>START MATCH</button>`
          : undefined,
        mainMenu:
          '<button class="fui-back" data-action="leave-room" aria-label="Back">Back</button>',
        actions: !room.manager
          ? '<p class="room-note">Waiting for the host to start…</p>'
          : "",
        status: `<p class="room-status" role="status">${escape(room.stage === "connecting" ? "Connecting to the room…" : players.length > capacity ? `Too many players for this map: it seats ${capacity}. Pick a larger map or ask someone to leave.` : room.status)}</p>`,
      })
    );
  }

  function openRoom(code: string) {
    if (!dependencies.online) return;
    disposeSession();
    const created = dependencies.online.openRoom(code);
    online = created;
    session = created;
    panel = "inspect";
    placement = null;
    placementCell = null;
    autoSeated = false;
    unsubscribe = created.subscribe(onRoomChange);
    screen = "room";
    render();
    const link = dependencies.online.roomLink(code);
    void dependencies.online
      .qr?.(link)
      .then((url) => {
        roomQr = { code, url };
        if (screen === "room") render();
      })
      .catch(() => {});
  }

  /** Follows the room between its lobby and the battlefield. */
  function onRoomChange() {
    if (!online || disposed) return;
    const room = online.room();
    const playing = room.stage === "running" || room.stage === "over";
    // Opening or entering a room is taking a seat in it: once, for a viewer whose name is known, whichever seat is
    // free. "Sit here" moves the player from there, and a seat given up later is not retaken.
    if (!autoSeated && room.stage === "lobby" && !room.closed) {
      autoSeated = true;
      const name = (dependencies.online?.savedName() || playerName).trim();
      if (name && !room.seats.some((seat) => seat.id === room.self))
        online.join(name);
    }
    if (screen === "room" && playing && !room.closed) {
      helpOpen = false;
      selectedCell =
        online
          .view()
          .structures.find(
            (s) => s.ownerId === online?.localPlayerId && s.kind === "brain",
          )?.cell ?? null;
      screen = "game";
      render();
      return;
    }
    if (screen === "game" && (!playing || room.closed)) {
      gameMenu.close();
      camera?.dispose();
      camera = null;
      pending = null;
      helpOpen = false;
      screen = "room";
      render();
      return;
    }
    if (screen === "room") {
      const nameOpen =
        root.querySelector<HTMLDialogElement>("[data-room-name]")?.open;
      const backgroundNodes = [
        ...(roomBackground?.root.querySelectorAll(
          ":scope > .fui-attract, :scope > .fui-attract-toggle",
        ) ?? []),
      ];
      backgroundNodes.forEach((node) => node.remove());
      const settingsOpen = root.querySelector<HTMLDialogElement>(
        "[data-room-settings]",
      )?.open;
      updateContent(root, roomMarkup());
      if (roomBackground?.root.isConnected)
        roomBackground.root.append(...backgroundNodes);
      decorate();
      if (nameOpen)
        root.querySelector<HTMLDialogElement>("[data-room-name]")?.showModal();
      if (settingsOpen)
        root
          .querySelector<HTMLDialogElement>("[data-room-settings]")
          ?.showModal();
      return;
    }
    if (screen === "game") renderGame();
  }

  async function createRoom() {
    if (!dependencies.online || creatingRoom) return;
    creatingRoom = true;
    roomError = null;
    render();
    try {
      const { code } = await dependencies.online.createRoom();
      // Someone who left the multiplayer screen meanwhile stays where they went.
      if (disposed || screen !== "multiplayer") return;
      dependencies.online.enterRoom(code);
      openRoom(code);
    } catch (error) {
      roomError =
        error instanceof Error
          ? error.message
          : "The room could not be created.";
    } finally {
      creatingRoom = false;
      if (screen === "multiplayer") render();
    }
  }

  function joinRoom() {
    const code = roomCode.trim().toUpperCase();
    if (!dependencies.online?.validCode(code)) {
      roomError = "That is not a room code: check it and try again.";
      render();
      return;
    }
    roomError = null;
    dependencies.online.enterRoom(code);
    openRoom(code);
  }

  function render() {
    if (disposed) return;
    const battlefield = root.querySelector<HTMLElement>(".game-layout");
    const modalHost = root.querySelector<HTMLElement>("#game-modal");
    if (screen === "game" && battlefield && modalHost) {
      battlefield.toggleAttribute("inert", pending !== null || helpOpen);
      modalHost.innerHTML = modal();
      renderGame();
      // A relaunch from the battlefield disposed the old session's loop.
      frame ??= dependencies.requestFrame(animate);
      focusModal(modalHost);
      return;
    }
    camera?.dispose();
    camera = null;
    root.className = `fui-app nd-app screen-${screen}`;
    roomBackground?.stop();
    roomBackground = undefined;
    root.innerHTML =
      screen === "menu"
        ? menuMarkup()
        : screen === "setup"
          ? setupMarkup()
          : screen === "multiplayer"
            ? multiplayerMarkup()
            : screen === "guide"
              ? guideScreenMarkup()
              : screen === "room"
                ? roomMarkup()
                : gameMarkup();
    decorate();
    if (screen === "menu") {
      const play = root.querySelector<HTMLElement>(".menu-layout")!;
      const marker = root.ownerDocument.createComment("Shared menu");
      play.before(marker);
      const singlePlayerOptions = root.ownerDocument.createElement("div");
      singlePlayerOptions.className = "fui-single-player-options";
      const newGame = play.querySelector<HTMLElement>(
        '[data-action="new-game"]',
      )!;
      newGame.textContent = "New game";
      singlePlayerOptions.append(
        newGame,
        play.querySelector<HTMLElement>('[data-action="tutorial"]')!,
      );
      const menu = createMainMenu({
        background: async (host) =>
          (await import("./attract.js")).createAttract(host),
        title: "FUSE CRAFT",
        description: "Build your network. Keep the signal alive.",
        play,
        singlePlayerContent: [singlePlayerOptions],
        onJoinRoom: () => {
          roomError = null;
          screen = "multiplayer";
          render();
        },
        onPlay: dependencies.online
          ? async () => {
              screen = "multiplayer";
              await createRoom();
            }
          : () => {
              screen = "setup";
              render();
            },
        onHowToPlay: () => {
          screen = "guide";
          render();
        },
      });
      marker.replaceWith(menu.element);
      const scenery = root.querySelector<SVGSVGElement>("#nd-attract-board");
      if (scenery)
        renderBoard(
          scenery,
          attractScene,
          null,
          false,
          true,
          0,
          dependencies.sprites,
          dependencies.buildingSprites,
        );
    }
    if (screen === "game") {
      stopAnimation();
      renderGame();
      frame = dependencies.requestFrame(animate);
      focusModal(root);
    }
  }

  /** Fuse styling and the app portal, after the page markup is replaced or reconciled. */
  function decorate() {
    const roomRoot =
      screen === "room"
        ? root.querySelector<HTMLElement>(".fui-room-layout")
        : null;
    if (roomRoot && roomBackground?.root !== roomRoot) {
      roomBackground?.stop();
      roomBackground = {
        root: roomRoot,
        stop: mountAttract(roomRoot, async (host) =>
          (await import("./attract.js")).createAttract(host),
        ),
      };
    }
    root
      .querySelectorAll<HTMLElement>(".primary")
      .forEach((button) => button.classList.add("fui-button-primary"));
    // One portal element survives re-renders, so an open grid stays open.
    // Reconciling a header drops it, so it goes back first in each header.
    // ADD FRIEND on a seat's row, once the room has matched the seat to an account. The row's place for it is
    // kept across re-renders (`data-fui-preserve`), so the button is made once per account.
    for (const place of root.querySelectorAll<HTMLElement>(".seat-friend")) {
      const publicId = dependencies.friends?.publicIdOfMember(
        place.dataset.member ?? "",
      );
      if ((place.dataset.account ?? "") === (publicId ?? "")) continue;
      place.dataset.account = publicId ?? "";
      const button = publicId
        ? dependencies.friends?.friendButton(publicId)
        : undefined;
      button?.classList.add("fui-roster-friend");
      place.replaceChildren(...(button ? [button] : []));
    }
    const head = root.querySelector(".nd-header");
    if (head && dependencies.social) {
      const social = dependencies.social();
      if (!head.contains(social)) head.append(social);
    }
    if (head && dependencies.portal) {
      portal ??= dependencies.portal();
      if (!head.contains(portal)) head.prepend(portal);
    }
    if (head) {
      if (screen === "game" && !head.contains(gameMenu.element))
        head.append(gameMenu.element);
      createTopBar({
        playerOptions,
        onOpenChange: menuInputChanged,
        element: head as HTMLElement,
        gameId: "fuse-craft",
        sound: dependencies.audio
          ? {
              enabled: () => !preferences.mute,
              forcedMute: dependencies.forcedMute,
              setEnabled(on) {
                if (on === preferences.mute) toggleMute();
              },
            }
          : undefined,
      });
    }
  }

  /**
   * Puts focus inside an open dialog after its markup is rebuilt, so Escape
   * and Tab reach it: the confirmation's safe choice, or the guide's open tab.
   */
  function focusModal(host: ParentNode) {
    const control = pending
      ? host.querySelector<HTMLElement>('[data-action="cancel-confirm"]')
      : helpOpen
        ? (host.querySelector<HTMLElement>(
            `[role="dialog"] [data-section="${guideSection}"]`,
          ) ??
          host.querySelector<HTMLElement>(
            '[role="dialog"] [data-action="close-help"]',
          ))
        : null;
    control?.focus?.();
  }

  function openHelp() {
    const active = root.ownerDocument.activeElement;
    helpReturn =
      active && root.contains(active) ? (active as HTMLElement) : null;
    helpOpen = true;
    render();
    root
      .querySelector<HTMLElement>('[role="dialog"] [data-action="close-help"]')
      ?.focus?.();
  }

  function closeHelp() {
    helpOpen = false;
    render();
    // Back to where the player was, or the help button that opened it.
    const back =
      helpReturn?.isConnected && root.contains(helpReturn)
        ? helpReturn
        : root.querySelector<HTMLElement>('[data-action="help"]');
    helpReturn = null;
    back?.focus?.({ preventScroll: true });
  }

  function dispatch(action: Action) {
    if (!session?.canControl) return;
    session?.dispatch(action);
    renderGame();
  }

  function closePanel() {
    placement = null;
    placementCell = null;
    const previous = panel;
    panel = "inspect";
    commandPage = 0;
    renderGame();
    root
      .querySelector<HTMLButtonElement>(`[data-action="panel-${previous}"]`)
      ?.focus?.();
  }

  function switchPanel(next: string) {
    placement = null;
    placementCell = null;
    switch (next) {
      case "inspect":
      case "build":
      case "research":
      case "activity":
      case "particles":
        panel = panel === next ? "inspect" : next;
    }
    dependencies.audio?.play(panel === "inspect" ? "back" : "panel");
    commandPage = 0;
    renderGame();
    if (panel !== "inspect")
      root
        .querySelector<HTMLButtonElement>(
          '.command-card [data-action="close-panel"]',
        )
        ?.focus?.();
  }

  function setupFromMenu() {
    screen = "setup";
    mode = "skirmish";
    selectedId = DEFAULT_MAP;
    void loadCatalog();
  }

  function chooseMode(next: GameMode, mapId: string) {
    mode = next;
    void loadSelectedMap(mapId);
  }

  const slotAt = (target: Element): number =>
    Number(target.closest<HTMLElement>("[data-slot]")?.dataset.slot);

  function takeSlot(target: Element) {
    if (!online) return;
    playerName = dependencies.online?.savedName() || playerName;
    roomJoinSlot = slotAt(target);
    const name = playerName.trim();
    if (name) online.join(name, roomJoinSlot);
    else {
      root.querySelector<HTMLDialogElement>("[data-room-name]")?.showModal();
      root.querySelector<HTMLInputElement>("#player-name")?.focus();
    }
  }

  function moveSlot(target: Element) {
    if (!online) return;
    const room = online.room();
    const own = room.seats.find(
      (seat) => seat.id === room.self && !seat.watcher,
    );
    const slot = slotAt(target);
    if (own && Number.isInteger(slot)) online.join(own.name, slot);
  }

  function closeRoomName() {
    root.querySelector<HTMLDialogElement>("[data-room-name]")?.close();
  }

  function confirmSeat() {
    if (!online) return;
    const name = playerName.trim();
    if (!name) return;
    dependencies.online?.saveName(name);
    online.join(name, roomJoinSlot);
    closeRoomName();
  }

  function changeReportMetric(target: Element) {
    const metric = target.closest<HTMLElement>("[data-metric]")?.dataset.metric;
    const chosen = REPORT_METRICS.find((m) => m.id === metric);
    if (chosen) reportMetric = chosen.id;
    if (shownReport)
      updateContent(
        reportChart,
        chartPanelMarkup(shownReport.world, shownReport.players, reportMetric),
      );
  }

  function renderAndFocusBoard() {
    renderGame();
    root
      .querySelector<SVGSVGElement>("#nd-board")
      ?.focus?.({ preventScroll: true });
  }

  function beginPlacement(kind: string) {
    const owner = session
      ?.view()
      .players.find((p) => p.id === session?.localPlayerId);
    if (
      !isBuildKind(kind) ||
      !owner ||
      !constructionAvailability(owner, kind).allowed
    ) {
      dependencies.audio?.play("invalid");
      return;
    }
    dependencies.audio?.play("panel");
    placement = kind;
    placementCell = null;
    renderAndFocusBoard();
  }

  function selectedOwnStructure() {
    if (!session || selectedCell === null) return;
    const world = session.view();
    const owner = world.players.find((p) => p.id === session?.localPlayerId);
    if (!owner) return;
    const structure = world.structures.find(
      (s) => s.cell === selectedCell && s.ownerId === owner.id,
    );
    if (structure) return { owner, structure };
  }

  function askToExit(next: "reset" | "leave") {
    if (session?.view().finished) {
      if (next === "reset") restart();
      else showMenu();
      return;
    }
    pending = next;
    render();
  }

  const clickActions = new Map<string, (target: Element) => void>([
    // Setup, tutorial, and navigation.
    [
      "guide",
      () => {
        screen = "guide";
        render();
      },
    ],
    [
      "guide-section",
      (target) => {
        const section =
          target.closest<HTMLElement>("[data-section]")?.dataset.section;
        if (isGuideSection(section)) guideSection = section;
        render();
      },
    ],
    ["help", openHelp],
    ["close-help", closeHelp],
    ["fullscreen", () => dependencies.fullscreen?.toggle()],
    ["tutorial", () => void startTutorial()],
    [
      "tutorial-next",
      () => {
        if (!tutorial) return;
        tutorial = {
          step: Math.min(tutorial.step + 1, TUTORIAL_STEPS.length - 1),
        };
        renderGame();
      },
    ],
    [
      "tutorial-close",
      () => {
        tutorial = null;
        renderGame();
      },
    ],
    [
      "tutorial-play",
      () => {
        tutorial = null;
        disposeSession();
        aiStrategy = "economy";
        setupFromMenu();
      },
    ],
    ["new-game", setupFromMenu],
    ["back-menu", showMenu],
    ["retry-catalog", () => void loadCatalog()],
    [
      "retry-map",
      () => {
        if (selectedId) void loadSelectedMap(selectedId);
      },
    ],
    ["mode-sandbox", () => chooseMode("sandbox", "sandbox-12")],
    ["mode-combat-lab", () => chooseMode("combat-lab", "combat-lab-12")],
    ["mode-skirmish", () => chooseMode("skirmish", DEFAULT_MAP)],
    ["mode-watch", () => chooseMode("watch", DEFAULT_MAP)],
    ["start", launch],

    // Room seats and lifecycle.
    [
      "multiplayer",
      () => {
        roomError = null;
        screen = "multiplayer";
        render();
      },
    ],
    ["create-room", () => void createRoom()],
    ["join-room", joinRoom],
    ["take-slot", takeSlot],
    ["move-slot", moveSlot],
    ["close-room-name", closeRoomName],
    ["join-seat", confirmSeat],
    ["add-bot", (target) => online?.addBot(slotAt(target))],
    [
      "remove-bot",
      (target) => {
        const id = target.closest<HTMLElement>("[data-bot-id]")?.dataset.botId;
        if (id) online?.removeBot(id);
      },
    ],
    ["start-room", () => online?.start()],
    ["rematch-room", () => online?.rematch()],
    ["lobby-room", () => online?.lobby()],
    ["leave-room", showMenu],
    ["invite-friends", () => dependencies.friends?.open?.()],
    [
      "copy-room-link",
      () => {
        if (!online) return;
        const link = dependencies.online?.roomLink(online.code) ?? "";
        void navigator.clipboard?.writeText(link).catch(() => {});
      },
    ],

    // Board and match controls.
    ["close-panel", closePanel],
    [
      "next-command-page",
      () => {
        commandPage = (commandPage + 1) % commandPageCount(panel);
        renderGame();
      },
    ],
    [
      "cancel-placement",
      () => {
        placement = null;
        placementCell = null;
        renderAndFocusBoard();
      },
    ],
    [
      "auto-expand",
      () => {
        const selected = selectedOwnStructure();
        if (selected?.structure.kind === "brain")
          dispatch({
            type: "setAutoExpand",
            enabled: !selected.owner.autoExpand,
          });
      },
    ],
    [
      "charge",
      () => {
        const selected = selectedOwnStructure();
        if (!selected) return;
        const cell = selected.structure.cell;
        dispatch({
          type: "setPriority",
          cell,
          weight: selected.owner.priorities[cell] === 3 ? 0 : 3,
        });
      },
    ],
    [
      "cancel-build",
      () => {
        if (selectedCell !== null)
          dispatch({ type: "cancelConstruction", cell: selectedCell });
      },
    ],
    ["cancel-research", () => dispatch({ type: "cancelResearch" })],
    ["reset", () => askToExit("reset")],
    ["leave", () => askToExit("leave")],
    [
      "cancel-confirm",
      () => {
        pending = null;
        render();
      },
    ],
    ["confirm-reset", restart],
    ["confirm-leave", showMenu],
    ["report-metric", changeReportMetric],
  ]);

  function onActionClick(button: HTMLElement, target: Element) {
    const action = button.dataset.action;
    if (action === "open-room-settings" || action === "close-room-settings") {
      const settings = root.querySelector<HTMLDialogElement>(
        "[data-room-settings]",
      );
      if (action === "open-room-settings") settings?.showModal();
      else settings?.close();
      return;
    }
    if (button.getAttribute("aria-disabled") === "true") {
      dependencies.audio?.play("invalid");
      button.focus?.();
      return;
    }
    if (action?.startsWith("panel-")) {
      switchPanel(action.slice(6));
      return;
    }
    const cue = actionCue(action);
    if (cue) dependencies.audio?.play(cue);
    if (action?.startsWith("build-")) beginPlacement(action.slice(6));
    else if (action?.startsWith("particle-")) {
      const kind = action.slice(9);
      if (kind === "pulse" || kind === "heavy" || kind === "swift")
        dispatch({ type: "setParticleKind", kind });
    } else if (action?.startsWith("research-")) {
      const research = action.slice(9);
      if (isResearchKind(research))
        dispatch({ type: "startResearch", research });
    } else if (action) clickActions.get(action)?.(target);
  }

  function focusWatchedCell(
    world: Readonly<World>,
    cell: number | null | undefined,
  ) {
    if (cell === null || cell === undefined) return;
    selectedCell = cell;
    camera?.focusCell(world.map.width, cell);
    renderGame();
  }

  function onClick(event: MouseEvent) {
    if (playtestInputBlocked(root.ownerDocument)) return;
    dependencies.audio?.unlock();
    const target = event.target as Element;
    const watchedId = target.closest<HTMLElement>("[data-watch-player]")
      ?.dataset.watchPlayer;
    if (
      target.closest('[data-action="find-battle"]') &&
      session &&
      !session.canControl &&
      !pending
    ) {
      const world = session.view();
      focusWatchedCell(world, battleFocusCell(world));
      return;
    }
    if (watchedId && session && !session.canControl && !pending) {
      const world = session.view();
      const player = world.players.find((p) => p.id === watchedId);
      const cell =
        world.structures.find(
          (s) => s.ownerId === watchedId && s.kind === "brain",
        )?.cell ??
        world.map.spawns.find((s) => s.slot === player?.slot)?.cellIndex;
      focusWatchedCell(world, cell);
      return;
    }
    const tactical = target.closest<SVGSVGElement>("#nd-minimap");
    if (tactical && !pending) {
      minimapFocus(tactical, event.clientX, event.clientY);
      return;
    }
    const button = target.closest<HTMLElement>("[data-action]");
    if (button) return onActionClick(button, target);
    if (screen !== "game") return;
    const tile = target.closest<SVGElement>("[data-cell]");
    if (!tile) return;
    selectedCell = Number(tile.dataset.cell);
    if (placement) {
      placeAt(selectedCell, event.shiftKey);
      return;
    }
    if (panel !== "build") panel = "inspect";
    renderGame();
  }

  function placeAt(cell: number, keepPlacing = false) {
    if (!session?.canControl) return;
    const world = session?.view();
    const owner = world?.players.find((p) => p.id === session?.localPlayerId);
    placementCell = cell;
    placementMessage = "";
    if (
      placement &&
      world &&
      owner &&
      constructionQueueAvailability(world, owner, placement, cell).allowed
    ) {
      const kind = placement;
      const plan =
        kind === "neuron" ? planNeuronPlacement(world, owner, cell) : null;
      if (plan && !plan.cells.length) {
        renderGame();
        return;
      }
      const orders: Action[] = (plan?.cells ?? [cell]).map((next) => ({
        type: "queueConstruction",
        kind,
        cell: next,
      }));
      if (!session.dispatchBatch(orders)) {
        placementMessage = "Build orders are busy. Try again.";
        renderGame();
        return;
      }
      if (!keepPlacing) {
        placement = null;
        placementCell = null;
      }
      renderGame();
    } else {
      if (placement && world && owner) dependencies.audio?.play("invalid");
      renderGame();
    }
  }

  function onPointerMove(event: PointerEvent) {
    if (playtestInputBlocked(root.ownerDocument)) return;
    if (event.pointerId === minimapDrag) {
      const minimap = root.querySelector("#nd-minimap");
      if (minimap && event.buttons)
        minimapFocus(minimap, event.clientX, event.clientY);
      else minimapDrag = null;
      return;
    }
    if (!placement || pending || event.pointerType === "touch" || event.buttons)
      return;
    const tile = (event.target as Element).closest<SVGElement>(
      "#nd-board [data-cell]",
    );
    const cell = tile ? Number(tile.dataset.cell) : null;
    if (cell !== placementCell) {
      placementCell = cell;
      placementMessage = "";
      renderGame();
    }
  }

  /** Text fields keep their value as typed, so a re-render never loses it. */
  function onInput(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.dataset.field === "room-code") roomCode = target.value;
    if (target.dataset.field === "player-name") playerName = target.value;
  }

  function onChange(event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.dataset.debug && dependencies.debug) {
      if (target.dataset.debug === "construction")
        instantConstruction = (target as HTMLInputElement).checked;
      if (target.dataset.debug === "research")
        instantResearch = (target as HTMLInputElement).checked;
      return;
    }
    if (target.dataset.field === "room-code") {
      roomCode = target.value;
      return;
    }
    if (target.dataset.field === "player-name") {
      playerName = target.value;
      return;
    }
    if (target.dataset.field === "room-map" && online) {
      if (bundledMap(target.value)) online.configure({ mapId: target.value });
      return;
    }
    if (target.dataset.field === "room-strategy" && online) {
      if (isOpeningChoice(target.value))
        online.configure({ aiStrategy: target.value });
      return;
    }
    if (target.dataset.field === "room-powerups" && online) {
      online.configure({
        powerups: (target as HTMLInputElement).checked,
      });
      return;
    }
    if (target.dataset.field === "powerups") {
      powerups = (target as HTMLInputElement).checked;
      return;
    }
    if (target.dataset.field === "map") void loadSelectedMap(target.value);
    else if (
      target.dataset.field === "first-strategy" &&
      isOpeningChoice(target.value)
    )
      firstAiStrategy = target.value;
    else if (
      target.dataset.field === "strategy" &&
      isOpeningChoice(target.value)
    ) {
      aiStrategy = target.value;
    } else if (target.dataset.field === "spawn") {
      selectedSlot = Number(target.value);
      render();
    } else if (target.dataset.field === "priority" && selectedCell !== null) {
      dispatch({
        type: "setPriority",
        cell: selectedCell,
        weight: Number(target.value),
      });
      // The command may be queued or rejected. Once a drag is committed,
      // show the current authority until the next applied tick updates it.
      target.value = target.getAttribute("value") ?? "0";
    } else if (target.dataset.setting) {
      const setting = target.dataset.setting;
      if (setting === "reducedMotion")
        preferences = {
          ...preferences,
          reducedMotion: (target as HTMLInputElement).checked,
        };
      else if (setting === "edgeScroll") {
        preferences = {
          ...preferences,
          edgeScroll: (target as HTMLInputElement).checked,
        };
        camera?.setEdgeScroll(
          !root.querySelector(".fui-top-bar-menu[open]") &&
            preferences.edgeScroll,
        );
      } else if (setting === "volume")
        preferences = { ...preferences, volume: Number(target.value) };
      dependencies.preferences.write(preferences);
      dependencies.audio?.configure(preferences);
      dependencies.audio?.unlock();
      if (screen === "game") renderGame();
    }
  }

  /**
   * Escape closes How to play wherever focus is, even when it fell to the
   * page body, so it listens on the document rather than the app root. On a page with a head of its own it is
   * Back, as in every menu: not while a dialog, the game menu or the app portal is open (Escape is theirs), and
   * not from a field being typed in or a list being picked from. The room is left by its Back alone, as in
   * every game: Escape there does nothing.
   */
  function onDocumentKeyDown(event: KeyboardEvent) {
    if (playtestInputBlocked(root.ownerDocument)) return;
    if (event.key !== "Escape") return;
    if (helpOpen && screen === "game") {
      event.preventDefault();
      closeHelp();
      return;
    }
    if (pending || escapeIsTaken(event, root.ownerDocument)) return;
    if ((event.target as Element | null)?.closest?.("input, select, textarea"))
      return;
    const back = root.querySelector<HTMLElement>(".screen-heading .fui-back");
    if (!back) return;
    event.preventDefault();
    back.click();
  }

  function confirmationKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      pending = null;
      render();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    );
    const current = controls.findIndex(
      (control) => control === root.ownerDocument.activeElement,
    );
    const next = current + (event.shiftKey ? -1 : 1);
    event.preventDefault();
    controls[(next + controls.length) % controls.length]?.focus();
  }

  function cancelBoardMode(event: KeyboardEvent): boolean {
    if (event.key !== "Escape") return false;
    if (placement) {
      event.preventDefault();
      placement = null;
      placementCell = null;
      renderGame();
      return true;
    }
    if (panel === "inspect") return false;
    event.preventDefault();
    closePanel();
    return true;
  }

  function activateShortcut(event: KeyboardEvent): boolean {
    if (event.repeat) return false;
    const key = event.key.toLowerCase();
    if (key === "f" && dependencies.fullscreen) {
      event.preventDefault();
      dependencies.fullscreen.toggle();
      return true;
    }
    if (key === "m" && dependencies.audio && !dependencies.forcedMute) {
      event.preventDefault();
      toggleMute();
      return true;
    }
    if (key.length !== 1 || !"qweasd".includes(key)) return false;
    const command = root.querySelector<HTMLButtonElement>(
      `.command-card [aria-keyshortcuts="${key.toUpperCase()}"]`,
    );
    if (command) {
      event.preventDefault();
      command.click();
    }
    return true;
  }

  function moveSelection(
    map: MapDefinition,
    current: number,
    arrow: BoardArrow,
  ) {
    const { width, height } = map;
    const column = Math.max(
      0,
      Math.min(width - 1, (current % width) + arrow.column),
    );
    const row = Math.max(
      0,
      Math.min(height - 1, Math.floor(current / width) + arrow.row),
    );
    selectedCell = row * width + column;
    if (placement) placementCell = selectedCell;
    renderGame();
    camera?.ensureCellVisible(width, selectedCell);
  }

  function moveOrPlace(event: KeyboardEvent, arrow: BoardArrow | undefined) {
    const onMinimap = event.target === root.querySelector("#nd-minimap");
    if (!onMinimap && event.target !== root.querySelector("#nd-board")) return;
    const world = gameWorld();
    if (!world) return;
    const current = selectedCell ?? 0;
    if (onMinimap && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      camera?.focusCell(world.map.width, current);
      updateMinimapView();
      return;
    }
    if (arrow) {
      event.preventDefault();
      moveSelection(world.map, current, arrow);
      return;
    }
    if (event.key !== "Enter" || selectedCell === null) return;
    if (world.map.cells[selectedCell]?.terrain !== "open") return;
    event.preventDefault();
    if (placement) placeAt(selectedCell, event.shiftKey);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (playtestInputBlocked(root.ownerDocument)) return;
    if (gameMenu.isOpen() || root.querySelector(".fui-top-bar-menu[open]"))
      return;
    if (results.open || (helpOpen && screen === "game")) return;
    if (pending) {
      confirmationKey(event);
      return;
    }
    if (screen !== "game" || cancelBoardMode(event)) return;

    const arrow = BOARD_ARROWS.get(event.key);
    const target = event.target as Element | null;
    const acceptsShortcut =
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !target?.closest?.('input, select, textarea, [contenteditable="true"]');
    if (acceptsShortcut) {
      // Bare arrows pan while held; Shift+arrows and placement move the cursor.
      if (arrow && !placement && !event.shiftKey) {
        event.preventDefault();
        camera?.hold(arrow.pan, true);
        return;
      }
      if (activateShortcut(event)) return;
    }
    moveOrPlace(event, arrow);
  }

  root.addEventListener("click", onClick);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerUp);
  root.addEventListener("keyup", onKeyUp);
  root.addEventListener("focusout", onFocusOut);
  const stopFullscreen = dependencies.fullscreen?.onChange(() => {
    if (screen === "game") renderGame();
  });
  root.addEventListener("change", onChange);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("input", onInput);
  const page = root.ownerDocument;
  const stopPlaytestInput = registerPlaytestInput(page, {
    cancel: () => {
      minimapDrag = null;
      releaseCameraKeys();
    },
  });
  page.addEventListener("keydown", onDocumentKeyDown);
  if (
    dependencies.initialRoom &&
    dependencies.online?.validCode(dependencies.initialRoom)
  )
    openRoom(dependencies.initialRoom);
  else render();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      stopPlaytestInput();
      roomBackground?.stop();
      cancelLoads();
      disposeSession();
      gameMenu.dispose();
      dependencies.audio?.dispose();
      root.removeEventListener("click", onClick);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerUp);
      root.removeEventListener("keyup", onKeyUp);
      root.removeEventListener("focusout", onFocusOut);
      stopFullscreen?.();
      root.removeEventListener("change", onChange);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("input", onInput);
      page.removeEventListener("keydown", onDocumentKeyDown);
      root.innerHTML = "";
    },
  };
}
