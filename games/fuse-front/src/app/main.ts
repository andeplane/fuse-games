import { createResultsScreen, createTopBar } from "fuse-ui";
import {
  playtestInputBlocked,
  registerPlaytestCapture,
  registerPlaytestInput,
} from "fuse-ui/playtest-input";
import { requestedRoomSlot } from "fuse-ui";
import { createGameSocial } from "fuse-ui/social";
import { createResultsHistory } from "fuse-ui/results-history";
import {
  createPlayMetrics,
  startGameAnalytics,
  observeConfirmedPlay,
} from "fuse-ui/play-metrics";
import "fuse-ui/social.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "fuse-ui/results.css";
import "@fontsource/oxanium/latin-700.css";
import "@fontsource/oxanium/latin-800.css";
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-600.css";
import "./style.css";
import {
  createInviteCard,
  createLandingCard,
  createLobbyShell,
  createRoomLayout,
  createRoster,
  el,
} from "fuse-ui";
import QRCode from "qrcode";
import { createAppPortal } from "fuse-ui/portal";
import { safeStorage } from "fuse-ui/safe-storage";
import {
  createEndpoints,
  createRoom,
  memberToken,
  PeerTransport,
  validRoomCode,
} from "fuse-network-fe";
import {
  MAX_PACKET_BYTES,
  createLeadClock,
  ticksAhead,
  type Frame,
} from "fuse-netcode";
import { DRAW, TILE, teamOf, type WorldView } from "../engine/index.js";
import { createForward, createSmoother, ordersOf } from "./forward.js";
import { DEFAULT_SETTINGS, type View } from "../online/game.js";
import { mapsFor } from "../online/maps.js";
import { FrontRuntime } from "../online/runtime.js";
import { Battlefield } from "../render/battlefield.js";
import type { Renderer } from "../render/renderer.js";
import { Field3D } from "../render3d/field.js";
import { qualityParam } from "../render3d/fx.js";
import { edgePan, PAN_SPEED } from "../render/camera.js";
import { Hud } from "./hud.js";
import { HERO_ROLES, heroPortrait, loadPortraits } from "./look.js";
import { keyAction } from "./hud-state.js";
import {
  IDLE,
  bodyAt,
  clickIntent,
  modeAfter,
  type Intent,
  isEnemy,
  modeFor,
  overlayOf,
  pinchZoom,
  pressItem,
  pressSpell,
  type Mode,
  zoomAnchor,
} from "./targeting.js";
import {
  SIZES,
  TEAMS,
  cycleDifficulty,
  heroCards,
  mapOptions,
  pickHero,
  roomKey,
  slotsOf,
  type SlotView,
} from "./model.js";
import { GAME_ID, keys, roomFailure, sessionFor } from "./session.js";
import { Radar, homeOf, minimapTile } from "./radar.js";
import { createAudio } from "./audio/index.js";
import { frontPlayFrame } from "./play-metrics.js";
import { matchResult, resultBar, resultReport } from "./result-report.js";
import { scoreOf } from "./scoreboard.js";

const app = document.querySelector<HTMLElement>("#app")!;
const base = import.meta.env.BASE_URL;
const analytics = startGameAnalytics(GAME_ID);
const reportPlay = createPlayMetrics(analytics.track, () => performance.now());
const social = createGameSocial({
  gameId: GAME_ID,
  base,
  apiOrigin: import.meta.env.VITE_API_ORIGIN,
  document,
  window,
  fetch: (input, init) => fetch(input, init),
  track: analytics.track,
});
const endpoints = createEndpoints(
  {
    basePath: `${base}${GAME_ID}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const store = safeStorage(() => localStorage);
// `?mute` and `?2d` (the pixel battlefield) stay on every link the page makes; `?quality=low|high`, read once here, fixes
// the 3D look.
const params = new URLSearchParams(location.search);
/** `?lead=off` draws the old way, a tick behind the clock and blended, to compare the feel against. */
const drawAhead = params.get("lead") !== "off",
  /** `?probe` publishes where this device's hero was last drawn, for `scripts/lead-press-latency.ts`. */
  probe = params.has("probe");
const sticky = ["mute", "2d"].filter((flag) => params.has(flag));
const link = (query = "") =>
  endpoints.appUrl(
    sticky.reduce((url, flag) => `${url}${url ? "&" : "?"}${flag}`, query),
  );
let teardown = () => {};
/** An army's colour: red, blue. */
const teamColor = (team: number) => (team % 2 ? "#3a6ae0" : "#d8402a");
// Sound: this browser's MUSIC and SFX choices, kept; `?mute` silences the page and leaves them alone.
const sound = createAudio(store, keys.audio, params.has("mute"), app);
const { audio } = sound;

function navigate(query = ""): void {
  history.pushState(null, "", link(query));
  render();
}

/** The three.js battlefield when the device gives WebGL2 (and `?2d` does not ask for pixels), else the pixel one. */
function battlefield(): { field: Renderer; canvas: HTMLCanvasElement } {
  if (!sticky.includes("2d"))
    try {
      const canvas = el("canvas", "", "ff-board ff-board-3d");
      return {
        field: new Field3D(canvas, qualityParam(params.toString())),
        canvas,
      };
    } catch (failure) {
      console.warn(
        "Fuse Front: WebGL2 unavailable, using the pixel battlefield",
        failure,
      );
    }
  const canvas = el("canvas", "", "ff-board");
  const field = new Battlefield(canvas, (w, h) =>
    Object.assign(document.createElement("canvas"), { width: w, height: h }),
  );
  return { field, canvas };
}

function header(): HTMLElement {
  const top = el("header", "", "ff-top");
  const brand = el("a", "FUSE FRONT", "ff-brand");
  brand.href = link();
  top.append(
    createAppPortal({
      document,
      current: GAME_ID,
      base,
      search: location.search,
    }).element,
    brand,
    social.element(),
    el("span", "", "ff-top-gap"),
  );
  return createTopBar({
    element: top,
    gameId: GAME_ID,
    sound: {
      enabled: () => audio.enabled("music") || audio.enabled("effects"),
      forcedMute: params.has("mute"),
      setEnabled: (on) => {
        audio.set("music", on);
        audio.set("effects", on);
        if (on) audio.unlock();
      },
    },
  });
}

function landing(error = ""): void {
  audio.scene({ kind: "menu" });
  const card = createLandingCard({
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    title: "FUSE FRONT",
    tagline: "Push the lanes. Hold the jungle. Raze the fort.",
    soloText: "SOLO VS BOTS",
    valid: validRoomCode,
    async onCreate() {
      try {
        const room = await createRoom(endpoints.apiUrl, fetch, GAME_ID);
        store.setItem(keys.host(room.code), room.token);
        navigate(`?room=${room.code}`);
      } catch (failure) {
        throw new Error(
          roomFailure(
            failure instanceof Error ? failure.message : String(failure),
          ),
        );
      }
    },
    onSolo: () => navigate("?solo=1"),
    onJoin: (code) => navigate(`?room=${code}`),
  });
  card.error.textContent = error;
  app.replaceChildren(
    header(),
    card.element,
    el(
      "p",
      "Right-click to move or attack · A + click: attack-move · Shift queues orders · Q W E R: cast or aim · 1–6: items · B: shop · hold `: scoreboard · Z / X: zoom · Tab: the fight · Home: your fort",
      "ff-help",
    ),
  );
  const help = app.querySelector<HTMLElement>(".ff-help");
  if (help) card.menu.help.append(help);
}

function room(code: string, token: string | undefined, display: boolean): void {
  const status = el("p", "Connecting…", "ff-status");
  let detached = false;
  status.setAttribute("role", "status");
  const lobby = el("section", "", "ff-lobby");
  const play = el("section", "", "ff-play");
  const hint = el("p", "", "ff-hud");
  // The result: the shared results screen over the page.
  const results = createResultsScreen({
    document,
    // The screen covers the page's header: whoever is not the host still has a way out of the room.
    onBack: () => {
      resultsHistory.close(() => ({ receipts: runtime.roomState()?.history ?? [], confirmedTick: runtime.confirmedFrame()?.logTick ?? -1 }), () => {
        runtime.stop();
        location.href = link();
      });
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
  /** The match clock when the match was decided, so a clock that runs on does not rebuild the report. */
  let decided = { matchId: "", time: "" };
  const stage = el("div", "", "ff-stage");
  const { field, canvas } = battlefield();
  const stopPlaytestCapture = registerPlaytestCapture(document, async () =>
    field instanceof Field3D && canvas.isConnected
      ? new Map([[canvas, field.capture()]])
      : new Map(),
  );
  // Hero portraits come from the 3D models where the 3D battlefield runs; the pixel ones otherwise.
  if (field instanceof Field3D) loadPortraits();
  let shown: WorldView | undefined;
  let currentLobby: ReturnType<typeof createRoomLayout> | undefined;
  // What the next map click means, and the tile under the mouse, for the aiming overlay.
  let mode: Mode = IDLE;
  let cursor: { x: number; y: number } | undefined;
  // The overlay is rebuilt only when the view, the mode or the tile under the cursor changed.
  let drawn = "";
  let drawnFor: WorldView | undefined;
  const refresh = () => {
    const key = `${mode.kind}:${mode.kind === "aim" || mode.kind === "item" ? mode.slot : ""}:${cursor?.x},${cursor?.y}`;
    if (!shown || (shown === drawnFor && key === drawn)) return;
    [drawn, drawnFor] = [key, shown];
    field.overlay = overlayOf(shown, runtime.slot(), mode, cursor);
  };
  const arm = (next: Mode) => {
    mode = next;
    hud.armed(next.kind === "aim" ? next.slot : -1, next.kind === "attackMove");
    hud.aimingItem(next.kind === "item" ? next.slot : -1);
    canvas.classList.toggle("ff-aiming", next.kind !== "idle");
    refresh();
  };
  const hud = new Hud({
    cast(slot, shift = false) {
      if (!shown) return;
      const ready = !!hud.state.spells[slot]?.ready;
      const queued = shift || hud.queueing;
      const seat = runtime.slot();
      const press = pressSpell(shown, seat, mode, slot, ready, queued);
      if (press.cast)
        runtime.cast(slot, press.cast.x, press.cast.y, undefined, queued);
      // A spell that cannot go now buzzes (a passive, a locked or a cooling one).
      else if (press.mode === mode && seat >= 0) audio.ui("invalid");
      arm(press.mode);
    },
    attackMove: () =>
      arm(mode.kind === "attackMove" ? IDLE : { kind: "attackMove" }),
    look: (fx, fy) => shown && field.lookAt(fx, fy, shown),
    useItem(slot) {
      if (!shown) return;
      const press = pressItem(shown, runtime.slot(), mode, slot);
      if (press.use) runtime.useItem(slot, press.use.x, press.use.y);
      arm(press.mode);
    },
    // A refused order (a watcher, or one the runtime turns down) buzzes.
    buy: (id) => audio.ui(runtime.buy(id) ? "buy" : "invalid"),
    sell: (slot) => audio.ui(runtime.sell(slot) ? "sell" : "invalid"),
    move(fx, fy, queued = false) {
      if (!shown || runtime.slot() < 0) return;
      const tile = minimapTile(fx, fy, shown.width, shown.height);
      runtime.move(tile.x, tile.y, queued);
      // As on the board, a queued order leaves an armed attack-move armed.
      arm(queued ? mode : IDLE);
    },
  });
  const radar = new Radar();
  /** Centres the camera on a point in tiles, if there is one. */
  const jump = (at: { x: number; y: number } | undefined) =>
    at && shown && field.lookAt(at.x / shown.width, at.y / shown.height, shown);
  stage.append(canvas, hud.overlay, hud.shop.element);
  play.append(hud.top, stage, hud.bottom, hint);
  play.hidden = true;
  app.replaceChildren(header(), status, lobby, play, results.element);
  // The name this device knows: the account's, or the one typed in a room before.
  const known = () =>
    social.playerName(store.getItem(keys.name))?.trim() || undefined;
  const online = token !== undefined;
  const runtime = new FrontRuntime(
    code,
    DEFAULT_SETTINGS,
    {
      ready: () => {
        // A guest this device has a name for is seated at once; anyone else is asked by the room's seat dialog.
        const who = known();
        if (online && !display && !store.getItem(keys.host(code)) && who)
          runtime.command({ type: "join", name: who });
      },
      state: (frame) => { if (!detached) show(frame); },
      event: (event, matchId) => {
        if (detached) return;
        field.event(matchId, event, performance.now());
        audio.event(matchId, event, shown, runtime.slot());
        const ping = radar.event(matchId, event, shown, runtime.slot());
        if (ping && shown)
          hud.ping(ping.x / shown.width, ping.y / shown.height, ping.kind);
        // This seat's last hits pop their gold where the body fell; its kills, assists and deaths post a notice.
        const fed = hud.feed.event(matchId, event, shown, runtime.slot());
        const at = fed.float && shown && field.screenOf(fed.float, shown);
        // `screenOf` is from the canvas's content box; the overlay covers the stage, where the canvas may sit centred.
        const [ox, oy] = [
          canvas.offsetLeft + canvas.clientLeft,
          canvas.offsetTop + canvas.clientTop,
        ];
        if (fed.float && at) hud.popup(fed.float.text, at.x + ox, at.y + oy);
        if (fed.float) audio.gold(event.step);
        if (fed.notice) hud.notice(fed.notice.text, fed.notice.good);
      },
      status: (text) => (status.textContent = roomFailure(text)),
      ended: () =>
        (status.textContent = "Room ended. Go back to create another room."),
      kicked: () => (status.textContent = "You were removed from the room."),
    },
    online
      ? {
          displayOnly: display,
          transport: (events) =>
            new PeerTransport(code, token, events, {
              apiUrl: endpoints.apiUrl,
              gameId: GAME_ID,
              maxFastBytes: MAX_PACKET_BYTES,
            }),
        }
      : { humanName: known() ?? "Commander" },
  );
  let lobbyKey = "";
  // The seat whose hero the lobby's cards show: this device's, or one the host chose from the team chips.
  let picking = -1;
  // The row's HERO button that opened Settings: it has the focus back when Settings closes.
  let heroOpener: string | undefined;
  let wasLobby = true;
  const resultsHistory = createResultsHistory({
    fetch: social.reportFetch, apiUrl: endpoints.apiUrl, gameId: GAME_ID,
    ...(token ? { room: { code, token } } : {}),
    signedIn: () => social.isSignedIn(), playerId: () => runtime.self,
    now: () => performance.now(),
  });
  function show(view: Frame<View>): void {
    observeConfirmedPlay(
      reportPlay,
      view,
      () => runtime.confirmedFrame(),
      (view) => frontPlayFrame(view, runtime.self, display, online),
    );
    const confirmed = runtime.confirmedFrame();
    if (!display && confirmed)
      resultsHistory.observe(confirmed.history, confirmed.logTick);
    const inLobby = view.stage === "lobby";
    // The room's line is at the room's foot; in a match it is the line under the page's header again.
    if (!inLobby && status.parentElement !== app) lobby.before(status);
    if (inLobby && !wasLobby) lobbyKey = "";
    lobby.hidden = !inLobby;
    currentLobby?.setActive(inLobby);
    play.hidden = inLobby;
    // A phone drops the page header in a match, so the board gets the height (`style.css`).
    app.classList.toggle("ff-in-match", !inLobby);
    if (!inLobby && wasLobby) hud.unfold(false);
    wasLobby = inLobby;
    // The music: the lobby's theme, the match's moods, then its outro (a watcher hears the winner's, a draw a defeat).
    const seat = runtime.slot();
    const won =
      view.winner !== DRAW && (seat < 0 || teamOf(seat) === view.winner);
    audio.scene(
      inLobby
        ? { kind: "menu" }
        : view.stage === "over"
          ? { kind: "over", won }
          : { kind: "match", step: view.world?.step ?? 0 },
    );
    if (view.stage !== "over") {
      if (results.open) results.hide();
      shownResult = "";
    }
    if (inLobby) {
      const slots = slotsOf(view, runtime.self);
      if (!slots.some((s) => s.slot === picking))
        picking = slots.find((s) => s.self)?.slot ?? 0;
      const key = roomKey(
        view,
        slots,
        picking,
        runtime.creator,
        view.managerId,
      );
      if (key !== lobbyKey) {
        lobbyKey = key;
        renderLobby(view);
      }
      return;
    }
    const world = view.world!;
    const slot = runtime.slot();
    const slots = slotsOf(view, runtime.self);
    hud.update(world, slot, slots);
    // Where this device's hero stands, for browser smokes to read that an order moved it.
    const mine = world.heroes.find((h) => h.seat === slot);
    canvas.dataset.hero = mine ? `${mine.x},${mine.y}` : "";
    // Aiming ends with the hero (dead, watching, or between matches).
    if (modeFor(world, slot, mode) !== mode) arm(IDLE);
    if (mode.kind !== "idle" || cursor) refresh();
    const countdown = Math.max(
      0,
      Math.ceil((view.startAt - view.logTick) / 20),
    );
    const text = countdown
      ? `Starting in ${countdown}…`
      : slot >= 0
        ? `${TEAMS[slot % 2]} · right-click: move, or attack an enemy · A then click: attack-move · Shift + click queues · Q W E R: cast or aim, then click · 1–6 items · B shop · hold \` score · Esc cancels · Space or F follows · Z/X zoom · Home fort · Tab fight · right-click the minimap to move`
        : "Watching";
    if (hint.textContent !== text) hint.textContent = text;
    if (view.stage !== "over") return;
    if (decided.matchId !== view.matchId)
      decided = { matchId: view.matchId, time: hud.state.time };
    const { red, neutral, blue } = hud.state;
    const result = matchResult(
      scoreOf(world, slots, (seat) => hud.feed.tally(seat)),
      slots,
      {
        winner: view.winner,
        seat: slot,
        time: decided.time,
        sectors: { red, neutral, blue },
        seats: view.seats.filter((seat) => !seat.watcher),
        host: runtime.creator || runtime.solo,
      },
    );
    // The bar's own fields do not rebuild the report; an account that turns up after the match gets its button.
    const key = JSON.stringify([
      { ...result, host: false, waiting: "" },
      result.rows.map((row) => social.friends.publicIdOfMember(row.id)),
    ]);
    const first = !shownResult;
    if (key !== shownResult) {
      shownResult = key;
      results.show(
        resultReport(result, {
          color: teamColor,
          friend: (id) => {
            const publicId = social.friends.publicIdOfMember(id);
            return publicId ? social.friends.friendButton(publicId) : undefined;
          },
        }),
      );
    }
    results.update(resultBar(result));
    if (first)
      results.actions
        .querySelector<HTMLButtonElement>("button.is-primary")
        ?.focus();
  }
  function renderLobby(view: Frame<View>, openSettings = false): void {
    const settingsWereOpen =
      openSettings || (currentLobby?.settings.open ?? false);
    const focused = document.activeElement;
    const focusedAction =
      focused instanceof HTMLElement && lobby.contains(focused)
        ? focused.dataset.roomAction
        : undefined;
    const focusedLabel = focused?.getAttribute("aria-label");
    const focusedText = focused?.textContent;
    const host = runtime.creator || runtime.solo;
    const sizes = el("div", "", "ff-sizes");
    for (const size of SIZES) {
      const choice = el("button", `${size}V${size}`, "fui-button");
      choice.classList.toggle("ff-on", view.settings.size === size);
      choice.disabled = !host;
      choice.onclick = () =>
        runtime.command({
          type: "settings",
          // A picked map too small for the new size goes back to the size's default.
          settings: {
            ...view.settings,
            size,
            map: mapsFor(size).some((m) => m.id === view.settings.map)
              ? view.settings.map
              : null,
          },
        });
      sizes.append(choice);
    }
    // The maps that hold the size; the host's pick, or the size's default, is lit.
    const maps = el("div", "", "ff-sizes ff-maps");
    for (const option of mapOptions(view.settings)) {
      const choice = el("button", option.label, "fui-button");
      choice.classList.toggle("ff-on", option.on);
      choice.disabled = !host;
      choice.onclick = () =>
        runtime.command({
          type: "settings",
          settings: { ...view.settings, map: option.id },
        });
      maps.append(choice);
    }
    // Settings: team panels of seat chips; the host clicks a chip to pick that seat's hero on the cards under them.
    const teams = el("div", "", "ff-teams");
    const slots = slotsOf(view, runtime.self);
    // The host looks at another seat's hero: the room is redrawn for it now, and not again by the next frame.
    const pick = (slot: number, openSettings = false) => {
      picking = slot;
      lobbyKey = roomKey(view, slots, picking, runtime.creator, view.managerId);
      renderLobby(view, openSettings);
    };
    for (const team of [0, 1]) {
      const column = el("div", "", `ff-team ff-t${team}`);
      const seats = el("div", "", "ff-seats");
      column.append(el("h3", `${TEAMS[team]} ARMY`, "ff-team-name"), seats);
      for (const slot of slots.filter(
        (s) =>
          s.team === team &&
          view.seats.some((seat) => !seat.watcher && seat.slot === s.slot),
      )) {
        const chip = el("span", "", "ff-seat");
        const who = slot.self ? "You" : slot.name;
        const name = el("button", `${who} · ${slot.hero}`, "ff-seat-pick");
        name.disabled = !host;
        name.setAttribute("aria-pressed", String(slot.slot === picking));
        name.onclick = () => pick(slot.slot);
        chip.classList.toggle("ff-own", slot.self);
        chip.classList.toggle("ff-on", slot.slot === picking);
        chip.append(name);
        if (slot.bot && host) {
          const cycle = el("button", "⟳", "ff-cycle");
          cycle.title = "Change difficulty";
          cycle.onclick = () =>
            runtime.command({
              type: "settings",
              settings: cycleDifficulty(view.settings, slot.slot),
            });
          chip.append(cycle);
        }
        seats.append(chip);
        chip.dataset.slot = String(slot.slot);
      }
      teams.append(column);
    }
    // The room's players: the shared roster, each seat with its hero's face, its hero as the status and HOST on
    // whoever holds START. The host's HERO opens Settings on that seat's cards; an AI's level cycles in place.
    const faces = new Map<string, SlotView>();
    const roster = createRoster({
      emptyText: "Nobody has joined yet",
      avatar: (key) => {
        const face = faces.get(key);
        return face ? heroPortrait(face.hero, face.team) : el("span");
      },
    });
    const seated = view.seats.filter((seat) => !seat.watcher);
    const title = (word: string) => word[0]!.toUpperCase() + word.slice(1);
    const start = el("button", "START", "fui-button-primary");
    start.onclick = () => runtime.command({ type: "action", action: "start" });
    const note = el(
      "p",
      host ? "" : "Waiting for the host to start…",
      "ff-room-note",
    );
    note.hidden = host;
    const shell = createLobbyShell({
      label: `Room ${code}`,
      intro: [
        el("h2", "BATTLE SIZE", "fui-lobby-title"),
        sizes,
        el("h2", "MAP", "fui-lobby-title"),
        maps,
      ],
      ...(online
        ? {
            invite: createInviteCard({
              code,
              link: link(`?room=${code}`),
              qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 300 }),
            }).element,
          }
        : {}),
      roster: roster.element,
      footer: [note],
    });
    lobby.replaceChildren(shell.element);
    const join = el("form");
    const playerName = el("input");
    playerName.value = social.playerName(store.getItem(keys.name)) ?? "";
    playerName.setAttribute("aria-label", "Your name");
    const joinButton = el("button", "Join");
    joinButton.type = "submit";
    join.append(playerName, joinButton);
    join.hidden = display || slots.some((s) => s.self);
    join.onsubmit = (event) => {
      event.preventDefault();
      store.setItem(keys.name, playerName.value);
      runtime.command({
        type: "join",
        name: playerName.value,
        slot: requestedRoomSlot(join),
      });
    };
    const addAI = el("button", "Add AI");
    addAI.hidden = !host || view.seats.length >= 2 * view.settings.size;
    addAI.onclick = () =>
      runtime.command({
        type: "bot",
        action: "add",
        slot: requestedRoomSlot(addAI),
      });
    const ownSeat = view.seats.find(
      (seat) => seat.id === runtime.self && !seat.watcher,
    );
    const layout = createRoomLayout({
      // Seated already: any open seat is a move, and the army and the hero are the seat's.
      ownSlot: () => ownSeat?.slot,
      onMove: (slot) => {
        if (ownSeat)
          runtime.command({ type: "join", name: ownSeat.name, slot });
      },
      primaryAction: host ? start : undefined,
      slotColor: (slot) => teamColor(slot % 2),
      slotLabel: (slot) => `${slot % 2 ? "Blue" : "Red"} · Slot ${slot + 1}`,
      background: async (host) =>
        (await import("./attract.js")).createAttract(host),
      element: shell.element,
      roster,
      capacity: 2 * view.settings.size,
      join,
      modes: [sizes],
      playerName: () => social.playerName(undefined) ?? undefined,
      addAI,
      settings: [
        maps,
        el("h2", "Heroes"),
        teams,
        heroPicker(view, slots, host),
      ],
      actions: [note],
      actionsInHeader: true,
      heading: "Room",
      status,
      friends: social.friends,
    });
    layout.update(
      view.seats.filter((seat) => !seat.watcher).length,
      2 * view.settings.size,
      view.seats.filter((seat) => !seat.watcher).map((seat) => seat.slot),
    );
    // The layout seats the roster's rows as they change: the players go in once it exists.
    roster.update(
      seated.flatMap((seat) => {
        const slot = slots.find((s) => s.slot === seat.slot);
        if (!slot) return [];
        const face = `${slot.hero}:${slot.team}`;
        faces.set(face, slot);
        return [
          {
            id: seat.id,
            slot: seat.slot,
            name: slot.self ? `${slot.name} (you)` : slot.name,
            // An AI's name already says its level.
            status: title(slot.hero),
            color: teamColor(slot.team),
            avatar: face,
            host: seat.id === view.managerId,
          },
        ];
      }),
    );
    if (host)
      for (const [id, row] of roster.entries()) {
        const seat = seated.find((s) => s.id === id);
        const slot = slots.find((s) => s.slot === seat?.slot);
        if (!slot) continue;
        const tools = el("span", "", "ff-row-tools");
        if (slot.bot) {
          const level = el("button", "LEVEL", "ff-row-action");
          level.setAttribute(
            "aria-label",
            `Change ${slot.name}'s level (${slot.difficulty})`,
          );
          level.dataset.roomAction = `level:${slot.slot}`;
          level.onclick = () =>
            runtime.command({
              type: "settings",
              settings: cycleDifficulty(view.settings, slot.slot),
            });
          tools.append(level);
        }
        const hero = el("button", "HERO", "ff-row-action");
        hero.setAttribute("aria-label", `Pick ${slot.name}'s hero`);
        hero.dataset.roomAction = `hero:${slot.slot}`;
        hero.onclick = () => {
          heroOpener = hero.dataset.roomAction;
          pick(slot.slot, true);
        };
        tools.append(hero);
        row.append(tools);
      }
    currentLobby = layout;
    // Settings closed: its cards are this device's seat again, and a row's HERO that opened it has the focus back.
    layout.settings.addEventListener("close", () => {
      const opener = heroOpener;
      heroOpener = undefined;
      const own = slots.find((s) => s.self)?.slot ?? 0;
      const redrawn = picking !== own;
      if (redrawn) pick(own);
      if (opener)
        [...lobby.querySelectorAll<HTMLElement>("[data-room-action]")]
          .find((node) => node.dataset.roomAction === opener)
          ?.focus();
      else if (redrawn)
        lobby.querySelector<HTMLElement>(".fui-room-configure")?.focus();
    });
    if (settingsWereOpen) {
      layout.settings.showModal();
      const candidates = [
        ...layout.settings.querySelectorAll<HTMLElement>(
          "button, select, input",
        ),
      ];
      const replacement = candidates.find((node) =>
        focusedLabel
          ? node.getAttribute("aria-label") === focusedLabel
          : node.textContent === focusedText,
      );
      replacement?.focus();
    } else if (focusedAction) {
      // The room is rebuilt on every change: a row's button keeps the keyboard's place (an AI's LEVEL cycles).
      [...lobby.querySelectorAll<HTMLElement>("[data-room-action]")]
        .find((node) => node.dataset.roomAction === focusedAction)
        ?.focus();
    }
  }
  /** The picking seat's hero cards, its hero lit; the host picks by clicking one (each hero once a team). */
  function heroPicker(
    view: View,
    slots: readonly SlotView[],
    host: boolean,
  ): HTMLElement {
    const seat = slots.find((s) => s.slot === picking);
    const row = el("div", "", "ff-heroes");
    for (const card of heroCards(slots, picking)) {
      const choice = el("button", "", `ff-hero ff-${card.state}`);
      const words = el("span", "", "ff-hero-words");
      const status = {
        mine: seat?.self ? "Your pick" : `${seat?.name ?? ""}'s pick`,
        taken: `Taken by ${card.by}`,
        free: "Available",
      }[card.state];
      words.append(
        el("b", card.kind.toUpperCase()),
        el("span", HERO_ROLES[card.kind], "ff-role"),
        el("small", status),
      );
      choice.append(heroPortrait(card.kind, seat?.team ?? 0), words);
      choice.setAttribute("aria-pressed", String(card.state === "mine"));
      choice.disabled = !host || card.state === "taken";
      choice.onclick = () =>
        runtime.command({
          type: "settings",
          settings: pickHero(view.settings, picking, card.kind),
        });
      row.append(choice);
    }
    return row;
  }
  // The battlefield draws every animation frame from the runtime's newest frames; `show` only runs the DOM around it.
  let hover: { x: number; y: number } | undefined;
  let drag: { id: number; x: number; y: number; moved: boolean } | undefined;
  let last = performance.now();
  let raf = 0;
  // The battlefield alone is drawn ahead of the fold (`forward.ts`); the HUD and every sound read the folded world.
  const forward = createForward(),
    smoother = createSmoother(3 * TILE),
    leadClock = createLeadClock();
  const fit = (world: WorldView) => {
    const width = play.getBoundingClientRect().width - 6;
    const top = canvas.getBoundingClientRect().top + scrollY;
    // A phone lays the panel over the board (`style.css`), so the board takes the screen below the top bar.
    const overlaid = getComputedStyle(hud.bottom).position === "absolute";
    const below = overlaid
      ? 0
      : hud.bottom.getBoundingClientRect().height +
        hint.getBoundingClientRect().height;
    const height = Math.max(
      160,
      innerHeight - top - below - (overlaid ? 16 : 30),
    );
    field.resize(width, height, devicePixelRatio || 1, world);
  };
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const timing = runtime.frameTiming();
    const newer = timing?.newer;
    if (!timing || !newer?.world || newer.stage === "lobby") {
      shown = undefined;
      return;
    }
    const world = newer.world;
    if (!shown) fit(world);
    if (world !== shown) radar.watch(world);
    shown = world;
    const older =
      timing.older?.world && timing.older.matchId === newer.matchId
        ? timing.older
        : undefined;
    const span = older ? newer.tick - older.tick : 0;
    const t =
      older && span > 0
        ? Math.min(1, Math.max(0, (timing.tick - older.tick) / span))
        : 1;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (hover && !drag) {
      const box = canvas.getBoundingClientRect();
      const dir = edgePan(hover.x, hover.y, box.width, box.height);
      if (dir.x || dir.y)
        field.pan(dir.x * PAN_SPEED * dt, dir.y * PAN_SPEED * dt, world);
      // While aiming, the area follows the ground under a still mouse as the camera moves.
      if (mode.kind === "aim") {
        cursor = field.tileAt(hover.x, hover.y, world);
        refresh();
      }
    }
    const before = older?.world ?? undefined;
    const room = runtime.roomState(),
      lead =
        drawAhead && room?.world && room.world.step === world.step
          ? forward(
              room,
              leadClock(ticksAhead(timing), newer.logTick, now),
              timing.revision ?? 0,
              runtime.pending(),
            )
          : undefined;
    const ahead =
      lead &&
      room?.world &&
      smoother.apply(
        lead,
        newer.matchId,
        timing.revision ?? 0,
        now,
        runtime.slot(),
        room.world.step,
        ordersOf(room.world),
      );
    if (probe) {
      const seat = runtime.slot(),
        mine = (view: WorldView | undefined) =>
          view?.heroes.find((hero) => hero.seat === seat);
      const to = mine(ahead ? ahead.world : world),
        from = mine(ahead ? ahead.before : before) ?? to,
        part = ahead ? ahead.t : t;
      Reflect.set(window, "__leadProbe", {
        at: performance.now(),
        x: to && from && from.x + (to.x - from.x) * part,
        y: to && from && from.y + (to.y - from.y) * part,
      });
    }
    if (ahead)
      field.draw(
        newer.matchId,
        ahead.world,
        ahead.before,
        ahead.t,
        runtime.slot(),
        now,
      );
    else field.draw(newer.matchId, world, before, t, runtime.slot(), now);
    const box = field.box(world);
    hud.cameraBox(box);
    audio.camera = box;
    audio.frame(newer.matchId, world);
  };
  raf = requestAnimationFrame(frame);
  const resized = () => shown && fit(shown);
  window.addEventListener("resize", resized);
  // Two fingers pinch the zoom; the wheel zooms too (the pixel battlefield keeps its scale).
  const touches = new Map<number, { x: number; y: number }>();
  // The wheel and a pinch zoom toward the pointer (`zoomAnchor`); the keys zoom about the centre.
  const zoomAt = (factor: number, x: number, y: number) => {
    if (!shown) return field.zoom(factor);
    const tile = field.tileAt(x, y, shown);
    field.zoom(
      factor,
      zoomAnchor(shown, runtime.slot(), field.follow, tile, x, y),
    );
  };
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (playtestInputBlocked(document)) return;
      event.preventDefault();
      // Lines (Firefox) and pages count as many pixels.
      const pixels = event.deltaY * [1, 16, 400][event.deltaMode]!;
      zoomAt(Math.exp(-pixels * 0.0015), event.offsetX, event.offsetY);
    },
    { passive: false },
  );
  // A press that stays put is a MOVE order on release; one that travels drags the camera instead.
  canvas.addEventListener("pointerdown", (event) => {
    if (playtestInputBlocked(document)) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    if (event.pointerType === "touch")
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size > 1) {
      drag = undefined;
      return;
    }
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  });
  canvas.addEventListener("pointermove", (event) => {
    hover =
      event.pointerType === "mouse"
        ? { x: event.offsetX, y: event.offsetY }
        : undefined;
    if (hover && shown) {
      // The cursor marks an enemy it would attack, and the overlay follows it while aiming.
      cursor = field.tileAt(hover.x, hover.y, shown);
      const enemy = cursor && bodyAt(shown, cursor, isEnemy(runtime.slot()));
      canvas.classList.toggle("ff-hostile", !!enemy);
      // The tile under the mouse, for browser smokes to read.
      canvas.dataset.tile = cursor ? `${cursor.x},${cursor.y}` : "";
      refresh();
    }
    if (touches.has(event.pointerId)) {
      const [a0, b0] = [...touches.values()];
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const [a1, b1] = [...touches.values()];
      const pinch = a0 && b0 && a1 && b1 && pinchZoom(a0, b0, a1, b1);
      if (touches.size > 1) {
        const box = canvas.getBoundingClientRect();
        // A third finger moving changes nothing between the first two.
        if (pinch && pinch.factor !== 1)
          zoomAt(pinch.factor, pinch.x - box.left, pinch.y - box.top);
        return;
      }
    }
    if (!drag || drag.id !== event.pointerId || !shown) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag = { ...drag, x: event.clientX, y: event.clientY, moved: true };
    field.pan(-dx, -dy, shown);
  });
  canvas.addEventListener("pointerup", (event) => {
    touches.delete(event.pointerId);
    const was = drag;
    drag = undefined;
    if (!was || was.moved || !shown) return;
    const tile = field.tileAt(event.offsetX, event.offsetY, shown);
    if (!tile) return;
    // A click on an enemy attacks it and on the ground moves; armed, a left click attack-moves or casts the aimed
    // spell and a right click cancels (`targeting.ts`). Shift, or the HUD's QUEUE, queues the order behind the route.
    const intent = clickIntent(
      shown,
      runtime.slot(),
      mode,
      tile,
      event.button,
      event.shiftKey || hud.queueing,
    );
    if (intent.kind === "none") return;
    send(intent);
    arm(modeAfter(mode, intent));
  });
  /** Asks the runtime for what a click meant. */
  const send = (intent: Intent) => {
    if (intent.kind === "move" || intent.kind === "attackMove")
      runtime[intent.kind](intent.x, intent.y, !!intent.queued);
    else if (intent.kind === "attack") {
      if (runtime.attack(intent.of, intent.id, !!intent.queued))
        audio.ui("confirm");
    } else if (intent.kind === "cast")
      runtime.cast(
        intent.slot,
        intent.x,
        intent.y,
        intent.target,
        !!intent.queued,
      );
    else if (intent.kind === "useItem")
      runtime.useItem(intent.slot, intent.x, intent.y);
  };
  canvas.addEventListener("pointercancel", (event) => {
    touches.delete(event.pointerId);
    drag = undefined;
  });
  canvas.addEventListener("pointerleave", () => {
    hover = cursor = undefined;
    canvas.classList.remove("ff-hostile");
    refresh();
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  const keys123 = (event: KeyboardEvent) => {
    // The results screen keeps the keyboard: Space and Enter press its focused button.
    if (
      playtestInputBlocked(document) ||
      document.querySelector("dialog[open]") ||
      results.open
    )
      return;
    const action = keyAction(event.key);
    const held = event.ctrlKey || event.metaKey || event.altKey;
    if (!action || !shown || event.repeat || held) return;
    const typing =
      event.target instanceof Element &&
      event.target.closest("input, textarea, select, [contenteditable]");
    if (typing) return;
    // Tab jumps to the fight only from the board: on a focused control, or with Shift, it moves focus as usual.
    const control =
      event.target instanceof Element && event.target.closest("button, a");
    if (action.kind === "fight" && (event.shiftKey || control)) return;
    // Also keeps Space from re-pressing a focused HUD button.
    event.preventDefault();
    if (action.kind === "recentre") field.follow = true;
    else if (action.kind === "zoom") field.zoom(action.factor);
    else if (action.kind === "home") jump(homeOf(shown, runtime.slot()));
    else if (action.kind === "fight") jump(radar.fight(shown, runtime.slot()));
    else if (action.kind === "close")
      (hud.shop.close(), hud.showScore(false), arm(IDLE));
    else if (action.kind === "score") hud.showScore(true);
    else if (action.kind === "attackMove") hud.actions.attackMove();
    else if (action.kind === "shop") hud.toggleShop();
    else if (action.kind === "item") hud.actions.useItem(action.slot);
    else hud.actions.cast(action.slot, event.shiftKey);
  };
  // The scoreboard shows only while ` is held.
  const keyUp = (event: KeyboardEvent) =>
    keyAction(event.key)?.kind === "score" && hud.showScore(false);
  window.addEventListener("keydown", keys123);
  window.addEventListener("keyup", keyUp);
  // A window left with ` still held never sees its keyup.
  const blurred = () => hud.showScore(false);
  const stopPlaytestInput = registerPlaytestInput(document, {
    cancel: () => {
      hud.showScore(false);
      drag = undefined;
      touches.clear();
      hover = cursor = undefined;
      arm(IDLE);
    },
  });
  window.addEventListener("blur", blurred);
  runtime.start();
  teardown = () => {
    detached = true;
    stopPlaytestCapture();
    stopPlaytestInput();
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resized);
    window.removeEventListener("keydown", keys123);
    window.removeEventListener("keyup", keyUp);
    window.removeEventListener("blur", blurred);
    resultsHistory.close(() => ({ receipts: runtime.roomState()?.history ?? [], confirmedTick: runtime.confirmedFrame()?.logTick ?? -1 }), () => runtime.stop());
    field.dispose();
  };
}

function render(): void {
  teardown();
  teardown = () => {};
  const session = sessionFor(
    location.search,
    store,
    validRoomCode,
    memberToken,
  );
  if (session.kind === "landing") landing();
  else if (session.kind === "invalid")
    landing("Invalid room code. Check your invite or create a new room.");
  else if (session.kind === "solo") room("SOLO", undefined, false);
  else room(session.code, session.token, session.role === "display");
}

window.addEventListener("popstate", render);
render();
