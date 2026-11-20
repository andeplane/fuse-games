import { el } from "./dom.js";

/**
 * The end of a match, the same in every game: the masthead (the game, MATCH COMPLETE, rounds and players), the
 * winner large, FINAL STANDINGS with the game's own stat columns, MATCH HIGHLIGHTS, whatever else the game has to
 * show (a graph), the full statistics behind "View full stats", and a bar with the READY count, the room's next
 * steps and Back. It is Fuse Riders' results screen with the game's parts as data; `results.css` styles it.
 *
 * A game says what happened in a `ResultsReport` and what can be done next in a `ResultsBar`. Names reach the page
 * through `textContent` only.
 */

/** One line of the standings. */
export interface ResultsRow {
  /** Stable across frames: the player's id. */
  id: string;
  /** 1 for the winner; players who tied share a placement. */
  placement: number;
  name: string;
  /** The player's colour: the marker, the row's tint and its name when it is this device's. */
  color: string;
  /** This device's own player: tinted, and tagged YOU. */
  you?: boolean;
  /** A short tag after the name: "AI", a team. */
  tag?: string;
  /** In place of the coloured diamond: an avatar. */
  marker?: HTMLElement;
  /** FRIENDS or + ADD FRIEND for another human whose account is known (`social-friends.ts`'s `friendButton`). */
  friend?: HTMLElement | undefined;
  /** One value per column, in the columns' order. */
  values: readonly string[];
}

interface PlayerStanding {
  id: string;
  name: string;
  place: number;
  you: boolean;
  bot: boolean;
}

/** Map a game's standings to the shared roster, with that game's colours and statistics. */
export function playerResultRows<Row extends PlayerStanding, ColorKey>(
  rows: readonly Row[],
  parts: {
    color: (key: ColorKey) => string;
    friend?: (id: string) => HTMLElement | undefined;
  },
  presentation: {
    colorKey: (row: Row) => ColorKey;
    values: (row: Row) => readonly string[];
  },
): ResultsRow[] {
  return rows.map((row) => ({
    id: row.id,
    placement: row.place,
    name: row.name,
    color: parts.color(presentation.colorKey(row)),
    you: row.you,
    ...(row.bot ? { tag: "AI" } : {}),
    friend: row.you || row.bot ? undefined : parts.friend?.(row.id),
    values: presentation.values(row),
  }));
}

/** A card of the highlights panel: an award and who took it. */
export interface ResultsHighlight {
  /** One glyph, drawn large in the first winner's colour. */
  icon: string;
  title: string;
  winners: readonly { name: string; color: string }[];
  detail: string;
}

/** Append a highlight for all players tied for a positive best score, in standings order. */
export function createTopResultHighlight<Row extends { name: string }>(
  rows: readonly Row[],
  color: (row: Row) => string,
  cards: ResultsHighlight[],
) {
  return (
    pick: (row: Row) => number,
    card: (best: number) => Omit<ResultsHighlight, "winners">,
  ) => {
    const best = Math.max(0, ...rows.map(pick));
    if (best > 0)
      cards.push({
        ...card(best),
        winners: rows
          .filter((row) => pick(row) === best)
          .map((row) => ({ name: row.name, color: color(row) })),
      });
  };
}

export interface ResultsReport {
  /** The game's name, at the top left: "FUSE RIDERS". */
  game: string;
  /** Default "MATCH COMPLETE"; a past match says when it was played. */
  kicker?: string;
  /** Under the kicker: "5 rounds / 3 riders". */
  context?: string;
  /** The winner banner: "ANDEPLANE WINS", "SHARED VICTORY", a solo run's grade. */
  headline: string;
  /** Under the headline: "11 points · 3 round wins". */
  summary?: string;
  /** The winner's colour, for the crown and the headline's glow. Default violet, as a shared victory has. */
  accent?: string;
  /** In place of the crown: a grade, a medal. One or two characters. */
  emblem?: string;
  standings?: {
    /** Default "FINAL STANDINGS". */
    title?: string;
    /** What the name column is headed: "RIDER", "PLAYER". Default "PLAYER". */
    nameLabel?: string;
    /** The game's stat columns, at most four on a phone: "POINTS", "WINS". */
    columns: readonly string[];
    rows: readonly ResultsRow[];
    /** A line under the table: how a tie was decided. */
    note?: string;
  };
  highlights?: {
    /** Default "MATCH HIGHLIGHTS". */
    title?: string;
    cards: readonly ResultsHighlight[];
    /** What the panel says when there is no card. */
    empty?: string;
  };
  /** Sections of the game's own under the overview, always showing: a timing graph, a session's standings. */
  sections?: readonly { title: string; content: readonly Node[] }[];
  /** The full statistics, hidden until "View full stats" is pressed. */
  details?: {
    /** Default "FULL MATCH STATS". */
    title?: string;
    content: readonly Node[];
    /** Open from the start, for a view with no toggle. */
    expanded?: boolean;
  };
  /** Said in place of everything under the masthead when there is nothing to report. */
  empty?: string;
}

/** The report itself, without the bar: for a game that shows it in a view of its own (a past match). */
export function renderResults(
  report: ResultsReport,
  doc: Document = document,
): HTMLElement {
  const root = el("section", "", "fui-results-report", doc);
  const masthead = el("header", "", "fui-results-masthead", doc),
    context = el("div", "", "fui-results-context", doc);
  context.append(el("span", report.kicker ?? "MATCH COMPLETE", "", doc));
  if (report.context) context.append(el("small", report.context, "", doc));
  masthead.append(el("strong", report.game, "fui-results-brand", doc), context);
  root.append(masthead);
  if (report.empty) {
    root.append(el("p", report.empty, "fui-results-empty", doc));
    return root;
  }

  const hero = el("section", "", "fui-results-victory", doc);
  if (report.accent) hero.style.setProperty("--winner-color", report.accent);
  const crown = el(
    "span",
    report.emblem ?? "",
    report.emblem ? "fui-results-emblem" : "fui-results-crown",
    doc,
  );
  crown.setAttribute("aria-hidden", "true");
  hero.append(crown, el("h2", report.headline, "", doc));
  if (report.summary) hero.append(el("p", report.summary, "", doc));
  root.append(hero);

  const overview = el("div", "", "fui-results-overview", doc);
  if (report.standings) overview.append(standings(report.standings, doc));
  if (report.highlights) overview.append(highlights(report.highlights, doc));
  if (overview.childElementCount === 1) overview.classList.add("is-single");
  if (overview.childElementCount) root.append(overview);

  for (const section of report.sections ?? []) {
    const block = el("section", "", "fui-results-section", doc);
    block.append(el("h3", section.title, "", doc), ...section.content);
    root.append(block);
  }

  if (report.details) {
    const details = el("section", "", "fui-results-details", doc);
    details.hidden = !report.details.expanded;
    details.append(
      el("h3", report.details.title ?? "FULL MATCH STATS", "", doc),
      ...report.details.content,
    );
    root.append(details);
  }
  return root;
}

function standings(
  view: NonNullable<ResultsReport["standings"]>,
  doc: Document,
): HTMLElement {
  const title = view.title ?? "FINAL STANDINGS";
  const section = el("section", "", "fui-results-standings", doc);
  section.append(el("h3", title, "", doc));
  const table = el("table", "", "", doc);
  table.setAttribute("aria-label", title);
  const head = el("thead", "", "", doc),
    labels = el("tr", "", "", doc);
  for (const label of ["#", view.nameLabel ?? "PLAYER", ...view.columns]) {
    const cell = el("th", label, "", doc);
    cell.scope = "col";
    labels.append(cell);
  }
  head.append(labels);
  const body = el("tbody", "", "", doc);
  for (const entry of view.rows) {
    const row = el(
      "tr",
      "",
      [entry.placement === 1 ? "is-champion" : "", entry.you ? "is-you" : ""]
        .filter(Boolean)
        .join(" "),
      doc,
    );
    row.style.setProperty("--player-color", entry.color);
    const cell = el("th", "", "", doc);
    cell.scope = "row";
    const name = el("span", "", "fui-results-name", doc);
    if (entry.marker) {
      entry.marker.classList.add("fui-results-marker");
      name.append(entry.marker);
    } else {
      const diamond = el("i", "", "", doc);
      diamond.setAttribute("aria-hidden", "true");
      name.append(diamond);
    }
    name.append(el("span", entry.name, "", doc));
    if (entry.you && entry.name.toUpperCase() !== "YOU")
      name.append(el("small", "YOU", "", doc));
    if (entry.tag) name.append(el("small", entry.tag, "is-tag", doc));
    if (entry.friend) name.append(entry.friend);
    cell.append(name);
    row.append(
      el("td", String(entry.placement).padStart(2, "0"), "", doc),
      cell,
      ...view.columns.map((_, index) =>
        el("td", entry.values[index] ?? "", "", doc),
      ),
    );
    body.append(row);
  }
  table.append(head, body);
  section.append(table);
  if (view.note) section.append(el("p", view.note, "fui-results-note", doc));
  return section;
}

function highlights(
  view: NonNullable<ResultsReport["highlights"]>,
  doc: Document,
): HTMLElement {
  const panel = el("aside", "", "fui-results-featured", doc);
  panel.append(el("h3", view.title ?? "MATCH HIGHLIGHTS", "", doc));
  for (const card of view.cards) {
    const article = el("article", "", "fui-results-feature", doc);
    const icon = el("span", card.icon, "fui-results-feature-icon", doc);
    icon.setAttribute("aria-hidden", "true");
    if (card.winners[0]) icon.style.color = card.winners[0].color;
    const copy = el("div", "", "", doc);
    copy.append(el("h4", card.title, "", doc));
    if (card.winners.length) {
      const names = el("p", "", "fui-results-feature-names", doc);
      card.winners.forEach((winner, index) => {
        if (index) names.append(" + ");
        const name = el("span", winner.name, "", doc);
        name.style.color = winner.color;
        names.append(name);
      });
      copy.append(names);
    }
    copy.append(el("small", card.detail, "", doc));
    article.append(icon, copy);
    panel.append(article);
  }
  if (!view.cards.length)
    panel.append(
      el(
        "p",
        view.empty ?? "The standings tell the story this time.",
        "fui-results-note",
        doc,
      ),
    );
  return panel;
}

/** A button of the bar. */
export interface ResultsAction {
  /** Stable across frames; also the button's `data-action`, for a test or a smoke to find it by. */
  id: string;
  label: string;
  /** The one the bar leads to: READY FOR REMATCH, PLAY AGAIN, NEXT LEVEL. Drawn framed, at the right. */
  primary?: boolean;
  /** A vote that has been cast (`aria-pressed`). */
  pressed?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

/** What the bar shows on a frame. */
export interface ResultsBar {
  /** "3/5 ready", or a line for whoever waits on the host. Omit in a solo run. */
  status?: string;
  /** Secondary actions first, the primary one last. */
  actions: readonly ResultsAction[];
  /** false hides Back on this frame (a solo run whose bar already leads out). Default: shown where the game gave `onBack`. */
  back?: boolean;
}

/** The standard room actions and waiting message for a finished match. */
export function roomResultsBar(result: {
  host: boolean;
  waiting?: string | null | undefined;
}): ResultsBar {
  return {
    ...(result.waiting ? { status: result.waiting } : {}),
    actions: result.host
      ? [
          { id: "lobby", label: "Back to lobby" },
          { id: "rematch", label: "REMATCH", primary: true },
        ]
      : [],
  };
}

export interface ResultsScreenOptions {
  /** A button of the bar was pressed. */
  onAction: (id: string) => void;
  /** Back, at the top right, and Escape. Omit for a screen that can only be left through the bar. */
  onBack?: () => void;
  /** What Back says. Default "Back". */
  backText?: string;
  document?: Document;
}

export interface ResultsScreen {
  /** `section.fui-results`, hidden until shown. The game appends it to its `.fui-app` page. */
  element: HTMLElement;
  /** Where the report is: for a game that draws into one of its sections after showing it. */
  body: HTMLElement;
  /** The bar's buttons, for a game that walks them with the arrow keys (`menuKeys`). */
  actions: HTMLElement;
  /** Shows `report`, replacing what was there, scrolled to the top with the full stats closed. */
  show(report: ResultsReport): void;
  /** The frame's status line and buttons; only a value that changed reaches the DOM. */
  update(bar: ResultsBar): void;
  hide(): void;
  readonly open: boolean;
}

interface LiveResult {
  host: boolean;
  waiting: string;
  rows: readonly { id: string }[];
}

type ResultFriend = (id: string) => HTMLElement | undefined;

interface ResultFrame<T> {
  friends?:
    | {
        publicIdOfMember(id: string): string | undefined;
        friendButton(id: string): HTMLElement;
      }
    | undefined;
  report(result: T, friend: ResultFriend | undefined): ResultsReport;
  bar(result: T): ResultsBar;
  /** Extra report state, such as a match identity or access to a post-race shop. */
  revision?: string | boolean;
  /** An arena that temporarily hides the report may keep it hidden after a rebuild. */
  afterShow?(): void;
}

/** Keeps a live report stable while waiting text or host controls change. */
export function createLiveResults(
  screen: ResultsScreen,
  { focusPrimary = true } = {},
) {
  let previous = "";
  const clear = () => {
    previous = "";
    if (screen.open) screen.hide();
  };
  return {
    clear,
    render<T extends LiveResult>(
      result: T | null | undefined,
      { friends, report, bar, revision, afterShow }: ResultFrame<T>,
    ): void {
      if (!result) {
        clear();
        return;
      }
      const key = JSON.stringify([
        revision,
        { ...result, host: false, waiting: "" },
        result.rows.map(({ id }) => friends?.publicIdOfMember(id)),
      ]);
      const first = !previous;
      if (key !== previous) {
        previous = key;
        screen.show(
          report(
            result,
            friends &&
              ((id) => {
                const publicId = friends.publicIdOfMember(id);
                return publicId ? friends.friendButton(publicId) : undefined;
              }),
          ),
        );
        afterShow?.();
      }
      screen.update(bar(result));
      if (first && focusPrimary)
        screen.actions
          .querySelector<HTMLButtonElement>("button.is-primary")
          ?.focus?.();
    },
  };
}

/** Patch the presentation of a mounted action without replacing its button. */
function updateResultAction(
  button: HTMLButtonElement,
  action: ResultsAction,
): void {
  if (button.textContent !== action.label) button.textContent = action.label;
  const className = action.primary ? "is-primary" : "";
  if (button.className !== className) button.className = className;
  const pressed = action.pressed === undefined ? null : `${action.pressed}`;
  if (button.getAttribute("aria-pressed") !== pressed)
    if (pressed === null) button.removeAttribute("aria-pressed");
    else button.setAttribute("aria-pressed", pressed);
  if (button.disabled !== !!action.disabled)
    button.disabled = !!action.disabled;
  if (button.hidden !== !!action.hidden) button.hidden = !!action.hidden;
}

const STATS_CLOSED = "View full stats ↗",
  STATS_OPEN = "Hide full stats ↗";

/** The whole screen: the report over the game, and the bar under it. */
export function createResultsScreen(
  options: ResultsScreenOptions,
): ResultsScreen {
  const doc = options.document ?? document;
  const element = el("section", "", "fui-results", doc);
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", "Match results");
  element.hidden = true;
  const body = el("div", "", "fui-results-body", doc),
    bar = el("footer", "", "fui-results-bar", doc),
    actions = el("span", "", "fui-results-actions", doc),
    status = el("span", "", "fui-results-status", doc),
    fullStats = el("button", STATS_CLOSED, "fui-results-stats-toggle", doc),
    back = el("button", options.backText ?? "Back", "fui-results-back", doc);
  status.setAttribute("role", "status");
  status.hidden = true;
  fullStats.type = back.type = "button";
  fullStats.hidden = true;
  back.hidden = !options.onBack;
  back.onclick = () => options.onBack?.();
  const details = () => body.querySelector<HTMLElement>(".fui-results-details");
  fullStats.onclick = () => {
    const section = details();
    if (!section) return;
    section.hidden = !section.hidden;
    fullStats.setAttribute("aria-expanded", String(!section.hidden));
    fullStats.textContent = section.hidden ? STATS_CLOSED : STATS_OPEN;
    if (!section.hidden) section.scrollIntoView?.({ block: "start" });
    else body.scrollTop = 0;
  };
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !options.onBack || back.hidden) return;
    event.preventDefault();
    options.onBack();
  });
  actions.append(status);
  bar.append(fullStats, actions);
  element.append(back, body, bar);

  const buttons = new Map<string, HTMLButtonElement>();
  let order = "";
  return {
    element,
    body,
    actions,
    get open() {
      return !element.hidden;
    },
    show(report) {
      body.replaceChildren(renderResults(report, doc));
      const section = details();
      fullStats.hidden = !section || !section.hidden;
      fullStats.textContent = STATS_CLOSED;
      fullStats.setAttribute("aria-expanded", "false");
      element.hidden = false;
      body.scrollTop = 0;
    },
    update(next) {
      const noBack = !options.onBack || next.back === false;
      if (back.hidden !== noBack) back.hidden = noBack;
      const text = next.status ?? "";
      if (status.textContent !== text) status.textContent = text;
      if (status.hidden !== !text) status.hidden = !text;
      const ids = next.actions.map((action) => action.id);
      const nextOrder = ids.join("\n");
      if (nextOrder !== order) {
        order = nextOrder;
        const mounted = new Set(ids);
        // Moving a button drops its focus: whoever had it gets it back.
        const focused = [...buttons.values()].find(
          (button) => button === doc.activeElement,
        );
        for (const [id, button] of buttons)
          if (!mounted.has(id)) {
            button.remove();
            buttons.delete(id);
          }
        for (const action of next.actions) {
          let button = buttons.get(action.id);
          if (!button) {
            button = el("button", "", "", doc);
            button.type = "button";
            button.dataset.action = action.id;
            button.onclick = () => options.onAction(action.id);
            buttons.set(action.id, button);
          }
          actions.append(button);
        }
        if (focused?.isConnected) focused.focus();
      }
      for (const action of next.actions) {
        const button = buttons.get(action.id)!;
        updateResultAction(button, action);
      }
    },
    hide() {
      element.hidden = true;
    },
  };
}
