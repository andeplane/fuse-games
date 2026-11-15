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
} from "fuse-ui";
import QRCode from "qrcode";

/** Presentation of replicated facts. All actions reuse the room's existing controls. */
export function createMatchShell(actions: {
  join(name: string, slot?: number): void;
  addAI(slot?: number): void;
  playerName?(): string | undefined;
  /** Out of the room, as the menu's Leave does. */
  leave(): void;
  /** The account behind a seat, once known, and the friend button for it. */
  friends: {
    publicIdOfMember(memberId: string): string | undefined;
    friendButton(publicId: string): HTMLElement;
  };
}) {
  const get = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const lounge = document.createElement("details");
  lounge.id = "room-lounge";
  lounge.open = true;
  lounge.innerHTML = `<summary>Room & match <span id="lounge-summary"></span></summary><p id="room-authority" role="status"></p><div class="lounge-content"></div>`;
  document.querySelector("header")!.after(lounge);
  const content = lounge.querySelector(".lounge-content")!;
  content.append(
    get("invitation"),
    get("experiment").closest("section")!,
    get("rules").closest("section")!,
  );
  const workshop = get("tuning").closest("details")!;
  workshop.id = "development-workshop";
  workshop.querySelector("summary")!.textContent =
    "Development workshop · movement & control experiments";
  const controls = get("reset").closest("section")!;
  get("experiment").closest("section")!.append(get("reset"));
  workshop.append(
    get("jump-mode").closest("section")!,
    get("zone-controls"),
    controls,
    document.querySelector(".room-entry")!,
  );
  const preferences = document.createElement("section");
  preferences.className = "controls personal-controls";
  preferences.setAttribute("aria-label", "Your controls and atmosphere");
  content.append(preferences);
  for (const id of [
    "keyboard-mode",
    "touch-toggle",
    "aim-mode",
    "atmosphere",
    "follow-cam",
  ])
    preferences.append(get(id).closest("label")!);
  preferences.append(get("control-help"));
  content.append(document.querySelector("[data-radio]")!);
  const inviteHolder = document.createElement("div");
  const players = createRoster();
  const join = createNameEntry({
    initial: actions.playerName?.() ?? "",
    normalize: (value) => value.trim().slice(0, 24),
    onSubmit: (name) => actions.join(name, requestedRoomSlot(join.form)),
  });
  const addAI = button("Add AI");
  addAI.onclick = () => actions.addAI(requestedRoomSlot(addAI));
  const settingsParts = [...content.children].filter(
    (node) => node.id !== "invitation",
  );
  const roomLayout = createRoomLayout({
    primaryAction: get("restart-room"),
    background: async (host, signal) =>
      (await import("./attract.js")).createAttract(host, signal),
    element: content as HTMLElement,
    invite: inviteHolder,
    roster: players,
    capacity: 5,
    join: join.form,
    playerName: actions.playerName,
    addAI,
    settings: settingsParts,
    actions: [get("invitation")],
  });
  let inviteCode = "";
  // The room's background is a whole WebGL scene. Under the entrance menu nobody sees it, and it would draw beside
  // the menu's own and the playground behind both: three scenes at once starve the page where WebGL has no GPU.
  const syncBackground = () =>
    roomLayout.setActive(
      lounge.open && !document.body.classList.contains("at-entrance"),
    );
  lounge.addEventListener("toggle", syncBackground);
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
    reset() {
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
      ]);
      if (facts === previous) return;
      previous = facts;
      if (inviteCode !== code) {
        inviteCode = code;
        inviteHolder.replaceChildren(
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
        })),
      );
      join.form.hidden =
        display || view.keepers.some((keeper) => keeper.id === selfId);
      addAI.hidden = !manager || view.keepers.length >= 5;
      const local = view.keepers.find((k) => k.id === selfId);
      get("lounge-summary").textContent =
        `${code} · ${view.keepers.filter((k) => k.connected).length}/5 keepers`;
      get("room-authority").textContent = display
        ? "Shared display · invite friends from a player device."
        : manager
          ? "You manage this room. Explore now; choose a round mode to compete. Match choices restart the shared trial."
          : "The room manager chooses the arena and starts the next round. You can explore during free play.";
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
