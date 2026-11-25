import {
  createHowToPlay,
  createLiveResults,
  createPlayScreen,
  createResultsScreen,
  elementsFor,
  type RoomFriends,
} from "fuse-ui";
import {
  playtestInputBlocked,
  registerPlaytestInput,
} from "fuse-ui/playtest-input";
import { createAppPortal } from "fuse-ui/portal";
import type { HistorySnapshot } from "fuse-ui/results-history";
import { observeConfirmedPlay, type PlayObserver } from "fuse-ui/play-metrics";
import { playFrame } from "./play-metrics.js";
import type { BallRuntime } from "../online/runtime.js";
import type { ArenaRenderer } from "../render/arena.js";
import {
  createLeadClock,
  ticksAhead,
  type Callbacks,
  type FrameTiming,
} from "fuse-netcode";
import { createSmoother, forward, forwardInputs } from "./forward.js";
import type { RoomView, Settings } from "../online/game.js";
import type { Impact } from "../engine/view.js";
import { colorCss, interpolate } from "../render/present.js";
import type { BallView } from "../engine/view.js";
import { view } from "../engine/view.js";
import { createArena } from "../engine/state.js";
import {
  BALL_GUIDE,
  Controls,
  keyboardButton,
  gameplayKey,
} from "./controls.js";
import type { Audio } from "./audio.js";
import { present, type Model } from "./presenter.js";
import { resultBar, resultReport } from "./result-report.js";
import { roomPanel } from "./room-panel.js";
import { roomModel } from "./room-model.js";
import { NAME_KEY, roomFailure, type Store } from "./session.js";
import { chosenAvatar } from "./avatars.js";
import type { Radio } from "./radio.js";

export type Client = Pick<
  BallRuntime,
  | "start"
  | "stop"
  | "cancel"
  | "input"
  | "command"
  | "frameTiming"
  | "confirmedFrame"
  | "self"
  | "canManage"
> &
  // Optional: a client without it is drawn a tick behind the clock, blended.
  Partial<Pick<BallRuntime, "lead" | "historyReceipts">>;
export interface ScreenOptions {
  base?: string;
  search?: string;
  observePlay?: PlayObserver;
  /** Called with confirmed state only; submission is supplied by the composition root. */
  history?(snapshot: HistorySnapshot): void;
  closeHistory?(read: () => HistorySnapshot, stop: () => void): void;
  online?: {
    code: string;
    display: boolean;
    shared: boolean;
    link: string;
    displayLink: string;
  };
  store: Store;
  settings: Settings;
  qr(link: string): Promise<string>;
  audio: Pick<Audio, "muted" | "unlock" | "play" | "destroy">;
  radio?: Radio;
  attachHeader?(
    header: HTMLElement,
    onOpenChange: (open: boolean) => void,
  ): void;
  /** The results screen's friend buttons, in a room. */
  friends?: {
    publicIdOfMember(memberId: string): string | undefined;
    friendButton(publicId: string): HTMLElement;
  };
  /** The room's own friends controls: INVITE FRIENDS beside the invitation and ADD FRIEND on a seat. */
  roomFriends?: RoomFriends;
  renderer(parent: HTMLElement): ArenaRenderer;
  runtime(callbacks: Callbacks<RoomView, Impact, Settings>): Client;
  now(): number;
  frame(callback: (now: number) => void): number;
  cancelFrame(id: number): void;
  events: EventTarget;
  home(): void;
  retry(): void;
}
export function mountGame(root: HTMLElement, options: ScreenOptions) {
  const document = root.ownerDocument,
    el = elementsFor(document);
  const abort = new AbortController(),
    signal = abort.signal;
  const query = new URLSearchParams(options.search ?? "");
  /** `?lead=off` draws the old way, a tick behind the clock and blended, to compare the feel against. */
  const drawAhead = query.get("lead") !== "off",
    /** For latency measurements: `?probe` publishes where this device's paddle was last drawn. */
    probe = query.has("probe"),
    smoother = createSmoother(),
    leadClock = createLeadClock();
  const audio = options.audio;
  const top = el("header", "", "topbar"),
    home = el("a", "All games", "back");
  home.href = "../";
  top.append(
    createAppPortal({
      document,
      current: "ball-bros",
      base: options.base ?? "../",
      search: options.search,
    }).element,
    home,
  );

  const retry = el("button", "RECONNECT", "quiet-button");
  retry.hidden = !options.online;
  retry.onclick = () => {
    leaving = false;
    cancel();
    runtime?.stop();
    options.retry();
  };
  let leaving = false;
  const exit = (navigate = options.home) => {
    if (leaving) return;
    leaving = true;
    cancel();
    const previous = runtime;
    const stop = () => {
      previous?.stop();
      if (!stopped && leaving) navigate();
    };
    if (options.closeHistory)
      options.closeHistory(
        () => ({
          receipts: previous?.historyReceipts?.() ?? [],
          confirmedTick: previous?.confirmedFrame()?.logTick ?? -1,
        }),
        stop,
      );
    else stop();
  };
  home.onclick = (event) => {
    event.preventDefault();
    exit(() => {
      document.defaultView!.location.href = home.href;
    });
  };
  const leave = el("button", "LEAVE", "quiet-button");
  leave.onclick = () => exit();
  top.append(retry, leave);
  const heading = el("section", "", "heading");
  heading.append(
    el("span", "FIVE CORES. ONE SURVIVOR.", "eyebrow"),
    el("h1", "BALL BROS"),
    el("p", "Protect your core. Turn every save into a shot."),
  );
  const scoreboard = el("div", "", "scoreboard");
  const cards = Array.from({ length: 5 }, (_, slot) => {
    const c = el("div", "", "scorecard");
    c.style.setProperty("--player", colorCss(slot));
    scoreboard.append(c);
    return c;
  });
  const layout = el("main", "", "layout"),
    arenaBox = el("section", "", "arena-wrap");
  const canvasHost = el("div", "", "canvas-host");
  canvasHost.setAttribute("aria-label", "Ball Bros arena");
  const overlay = el("div", "", "overlay"),
    overlayTitle = el("h2", "DEFEND YOUR CORE"),
    overlayText = el(
      "p",
      "A / D to orbit · W / S to reach out / pull in · Space to launch",
    ),
    start = el("button", "PLAY SOLO", "primary");
  overlay.append(
    el("span", "BALL BROS / FIRST CONTACT", "eyebrow"),
    overlayTitle,
    overlayText,
    start,
  );
  const toast = el("div", "", "arena-toast");
  toast.setAttribute("aria-live", "polite");
  arenaBox.append(canvasHost, toast, overlay);
  const side = el("aside", "", "sidebar");
  const clock = el("div", "02:00", "clock"),
    mapName = el("p", "CLASSIC CIRCUIT", "map-name"),
    status = el("p", "Loading arena…", "status"),
    // In a room the same words are at the room's foot while it waits; `status` is the match's line.
    roomStatus = el("p", "Loading arena…", "room-foot-status");
  status.setAttribute("role", "status");
  roomStatus.setAttribute("role", "status");
  const say = (text: string) => {
    status.textContent = text;
    roomStatus.textContent = text;
  };
  const instructions = el("div", "", "instructions");
  instructions.append(
    createHowToPlay({ ...BALL_GUIDE, document: root.ownerDocument }),
  );
  const restart = el("button", "RESTART ROUND", "quiet-button");
  restart.hidden = true;
  side.append(
    el("span", "ROUND TIMER", "eyebrow"),
    clock,
    mapName,
    status,
    instructions,
    restart,
    el(
      "p",
      "Your ball collects powers for you. Shrink rivals · Bomb armor / stun paddles · Sticky catches · Thief repairs · Split doubles.",
      "footnote",
    ),
  );
  layout.append(arenaBox, side);
  const controlsRow = el("div", "", "touch-controls");
  root.append(top, heading, scoreboard, layout, controlsRow);
  let renderer = options.renderer(canvasHost),
    graphicsFailed = false,
    // A failed start or a stopped arena takes the room away for the retry; it stays away until the retry runs.
    retrying = false;
  let runtime: Client | undefined,
    latest: BallView | undefined,
    frame = 0,
    playing = false;
  let shared = options.online?.shared ?? false,
    activeSettings = options.settings,
    lastMatch = "",
    stopped = false,
    joined = false;
  const panel = options.online
    ? roomPanel(root, {
        ...options.online,
        store: options.store,
        qr: options.qr,
        command: (command) => runtime?.command(command) ?? false,
        status: roomStatus,
        ...(options.roomFriends ? { friends: options.roomFriends } : {}),
      })
    : undefined;
  if (panel) {
    layout.hidden = true;
    scoreboard.hidden = true;
    controlsRow.hidden = true;
    root.insertBefore(panel.element, layout);
    root.insertBefore(status, heading);
    status.classList.add("room-status");
  }
  // The result: the shared results screen over the page, on a phone controller and the TV too.
  const results = createResultsScreen({
    document,
    // The screen covers the top bar: whoever is not the host still has a way out.
    onBack: exit,
    backText: "Leave",
    onAction: (id) => {
      if (id === "rematch") void begin();
      else runtime?.command({ type: "action", action: "lobby" });
    },
  });
  root.append(results.element);
  const liveResults = createLiveResults(results);
  function showResult(result: Model["result"]): void {
    liveResults.render(result, {
      friends: result?.solo ? undefined : options.friends,
      report: (result, friend) =>
        resultReport(result, { color: colorCss, friend }),
      bar: resultBar,
    });
  }
  const identity = el("p", "", "controller-identity");
  root.insertBefore(identity, controlsRow);
  const powers = el("p", "", "power-status");
  powers.setAttribute("aria-live", "polite");
  root.insertBefore(powers, controlsRow);
  const controls = new Controls((steer, radial, launch) => {
    audio.unlock();
    runtime?.input(steer, radial, launch);
  });
  for (const [action, label] of [
    ["left", "↶ LEFT"],
    ["inward", "IN ↓"],
    ["launch", "LAUNCH"],
    ["outward", "OUT ↑"],
    ["right", "RIGHT ↷"],
  ] as const) {
    const button = el("button", label, `pad ${action}`);
    button.dataset.action = action;
    button.addEventListener(
      "pointerdown",
      (e) => {
        if (playtestInputBlocked(document)) return;
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        controls.press(`pointer-${e.pointerId}`, action);
        button.classList.add("pressed");
      },
      { signal },
    );
    const release = (e: PointerEvent) => {
      controls.release(`pointer-${e.pointerId}`);
      button.classList.remove("pressed");
    };
    button.addEventListener("pointerup", release, { signal });
    button.addEventListener("pointercancel", release, { signal });
    button.addEventListener("lostpointercapture", release, { signal });
    controlsRow.append(button);
  }
  const cancel = () => {
    controls.cancel();
    runtime?.cancel();
    controlsRow
      .querySelectorAll(".pressed")
      .forEach((b) => b.classList.remove("pressed"));
  };
  // A phone's live round is the whole screen: the square arena with the scores and the pads floating around it.
  const playScreen = createPlayScreen({ stage: layout, onChange: cancel });
  root.tabIndex = -1;
  options.attachHeader?.(top, (open) => {
    if (open) cancel();
    else if (
      playing &&
      top.contains(document.activeElement) &&
      !document.querySelector("dialog[open]")
    )
      root.focus({ preventScroll: true });
  });
  document.addEventListener(
    "keydown",
    (e) => {
      const target =
        e.target && "closest" in e.target
          ? (e.target as HTMLElement)
          : undefined;
      const action = gameplayKey(
        e.code,
        !!(
          target?.isContentEditable ||
          target?.closest("input, textarea, select")
        ),
        !!target?.closest("button, a"),
      );
      if (!action || e.repeat || !playing || playtestInputBlocked(document))
        return;
      e.preventDefault();
      controls.press(e.code, action);
    },
    { signal },
  );
  document.addEventListener(
    "keyup",
    (e) => {
      if (keyboardButton(e.code)) {
        controls.release(e.code);
      }
    },
    { signal },
  );
  const stopPlaytestInput = registerPlaytestInput(document, { cancel });
  options.events.addEventListener("blur", cancel, { signal });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) cancel();
    },
    { signal },
  );

  let previousHud = "";
  function update(v: BallView | RoomView): void {
    latest = v;
    root.dataset.phase = "stage" in v ? v.stage : (v.arena?.phase ?? "loading");
    // Live: a round under way on this device's own arena (not a shared screen's TV or its phone controllers).
    const phase = v.arena?.phase,
      live =
        !options.online?.display &&
        !(options.online && shared) &&
        (!("stage" in v) || v.stage === "running") &&
        (phase === "countdown" || phase === "playing");
    playScreen.update(live);
    // Alone, the pads show only while the round runs; a room's follow its seat.
    if (!options.online) controlsRow.hidden = !live;
    if ("stage" in v && options.online) {
      const m = roomModel(
        v,
        runtime?.self ?? "",
        runtime?.canManage ?? false,
        options.online.display,
        shared,
        activeSettings,
        "managerId" in v && typeof v.managerId === "string" ? v.managerId : "",
      );
      panel!.render(m);
      panel!.element.hidden = !m.lobby || retrying;
      heading.hidden = m.lobby;
      status.hidden = m.lobby && !retrying;
      const remembered = options.store.getItem(NAME_KEY);
      if (m.askName && remembered && !joined && !runtime?.canManage) {
        joined = true;
        runtime?.command({
          type: "join",
          name: remembered,
          avatarId: chosenAvatar(options.store),
        });
      }
      if ((lastMatch && lastMatch !== v.matchId) || (playing && !m.controls))
        cancel();
      lastMatch = v.matchId;
      playing = m.controls;
      layout.hidden = m.lobby;
      scoreboard.hidden = m.lobby;
      controlsRow.hidden = !m.controls;
      root.classList.toggle("in-match", !m.lobby);
      root.classList.toggle("controller-mode", m.controller);
      options.radio?.enable(!shared || options.online.display);
      root.classList.toggle("display-mode", options.online.display);
      identity.textContent = m.name;
      identity.style.color = m.slot === undefined ? "" : colorCss(m.slot);
      identity.hidden = m.lobby || options.online.display;
      restart.hidden = true;
      // In a room the overlay is only the arena's retry; a result is the results screen's.
      overlay.hidden = true;
      if (m.lobby) {
        showResult(undefined);
        powers.textContent = "";
        powers.hidden = true;
        previousHud = "";
        return;
      }
      if (m.note) say(m.note);
    }
    const model = present(
      v,
      options.online ? (runtime?.self ?? "") : undefined,
      !!runtime?.canManage && !options.online?.display,
    );
    showResult(model?.result);
    if (!model) return;
    const key = JSON.stringify(model);
    if (key === previousHud) return;
    previousHud = key;
    cards.forEach((c) => (c.hidden = true));
    for (const player of model.cards) {
      const card = cards[player.slot]!;
      card.hidden = false;
      card.replaceChildren(
        el("span", player.name, "player-name"),
        el("strong", player.armor),
        el("span", player.label, "card-label"),
      );
      card.classList.toggle("eliminated", !player.alive);
    }
    clock.textContent = model.time;
    mapName.textContent = model.map;
    powers.textContent = model.effects;
    powers.hidden = !model.effects;
    toast.textContent = model.toast;
    if (model.result) {
      playing = false;
      cancel();
      say("Round complete");
    }
  }
  async function begin(): Promise<void> {
    if (options.online && runtime && !graphicsFailed) {
      runtime.command({ type: "action", action: "rematch" });
      return;
    }
    start.disabled = true;
    retrying = false;
    try {
      if (graphicsFailed) {
        renderer.destroy();
        renderer = options.renderer(canvasHost);
        graphicsFailed = false;
      }
      await renderer.ready;
      if (stopped) return;
      cancel();
      previousHud = "";
      audio.unlock();
      overlay.hidden = true;
      start.blur();
      playing = !options.online;
      restart.hidden = !!options.online;
      root.classList.add("in-match");
      restart.blur();
      if (runtime && latest?.arena?.phase === "over") {
        runtime.command({ type: "action", action: "rematch" });
        return;
      }
      runtime?.stop();
      runtime = options.runtime({
        ready: () => {},
        state: (f, settings) => {
          activeSettings = settings;
          shared = settings.display;
          const confirmed = runtime?.confirmedFrame();
          options.history?.({
            receipts: runtime?.historyReceipts?.() ?? [],
            confirmedTick: confirmed?.logTick ?? -1,
          });
          if (options.observePlay)
            observeConfirmedPlay(
              options.observePlay,
              f,
              () => runtime?.confirmedFrame(),
              (f) =>
                playFrame(
                  f,
                  runtime?.self ?? "",
                  !options.online
                    ? "solo"
                    : options.online.display
                      ? "display"
                      : shared
                        ? "controller"
                        : "online",
                ),
            );
          update(f);
        },
        event: (e) => {
          renderer.impact(e, options.now());
          audio.play(e);
        },
        status: (text) => say(roomFailure(text)),
        ended: () => {
          playing = false;
          cancel();
          controlsRow.hidden = true;
          playScreen.update(false);
          say("Room ended. Leave to create another room.");
        },
        kicked: () => {
          playing = false;
          cancel();
          controlsRow.hidden = true;
          playScreen.update(false);
          say("You were removed from the room.");
        },
      });
      runtime.start();
    } catch (error) {
      graphicsFailed = true;
      playing = false;
      playScreen.update(false);
      // The retry is on the overlay, under the results screen.
      showResult(undefined);
      overlay.hidden = false;
      layout.hidden = false;
      retrying = true;
      if (panel) panel.element.hidden = true;
      status.hidden = false;
      start.hidden = false;
      say(
        `Could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
      start.textContent = "RETRY ARENA";
    } finally {
      start.disabled = false;
    }
  }
  start.addEventListener("click", () => void begin(), { signal });
  restart.addEventListener("click", () => void begin(), { signal });
  void renderer.ready.then(
    () => say("Ready for first contact"),
    () => {
      graphicsFailed = true;
      say("Arena could not load. Retry to play.");
      start.textContent = "RETRY ARENA";
    },
  );
  update(
    view(
      0,
      "preview",
      createArena(
        ["You", "Sparks", "Ricochet", "Comet", "Pixel"].map((name, slot) => ({
          id: slot === 0 ? "solo" : `bot-${slot}`,
          name,
          slot,
          bot: slot !== 0,
        })),
      ),
    ),
  );
  toast.textContent = "";
  /**
   * What to draw now: the room's newest arena played forward to the clock when the newest frame is that arena,
   * otherwise the two newest frames blended a tick behind it.
   */
  function picture(timing: FrameTiming<RoomView>, now: number): BallView {
    const lead = drawAhead ? runtime?.lead?.() : undefined;
    if (!lead || lead.tick !== timing.newer.tick)
      return interpolate(timing.older, timing.newer, timing.tick);
    const ahead = leadClock(ticksAhead(timing), timing.newer.logTick, now),
      me = runtime?.self ?? "";
    return {
      ...timing.newer,
      arena: smoother.apply(
        forward(
          lead.arena,
          ahead,
          forwardInputs(lead.connected, me, lead.control),
        ),
        timing.revision ?? 0,
        lead.arena,
        lead.matchId,
        now,
        me,
      ),
    };
  }
  function showArenaPaintFailure(): void {
    graphicsFailed = true;
    cancel();
    runtime?.stop();
    runtime = undefined;
    playing = false;
    playScreen.update(false);
    showResult(undefined);
    overlay.hidden = false;
    layout.hidden = false;
    retrying = true;
    if (panel) panel.element.hidden = true;
    start.hidden = false;
    start.textContent = "RETRY ARENA";
    status.hidden = false;
    say("Arena rendering stopped. Retry to start a fresh round.");
  }

  function paint(now: number): void {
    const timing = runtime?.frameTiming();
    try {
      if (
        !graphicsFailed &&
        !document.hidden &&
        !root.classList.contains("controller-mode")
      ) {
        const drawn = timing ? picture(timing, now) : latest;
        if (drawn) {
          if (timing && probe) {
            const mine = drawn.arena?.bases.find(
              (base) => base.id === runtime?.self,
            );
            Reflect.set(
              root.ownerDocument.defaultView ?? {},
              "__ballBrosProbe",
              {
                at: options.now(),
                angle: mine?.angle,
                radius: mine?.radius,
              },
            );
          }
          renderer.paint(drawn, now);
        }
      }
    } catch {
      showArenaPaintFailure();
    }
    frame = options.frame(paint);
  }
  frame = options.frame(paint);
  void begin();
  return () => {
    stopped = true;
    stopPlaytestInput();
    cancel();
    runtime?.stop();
    playScreen.destroy();
    options.cancelFrame(frame);
    renderer.destroy();
    audio.destroy();
    options.radio?.destroy();
    abort.abort();
  };
}
