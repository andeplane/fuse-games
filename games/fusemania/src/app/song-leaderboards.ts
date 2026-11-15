import { el, button } from "fuse-ui";
import { chartSlots } from "../chart-slots.js";
import {
  SCORE_DIFFICULTIES,
  scorePercent,
  type ScoreEntry,
  type SongBoard,
} from "../song-scores.js";
import { packsOf, type SongPack } from "./packs.js";
import { PACKS_DATA } from "./packs-data.js";

export interface ScoreSort {
  column: "song" | "pack" | "plays" | (typeof SCORE_DIFFICULTIES)[number];
  direction: "asc" | "desc";
}
export function sortScoreSongs(
  songs: readonly SongBoard[],
  sort: ScoreSort,
  packNames: ReadonlyMap<string, string> = new Map(),
): SongBoard[] {
  const title = (a: SongBoard, b: SongBoard) =>
    a.title.localeCompare(b.title, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...songs].sort((a, b) => {
    if (sort.column === "song") return sign * title(a, b);
    if (sort.column === "pack")
      return (
        sign *
          (packNames.get(a.song) ?? "").localeCompare(
            packNames.get(b.song) ?? "",
          ) || title(a, b)
      );
    const value = (song: SongBoard) =>
      sort.column === "plays"
        ? song.plays
        : chartSlots(song.charts).find((chart) => chart.slot === sort.column)
            ?.top?.rating;
    const left = value(a),
      right = value(b);
    if (left === undefined || right === undefined)
      return left === right ? title(a, b) : left === undefined ? 1 : -1;
    return sign * (left - right) || title(a, b);
  });
}
export interface ScoreReader {
  catalog(): Promise<SongBoard[]>;
  leaderboard(song: string, chart: number): Promise<ScoreEntry[]>;
}
export function createSongLeaderboards(
  reader: ScoreReader,
  doc: Document = document,
  options: {
    packs?: readonly SongPack[];
    openPlayer?(publicId: string, name: string): void;
    playHref?(song: string, chart: number): string;
    onViewChange?(song?: string): void;
  } = {},
) {
  const element = el("section", "", "fm-song-scores", doc);
  element.setAttribute("aria-label", "Song highscores");
  const browse = el("div", "", "fm-score-browse", doc);
  const intro = el("div", "", "fm-score-intro", doc);
  intro.append(
    el("h1", "Find your next high score.", "", doc),
    el("p", "Pick a song. See who leads. Make your mark.", "", doc),
  );
  const toolbar = el("div", "", "fm-score-toolbar", doc);
  const searchLabel = el(
    "label",
    "Search songs or packs",
    "fm-score-search-label",
    doc,
  );
  const search = el("input", "", "fm-score-search", doc);
  search.type = "search";
  search.placeholder = "Song title or pack name";
  searchLabel.append(search);
  const packLabel = el("label", "Song pack", "", doc);
  const packFilter = el("select", "", "fm-score-pack-filter", doc);
  packFilter.setAttribute("aria-label", "Song pack");
  packLabel.append(packFilter);
  const sortLabel = el("label", "Sort by", "", doc);
  const sortSelect = el("select", "", "fm-score-sort-select", doc);
  sortSelect.setAttribute("aria-label", "Sort by");
  const columns = ["song", "pack", "plays", ...SCORE_DIFFICULTIES] as const;
  const labels = ["Song", "Pack", "Verified plays", ...SCORE_DIFFICULTIES];
  for (const [index, column] of columns.entries()) {
    for (const direction of ["asc", "desc"] as const) {
      const option = el(
        "option",
        `${labels[index]} · ${column === "song" || column === "pack" ? (direction === "asc" ? "A–Z" : "Z–A") : direction === "asc" ? "lowest first" : "highest first"}`,
        "",
        doc,
      );
      option.value = `${column}:${direction}`;
      sortSelect.append(option);
    }
  }
  sortLabel.append(sortSelect);
  toolbar.append(searchLabel, packLabel, sortLabel);
  const state = el("p", "Loading song scores…", "fm-score-state", doc);
  state.setAttribute("role", "status");
  const retry = button("Try again", "fm-score-retry", doc);
  retry.hidden = true;
  const wrap = el("div", "", "fm-score-list", doc);
  const footnote = el(
    "p",
    "Verified plays count signed-in Score-mode completions on the current chart version since tracking began. Guest and Battle runs are excluded.",
    "fm-score-footnote",
    doc,
  );
  const detail = el("section", "", "fm-score-detail", doc);
  detail.hidden = true;
  detail.setAttribute("aria-label", "Selected song leaderboard");
  browse.append(intro, toolbar, state, retry, wrap, footnote);
  element.append(browse, detail);
  let songs: SongBoard[] = [],
    generation = 0,
    disposed = false;
  let sort: ScoreSort = { column: "song", direction: "asc" };
  let packNames = new Map<string, string>();
  let returnFocus: HTMLElement | undefined;
  const playerName = (player: ScoreEntry) => {
    if (!options.openPlayer || !player.publicId)
      return el("span", player.name, "fm-score-player", doc);
    const link = button(player.name, "fm-score-player-link", doc);
    link.setAttribute("aria-label", `View ${player.name}'s activity`);
    link.onclick = () => options.openPlayer?.(player.publicId!, player.name);
    return link;
  };
  function open(song: SongBoard, chartIndex: number, trigger: HTMLElement) {
    returnFocus = trigger;
    const charts = chartSlots(song.charts);
    browse.hidden = true;
    detail.hidden = false;
    options.onViewChange?.(song.title);
    const heading = el("h1", song.title, "", doc);
    heading.tabIndex = -1;
    const meta = el(
      "p",
      `${packNames.get(song.song) ?? ""} · ${song.plays === undefined ? "Play count unavailable" : `${song.plays.toLocaleString()} verified plays`}`,
      "fm-score-meta",
      doc,
    );
    const tabs = el("div", "", "fm-score-tabs", doc);
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Chart difficulty");
    const actions = el("div", "", "fm-score-detail-actions", doc);
    const play = el("a", "Play this chart", "fm-score-play", doc);
    const help = el(
      "p",
      "Sign in and finish a song in Score mode to join the leaderboard.",
      "fm-score-help",
      doc,
    );
    if (options.playHref) actions.append(play);
    actions.append(help);
    const message = el("p", "", "fm-score-board-state", doc);
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    const ranking = el("div", "", "fm-score-ranking", doc);
    detail.replaceChildren(heading, meta, tabs, actions, message, ranking);
    const loadChart = async (chosen: (typeof charts)[number]) => {
      const own = ++generation;
      for (const tab of tabs.querySelectorAll<HTMLButtonElement>("button"))
        tab.setAttribute(
          "aria-pressed",
          String(Number(tab.dataset.chart) === chosen.chart),
        );
      if (options.playHref)
        play.href = options.playHref(song.song, chosen.chart);
      message.textContent = `Loading ${chosen.slot.toLowerCase()} leaderboard…`;
      ranking.replaceChildren();
      try {
        const players = await reader.leaderboard(song.song, chosen.chart);
        if (disposed || own !== generation) return;
        message.textContent = players.length
          ? `${players.length} verified ${players.length === 1 ? "score" : "scores"} · ${chosen.slot}`
          : "No scores yet. Set the first one.";
        if (!players.length) {
          ranking.append(
            el(
              "p",
              "This leaderboard is waiting for its first finisher.",
              "fm-score-empty",
              doc,
            ),
          );
          return;
        }
        const table = el("table", "", "fm-score-board", doc);
        const caption = el(
          "caption",
          `${song.title} · ${chosen.slot} leaderboard`,
          "fm-score-sr-only",
          doc,
        );
        const head = el("thead", "", "", doc),
          header = el("tr", "", "", doc);
        for (const label of ["Rank", "Player", "Accuracy"]) {
          const cell = el("th", label, "", doc);
          cell.scope = "col";
          header.append(cell);
        }
        head.append(header);
        const body = el("tbody", "", "", doc);
        for (const [index, player] of players.entries()) {
          const row = el("tr", "", "", doc);
          const name = el("td", "", "", doc);
          name.append(playerName(player));
          row.append(
            el("td", String(index + 1).padStart(2, "0"), "fm-score-rank", doc),
            name,
            el("td", scorePercent(player.rating), "fm-score-accuracy", doc),
          );
          body.append(row);
        }
        table.append(caption, head, body);
        ranking.append(table);
      } catch {
        if (disposed || own !== generation) return;
        message.textContent = "Could not load this leaderboard.";
        const again = button("Try again", "fm-score-retry", doc);
        again.onclick = () => {
          void loadChart(chosen);
        };
        ranking.append(again);
      }
    };
    for (const slot of SCORE_DIFFICULTIES) {
      const chart = charts.find((item) => item.slot === slot);
      const tab = button(slot, "fm-score-tab", doc);
      tab.dataset.level = slot.toLowerCase();
      tab.disabled = !chart;
      tab.setAttribute("aria-pressed", "false");
      if (chart) {
        tab.dataset.chart = String(chart.chart);
        if (chart.meter !== undefined)
          tab.append(el("span", String(chart.meter), "fm-score-meter", doc));
        tab.onclick = () => {
          void loadChart(chart);
        };
      }
      tabs.append(tab);
    }
    const selected =
      charts.find((chart) => chart.chart === chartIndex) ?? charts.at(-1);
    play.hidden = !selected;
    if (selected) void loadChart(selected);
    else
      message.textContent = "No playable charts are available for this song.";
    heading.focus?.({ preventScroll: true });
    element.scrollIntoView?.({ block: "start" });
  }
  function draw() {
    const query = search.value.trim().toLocaleLowerCase();
    const visible = sortScoreSongs(
      songs.filter(
        (song) =>
          `${song.title} ${packNames.get(song.song) ?? ""}`
            .toLocaleLowerCase()
            .includes(query) &&
          (!packFilter.value || packNames.get(song.song) === packFilter.value),
      ),
      sort,
      packNames,
    );
    sortSelect.value = `${sort.column}:${sort.direction}`;
    const table = el("table", "", "fm-score-table", doc);
    const caption = el(
      "caption",
      "Song leaderboards: best verified accuracy by difficulty",
      "fm-score-sr-only",
      doc,
    );
    const head = el("thead", "", "", doc),
      header = el("tr", "", "", doc);
    for (const [index, column] of columns.entries()) {
      const cell = el("th", "", "", doc);
      cell.scope = "col";
      cell.dataset.column = column.toLowerCase();
      cell.setAttribute("aria-label", labels[index]!);
      if (sort.column === column)
        cell.setAttribute(
          "aria-sort",
          sort.direction === "asc" ? "ascending" : "descending",
        );
      const pick = button(labels[index]!, "fm-score-sort", doc);
      pick.setAttribute(
        "aria-label",
        `Sort by ${labels[index]}${SCORE_DIFFICULTIES.some((slot) => slot === column) ? " top score" : ""}`,
      );
      pick.onclick = (event) => {
        sort = {
          column,
          direction:
            sort.column === column
              ? sort.direction === "asc"
                ? "desc"
                : "asc"
              : column === "song" || column === "pack"
                ? "asc"
                : "desc",
        };
        draw();
        if (event.detail === 0)
          wrap
            .querySelectorAll<HTMLButtonElement>("thead button")
            [index]?.focus({ preventScroll: true });
      };
      cell.append(pick);
      header.append(cell);
    }
    head.append(header);
    const body = el("tbody", "", "", doc);
    for (const song of visible) {
      const charts = chartSlots(song.charts);
      const row = el("tr", "", "", doc);
      row.dataset.song = song.song;
      const name = el("th", "", "fm-score-song", doc);
      name.scope = "row";
      const songButton = button(song.title, "fm-score-song-link", doc);
      songButton.setAttribute("aria-label", `${song.title}: open leaderboard`);
      songButton.onclick = () =>
        open(song, charts.at(-1)?.chart ?? 0, songButton);
      name.append(songButton);
      row.append(
        name,
        el("td", packNames.get(song.song) ?? "", "fm-score-pack", doc),
        el("td", song.plays?.toLocaleString() ?? "—", "fm-score-plays", doc),
      );
      for (const slot of SCORE_DIFFICULTIES) {
        const cell = el("td", "", "fm-score-cell", doc);
        cell.dataset.label = slot;
        cell.dataset.level = slot.toLowerCase();
        const chart = charts.find((item) => item.slot === slot);
        if (chart) {
          const pick = button(
            chart.top ? scorePercent(chart.top.rating) : "Set a score",
            "fm-score-pick",
            doc,
          );
          pick.dataset.empty = String(!chart.top);
          pick.setAttribute(
            "aria-label",
            `${song.title}, ${slot}: ${chart.top ? `${chart.top.name}, ${scorePercent(chart.top.rating)}` : "no scores yet"}. Open leaderboard`,
          );
          pick.onclick = () => open(song, chart.chart, pick);
          cell.append(pick);
          if (chart.top) cell.append(playerName(chart.top));
        } else {
          cell.append(el("span", "—", "fm-score-unavailable", doc));
          cell.setAttribute("aria-label", `${slot}: chart unavailable`);
        }
        row.append(cell);
      }
      body.append(row);
    }
    table.append(caption, head, body);
    wrap.replaceChildren(table);
    state.textContent = visible.length
      ? `${visible.length} ${visible.length === 1 ? "song" : "songs"} · Select a song or a score to view its leaderboard.`
      : "No songs match. Try another title or pack.";
  }
  async function load() {
    state.textContent = "Loading song scores…";
    retry.hidden = true;
    toolbar.hidden = true;
    try {
      const loaded = await reader.catalog();
      if (disposed) return;
      songs = loaded;
      const packs = packsOf(
        songs.map((song) => ({ id: song.song })),
        undefined,
        options.packs ?? PACKS_DATA,
      );
      packNames = new Map(
        packs.flatMap((pack) =>
          pack.songs.map((song) => [song, pack.name] as const),
        ),
      );
      const all = el("option", "All packs", "", doc);
      all.value = "";
      packFilter.replaceChildren(all);
      for (const pack of packs) {
        const option = el("option", pack.name, "", doc);
        option.value = pack.name;
        packFilter.append(option);
      }
      toolbar.hidden = false;
      draw();
    } catch {
      if (!disposed) {
        state.textContent = "Could not load song scores. Try again.";
        retry.hidden = false;
      }
    }
  }
  retry.onclick = () => {
    void load();
  };
  search.oninput = draw;
  packFilter.onchange = draw;
  sortSelect.onchange = () => {
    const [column, direction] = sortSelect.value.split(":");
    const valid = columns.find((value) => value === column);
    if (valid && (direction === "asc" || direction === "desc")) {
      sort = { column: valid, direction };
      draw();
    }
  };
  void load();
  return {
    element,
    back() {
      if (detail.hidden) return false;
      generation++;
      detail.hidden = true;
      browse.hidden = false;
      options.onViewChange?.();
      returnFocus?.focus?.({ preventScroll: true });
      returnFocus?.scrollIntoView?.({ block: "nearest" });
      return true;
    },
    dispose() {
      disposed = true;
      generation++;
    },
  };
}
