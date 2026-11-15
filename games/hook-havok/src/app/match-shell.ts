import type { WorldView } from "../engine/view.js";
import { keeperColor } from "../render/identity.js";
import { matchResult, resultBar, resultReport } from "./result-report.js";
import "./match-shell.css";
import {
  createInviteCard,
  createNameEntry,
  createRoomLayout,
  createRoster,
  button,
  createResultsScreen,
  requestedRoomSlot,
  type RoomFriends,
} from "fuse-ui";
import QRCode from "qrcode";

/** Presentation of replicated facts. All actions reuse the room's existing controls. */
export function createMatchShell(actions: {
  join(name: string, slot?: number): void;
  addAI(slot?: number): void;
  playerName?(): string | undefined;
  /** Out of the room, as the menu's Leave does. */
  leave(): void;
  /** The round starts again for the whole room: the manager's START. False while the room cannot take it yet. */
  start(): boolean;
  /** The room opened over the arena, or closed onto it. */
  onOpenChange(open: boolean): void;
  /** INVITE FRIENDS beside the invitation, ADD FRIEND on a seat and on a result row. */
  friends: RoomFriends;
}) {
  const get = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  // The room is a page of its own over the arena: the round keeps running underneath, as free play does.
  const lounge = document.createElement("section");
  lounge.id = "room-lounge";
  lounge.hidden = true;
  const content = document.createElement("div");
  content.className = "lounge-content";
  // The prototype's own invitation row keeps the fields the page reads; the room shows the shared invitation.
  const legacy = document.createElement("div");
  legacy.hidden = true;
  legacy.append(get("invitation"));
  lounge.append(content, legacy);
  document.querySelector("header")!.after(lounge);
  const workshop = get("tuning").closest("details")!;
  workshop.id = "development-workshop";
  workshop.querySelector("summary")!.textContent =
    "Development workshop · movement & control experiments";
  const controls = get("reset").closest("section")!;
  const experimentSection = get("experiment").closest("section")!,
    rulesSection = get("rules").closest("section")!;
  experimentSection.append(get("reset"));
  workshop.append(
    get("jump-mode").closest("section")!,
    get("zone-controls"),
    controls,
    document.querySelector(".room-entry")!,
  );
  const preferences = document.createElement("section");
  preferences.className = "controls personal-controls";
  preferences.setAttribute("aria-label", "Your controls and atmosphere");
  for (const id of [
    "keyboard-mode",
    "touch-toggle",
    "aim-mode",
    "atmosphere",
    "follow-cam",
  ])
    preferences.append(get(id).closest("label")!);
  preferences.append(get("control-help"));
  // The invitation is made once the room has its code; INVITE FRIENDS is added under it and stays.
  const inviteHolder = document.createElement("div"),
    inviteCard = document.createElement("div");
  inviteHolder.append(inviteCard);
  const players = createRoster();
  const join = createNameEntry({
    initial: actions.playerName?.() ?? "",
    normalize: (value) => value.trim().slice(0, 24),
    onSubmit: (name) => actions.join(name, requestedRoomSlot(join.form)),
  });
  const addAI = button("Add AI");
  addAI.onclick = () => actions.addAI(requestedRoomSlot(addAI));
  // The manager starts the round for everyone; a keeper who is not the manager walks into the arena as it is.
  const go = button("START", "fui-button-primary");
  const back = button("RESUME");
  back.hidden = true;
  const note = document.createElement("p");
  note.className = "room-note";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const tv = document.createElement("div");
  tv.className = "fui-room-extra";
  const openTv = button("OPEN TV SCREEN", "fui-room-tv-screen");
  openTv.onclick = () =>
    window.open(
      get<HTMLAnchorElement>("display-link").href,
      "_blank",
      "noopener",
    );
  tv.append(openTv);
  let manages = false,
    entered = false;
  const show = (value: boolean) => {
    // A dialog left open inside a hidden room would keep the page inert.
    if (!value)
      for (const dialog of lounge.querySelectorAll("dialog[open]"))
        (dialog as HTMLDialogElement).close();
    lounge.hidden = !value;
    document.body.classList.toggle("in-room", value);
    // The arena behind the room takes no keys, focus or taps: the round runs on without this keeper's hands.
    for (const covered of document.querySelectorAll<HTMLElement>(
      ".play-surface, #match-hud",
    ))
      covered.inert = value;
    syncBackground();
  };
  const open = (value: boolean) => {
    if (lounge.hidden === !value) return;
    show(value);
    if (!value) entered = true;
    back.hidden = !manages || !entered;
    actions.onOpenChange(value);
  };
  go.onclick = () => {
    // Before the room runs there is no round to start yet: the room stays until START can be heard.
    if (manages && !actions.start()) return;
    open(false);
  };
  back.onclick = () => open(false);
  const roomLayout = createRoomLayout({
    primaryAction: go,
    headerActions: [back],
    background: async (host, signal) =>
      (await import("./attract.js")).createAttract(host, signal),
    element: content,
    invite: inviteHolder,
    roster: players,
    capacity: 5,
    join: join.form,
    playerName: actions.playerName,
    addAI,
    settings: [
      experimentSection,
      rulesSection,
      preferences,
      document.querySelector<HTMLElement>("[data-radio]")!,
      workshop,
    ],
    actions: [note],
    actionsInHeader: true,
    heading: "Room",
    status,
    extras: [tv],
    friends: actions.friends,
  });
  let inviteCode = "";
  // The room's background is a whole WebGL scene. Under the entrance menu nobody sees it, and it would draw beside
  // the menu's own and the playground behind both: three scenes at once starve the page where WebGL has no GPU.
  function syncBackground() {
    roomLayout.setActive(
      !lounge.hidden && !document.body.classList.contains("at-entrance"),
    );
  }
  new MutationObserver(syncBackground).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
  syncBackground();
  const hud = document.createElement("section");
  hud.id = "match-hud";
  hud.setAttribute("aria-label", "Match scoreboard");
  hud.innerHTML = `<div class="match-heading"><div><span id="match-map"></span><strong id="match-mode"></strong></div><p id="spectator-state" role="status"></p><button id="show-results" hidden>Results</button><div class="match-clock"><small id="clock-label">FREE PLAY</small><strong id="match-clock">∞</strong></div></div>`;
  hud.append(get("round-status"), get("roster"));
  document.querySelector(".play-surface")!.before(hud);
  const overlay = document.createElement("section");
  overlay.id = "match-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div id="countdown-card" role="status" hidden><span>GET READY</span><strong id="countdown-number"></strong></div>`;
  document.querySelector(".stage")!.append(overlay);
  let dismissed = false;
  // The result: the shared results screen over the page, on the shared display too.
  const results = createResultsScreen({
    document,
    onBack: actions.leave,
    backText: "Leave",
    onAction(id) {
      // Every answer to a result leads to the arena, also for a keeper who was in the room when the round ended.
      open(false);
      if (id === "rematch") {
        get<HTMLButtonElement>("restart-room").click();
        // Movement keys are handled on the arena.
        get("scene").focus({ preventScroll: true });
      } else if (id === "free") {
        get<HTMLSelectElement>("rules").value = "free";
        get<HTMLFormElement>("tuning").requestSubmit();
      } else {
        dismissed = true;
        results.hide();
        get("show-results").focus();
      }
    },
  });
  document.querySelector("main")!.append(results.element);
  /** What the results screen last showed: it is rebuilt only when the result itself changed. */
  let shownResult = "";
  // Only the primary on a first show: a held Space must not press View arena.
  const focusResults = (any = false) =>
    results.actions
      .querySelector<HTMLButtonElement>(
        any ? "button.is-primary, button" : "button.is-primary",
      )
      ?.focus();
  get("show-results").onclick = () => {
    dismissed = false;
    results.element.hidden = false;
    focusResults(true);
  };
  let previous = "",
    lastRound = -1;
  return {
    /** Shows the room over the arena, or the arena. */
    open,
    isOpen: () => !lounge.hidden,
    /** The room's line: the connection, as the room reports it. */
    say(text: string) {
      status.textContent = text;
    },
    reset() {
      // Without the arena's focus and resize: the room is being left, not closed onto the arena.
      show(false);
      entered = false;
      back.hidden = true;
      overlay.hidden = true;
      results.hide();
      shownResult = "";
      get("show-results").hidden = true;
      previous = "";
      lastRound = -1;
      dismissed = false;
    },
    update(
      view: WorldView,
      selfId: string,
      manager: boolean,
      display: boolean,
      round: number,
      code: string,
      managerId: string,
    ) {
      const c = view.contest;
      if (round !== lastRound || c.phase !== "over") dismissed = false;
      lastRound = round;
      const result = matchResult(view, selfId, manager && !display);
      if (!result) {
        if (results.open) results.hide();
        shownResult = "";
      } else {
        // The bar's own fields do not rebuild the report; an account that turns up after the round gets its button.
        const shown = JSON.stringify([
          { ...result, host: false, waiting: "" },
          result.rows.map((row) => actions.friends.publicIdOfMember(row.id)),
        ]);
        const first = !shownResult;
        if (shown !== shownResult) {
          shownResult = shown;
          results.show(
            resultReport(result, {
              color: keeperColor,
              friend: (id) => {
                const publicId = actions.friends.publicIdOfMember(id);
                return publicId
                  ? actions.friends.friendButton(publicId)
                  : undefined;
              },
            }),
          );
          // A keeper looking at the arena keeps looking at it.
          if (dismissed) results.hide();
        }
        results.update(resultBar(result));
        if (first) focusResults();
      }
      const facts = JSON.stringify([
        c.phase,
        c.rules,
        c.seconds,
        c.entries,
        c.winners,
        view.map,
        view.keepers.map((k) => [
          k.id,
          k.name,
          k.bot,
          k.slot,
          k.connected,
          k.playing,
          c.phase === "over" ? k.tally : null,
        ]),
        view.bombMode,
        view.powers.length,
        selfId,
        manager,
        display,
        round,
        code,
        managerId,
      ]);
      if (facts === previous) return;
      previous = facts;
      if (inviteCode !== code) {
        inviteCode = code;
        inviteCard.replaceChildren(
          createInviteCard({
            code,
            link: get<HTMLInputElement>("invite-url").value,
            qr: (link) => QRCode.toDataURL(link, { margin: 1, width: 300 }),
          }).element,
        );
      }
      players.update(
        view.keepers.map((keeper) => ({
          id: keeper.id,
          slot: keeper.slot,
          name: keeper.name,
          status: keeper.bot ? "AI" : keeper.id === selfId ? "You" : "Ready",
          color: keeperColor(keeper.slot),
          host: keeper.id === managerId,
        })),
      );
      const seated = view.keepers.some((keeper) => keeper.id === selfId);
      join.form.hidden = display || seated;
      addAI.hidden = !manager || view.keepers.length >= 5;
      const local = view.keepers.find((k) => k.id === selfId);
      manages = manager;
      go.textContent = manager
        ? "START"
        : seated
          ? "ENTER ARENA"
          : "WATCH ARENA";
      // The manager starts from a seat; anybody else may walk in, or look on without one.
      go.disabled = manager && !seated;
      back.hidden = !manager || !entered;
      tv.hidden = !manager;
      note.textContent = manager
        ? c.rules === "free"
          ? "Free play. Pick a round mode in Settings to compete."
          : "START begins the round for everyone."
        : seated
          ? "The host picks the arena and starts the round. Enter the arena to explore meanwhile."
          : "Take a seat to play, or watch the arena.";
      get("match-map").textContent =
        view.map === "crossroads"
          ? "THE CROSSROADS"
          : view.map === "spire"
            ? "NEON SPIRE"
            : "LANTERN BELFRY";
      get("match-mode").textContent =
        c.rules === "free"
          ? "Free play"
          : c.rules === "score"
            ? "Hook score"
            : "Last keeper standing";
      get("clock-label").textContent =
        c.rules === "free"
          ? "EXPLORE"
          : c.phase === "over"
            ? "FINISHED"
            : c.phase === "waiting"
              ? "WAITING"
              : c.phase === "countdown"
                ? "STARTS IN"
                : "TIME LEFT";
      get("match-clock").textContent =
        c.rules === "free"
          ? "∞"
          : c.phase === "waiting"
            ? "—"
            : `${Math.floor(c.seconds / 60)}:${String(c.seconds % 60).padStart(2, "0")}`;
      get("spectator-state").textContent = display
        ? "SHARED DISPLAY"
        : !local?.connected
          ? "Joining keepers…"
          : c.phase === "waiting"
            ? "Invite a second keeper, or add a bot, to begin"
            : c.rules !== "free" && c.phase === "active" && !local.playing
              ? "WATCHING · back next round"
              : `P${local.slot + 1} · ${local.name}`;
      const countdown = c.rules !== "free" && c.phase === "countdown";
      const over = c.rules !== "free" && c.phase === "over";
      overlay.hidden = !countdown;
      overlay.dataset.phase = c.phase;
      get("countdown-card").hidden = !countdown;
      get("countdown-number").textContent = String(c.seconds);
      get("show-results").hidden = !over;
    },
  };
}
