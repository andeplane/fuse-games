import { el, button } from "fuse-ui";
import {
  SCORE_DIFFICULTIES,
  scorePercent,
  type ScoreEntry,
  type SongBoard,
} from "../song-scores.js";
import { packsOf, type SongPack } from "./packs.js";
import { PACKS_DATA } from "./packs-data.js";

export interface ScoreSort { column: "song" | (typeof SCORE_DIFFICULTIES)[number]; direction: "asc" | "desc" }
export function sortScoreSongs(songs: readonly SongBoard[], sort: ScoreSort): SongBoard[] {
  const title = (a: SongBoard, b: SongBoard) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...songs].sort((a, b) => {
    if (sort.column === "song") return sign * title(a, b);
    const score = (song: SongBoard) => song.charts.find(chart => chart.difficulty.toLowerCase() === sort.column.toLowerCase())?.top?.rating;
    const left = score(a), right = score(b);
    if (left === undefined || right === undefined) return left === right ? title(a, b) : left === undefined ? 1 : -1;
    return sign * (left - right) || title(a, b);
  });
}

export interface ScoreReader {
  catalog(): Promise<SongBoard[]>;
  leaderboard(song: string, chart: number): Promise<ScoreEntry[]>;
}
/** Long, searchable song table with real empty cells; each available difficulty opens its full ranking. */
export function createSongLeaderboards(
  reader: ScoreReader,
  doc: Document = document,
  options: { packs?: readonly SongPack[]; openPlayer?(publicId: string, name: string): void } = {},
) {
  const element = el("section", "", "fm-song-scores", doc);
  element.setAttribute("aria-label", "Song highscores");
  const note = el(
    "p",
    "Top verified score per chart. Select a difficulty for its leaderboard. Sign in before playing Score mode to enter.",
    "fm-score-note",
    doc,
  );
  const search = el("input", "", "fm-score-search", doc);
  search.type = "search";
  search.placeholder = "Find a song";
  search.setAttribute("aria-label", "Find a song");
  const state = el("p", "Loading song scores…", "fm-score-state", doc);
  state.setAttribute("role", "status");
  const retry = button("RETRY", "", doc);
  retry.hidden = true;
  const wrap = el("div", "", "fm-score-scroll", doc);
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", "Song highscores table");
  const detail = el("section", "", "fm-score-detail", doc);
  detail.setAttribute("aria-label", "Selected song leaderboard");
  const scrollHint = el(
    "p",
    "Scroll sideways to see all four difficulties.",
    "fm-score-scroll-hint",
    doc,
  );
  let songs: SongBoard[] = [],
    generation = 0,
    disposed = false;
  let sort: ScoreSort = { column: "song", direction: "asc" };
  const playerName = (player: ScoreEntry) => {
    if (!options.openPlayer || !player.publicId) return el("span", player.name, "", doc);
    const link = button(player.name, "fm-score-player-link", doc);
    link.setAttribute("aria-label", `View ${player.name}'s activity`);
    link.onclick = () => options.openPlayer?.(player.publicId!, player.name);
    return link;
  };
  let retryAction = () => {
    void load();
  };
  retry.onclick = () => retryAction();
  const open = async (song: SongBoard, chart: SongBoard["charts"][number]) => {
    const own = ++generation;
    const heading = el("h3", `${song.title} · ${chart.difficulty}`, "", doc);
    heading.tabIndex = -1;
    const message = el("p", "Loading leaderboard…", "", doc);
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    detail.replaceChildren(heading, message);
    detail.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    heading.focus?.({ preventScroll: true });
    try {
      const players = await reader.leaderboard(song.song, chart.chart);
      if (disposed || own !== generation) return;
      const list = el("ol", "", "fm-score-ranking", doc);
      for (const player of players) {
        const row = el("li", "", "", doc);
        row.append(
          playerName(player),
          el("strong", scorePercent(player.rating), "", doc),
        );
        list.append(row);
      }
      message.textContent = players.length
        ? `${players.length} verified ${players.length === 1 ? "score" : "scores"}.`
        : "No verified scores yet. Be the first to play this chart.";
      if (players.length) detail.append(list);
    } catch {
      if (disposed || own !== generation) return;
      const again = button("RETRY LEADERBOARD", "", doc);
      again.onclick = () => {
        void open(song, chart);
      };
      message.textContent = "Could not load this leaderboard.";
      detail.append(again);
    }
  };
  const draw = () => {
    const table = el("table", "", "fm-score-table", doc);
    const head = el("thead", "", "", doc),
      tr = el("tr", "", "", doc);
    for (const [index, label] of ["SONG", ...SCORE_DIFFICULTIES].entries()) {
      const th = el("th", label, "", doc);
      th.scope = "col";
      const column = index === 0 ? "song" : SCORE_DIFFICULTIES[index - 1]!;
      if (sort.column === column) th.setAttribute("aria-sort", sort.direction === "asc" ? "ascending" : "descending");
      const pick = button(label, "fm-score-sort", doc);
      pick.setAttribute("aria-label", index === 0 ? "Sort by song title" : `Sort by ${label} top score`);
      pick.onclick = () => {
        sort = { column, direction: sort.column === column ? sort.direction === "asc" ? "desc" : "asc" : column === "song" ? "asc" : "desc" };
        draw();
        wrap.querySelectorAll<HTMLButtonElement>("thead button")[index]?.focus({ preventScroll: true });
      };
      th.replaceChildren(pick);
      tr.append(th);
    }
    head.append(tr);
    const query = search.value.trim().toLocaleLowerCase();
    const visible = songs.filter((song) =>
      song.title.toLocaleLowerCase().includes(query),
    );
    table.append(head);
    for (const pack of packsOf(songs.map(song => ({ id: song.song })), undefined, options.packs ?? PACKS_DATA)) {
      const members = new Set(pack.songs);
      const grouped = sortScoreSongs(visible.filter(song => members.has(song.song)), sort);
      if (!grouped.length) continue;
      const body = el("tbody", "", "", doc);
      body.setAttribute("aria-label", pack.name);
      const group = el("tr", "", "fm-score-pack", doc), label = el("th", pack.name, "", doc);
      label.colSpan = 5;
      label.scope = "rowgroup";
      group.append(label); body.append(group);
    for (const song of grouped) {
      const row = el("tr", "", "", doc),
        name = el("th", song.title, "", doc);
      name.scope = "row";
      row.dataset.song = song.song;
      row.append(name);
      for (const difficulty of SCORE_DIFFICULTIES) {
        const cell = el("td", "", "", doc),
          chart = song.charts.find(
            (c) => c.difficulty.toLowerCase() === difficulty.toLowerCase(),
          );
        if (chart) {
          // Empty charts have an invisible-text accessible link, preserving the deliberately blank cell.
          const pick = button("", "fm-score-pick", doc);
          pick.setAttribute(
            "aria-label",
            `${song.title}, ${difficulty}: ${chart.top ? `${chart.top.name}, ${scorePercent(chart.top.rating)}` : "no scores yet"}. Open leaderboard`,
          );
          if (chart.top) {
            if (options.openPlayer && chart.top.publicId) { cell.append(playerName(chart.top)); pick.classList.add("has-score"); }
            else pick.append(playerName(chart.top));
            pick.append(el("strong", scorePercent(chart.top.rating), "", doc));
          }
          pick.onclick = () => {
            void open(song, chart);
          };
          cell.append(pick);
        } else cell.setAttribute("aria-label", "Chart unavailable");
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body);
    }
    wrap.replaceChildren(table);
    state.textContent = visible.length
      ? `${visible.length} ${visible.length === 1 ? "song" : "songs"} · Blank cells have no verified score.`
      : "No songs match your search.";
  };
  async function load() {
    state.textContent = "Loading song scores…";
    retry.hidden = true;
    try {
      songs = (await reader.catalog())
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title));
      if (!disposed) draw();
    } catch {
      if (!disposed) {
        state.textContent = "Could not load song scores. Try again.";
        retry.hidden = false;
        retryAction = () => {
          void load();
        };
      }
    }
  }
  search.oninput = draw;
  element.append(note, search, state, retry, scrollHint, wrap, detail);
  void load();
  return {
    element,
    dispose() {
      disposed = true;
      generation++;
    },
  };
}
