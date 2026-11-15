import { el, button } from "fuse-ui";
import { SCORE_DIFFICULTIES, scorePercent, type ScoreEntry, type SongBoard } from "../song-scores.js";

export interface ScoreReader { catalog(): Promise<SongBoard[]>; leaderboard(song: string, chart: number): Promise<ScoreEntry[]> }
/** Long, searchable song table with real empty cells; each available difficulty opens its full ranking. */
export function createSongLeaderboards(reader: ScoreReader, doc: Document = document) {
  const element = el("section", "", "fm-song-scores", doc);
  element.setAttribute("aria-label", "Song highscores");
  const note = el("p", "Top verified score per chart. Select a difficulty for its leaderboard. Sign in before playing Score mode to enter.", "fm-score-note", doc);
  const search = el("input", "", "fm-score-search", doc);
  search.type = "search"; search.placeholder = "Find a song"; search.setAttribute("aria-label", "Find a song");
  const state = el("p", "Loading song scores…", "fm-score-state", doc);
  state.setAttribute("role", "status");
  const retry = button("RETRY", "", doc);
  retry.hidden = true;
  const wrap = el("div", "", "fm-score-scroll", doc);
  wrap.tabIndex = 0; wrap.setAttribute("role", "region"); wrap.setAttribute("aria-label", "Song highscores table");
  const detail = el("section", "", "fm-score-detail", doc);
  let songs: SongBoard[] = [], generation = 0, disposed = false;
  let retryAction = () => { void load(); };
  retry.onclick = () => retryAction();
  const open = async (song: SongBoard, chart: SongBoard["charts"][number]) => {
    const own = ++generation;
    detail.replaceChildren(el("h3", `${song.title} · ${chart.difficulty}`, "", doc), el("p", "Loading leaderboard…", "", doc));
    detail.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    try {
      const players = await reader.leaderboard(song.song, chart.chart);
      if (disposed || own !== generation) return;
      const list = el("ol", "", "fm-score-ranking", doc);
      for (const player of players) {
        const row = el("li", "", "", doc);
        row.append(el("span", player.name, "", doc), el("strong", scorePercent(player.rating), "", doc));
        list.append(row);
      }
      detail.replaceChildren(el("h3", `${song.title} · ${chart.difficulty}`, "", doc), players.length ? list : el("p", "No verified scores yet. Be the first to play this chart.", "", doc));
    } catch {
      if (disposed || own !== generation) return;
      const again = button("RETRY LEADERBOARD", "", doc); again.onclick = () => { void open(song, chart); };
      detail.replaceChildren(el("h3", `${song.title} · ${chart.difficulty}`, "", doc), el("p", "Could not load this leaderboard.", "", doc), again);
    }
  };
  const draw = () => {
    const table = el("table", "", "fm-score-table", doc);
    const head = el("thead", "", "", doc), tr = el("tr", "", "", doc);
    for (const label of ["SONG", ...SCORE_DIFFICULTIES]) { const th = el("th", label, "", doc); th.scope = "col"; tr.append(th); }
    head.append(tr);
    const body = el("tbody", "", "", doc);
    const query = search.value.trim().toLocaleLowerCase();
    const visible = songs.filter(song => song.title.toLocaleLowerCase().includes(query));
    for (const song of visible) {
      const row = el("tr", "", "", doc), name = el("th", song.title, "", doc); name.scope = "row"; row.append(name);
      for (const difficulty of SCORE_DIFFICULTIES) {
        const cell = el("td", "", "", doc), chart = song.charts.find(c => c.difficulty.toLowerCase() === difficulty.toLowerCase());
        if (chart) {
          // Empty charts have an invisible-text accessible link, preserving the deliberately blank cell.
          const pick = button("", "fm-score-pick", doc);
          pick.setAttribute("aria-label", `${song.title}, ${difficulty}: ${chart.top ? `${chart.top.name}, ${scorePercent(chart.top.rating)}` : "no scores yet"}. Open leaderboard`);
          if (chart.top) pick.append(el("span", chart.top.name, "", doc), el("strong", scorePercent(chart.top.rating), "", doc));
          pick.onclick = () => { void open(song, chart); };
          cell.append(pick);
        } else cell.setAttribute("aria-label", "Chart unavailable");
        row.append(cell);
      }
      body.append(row);
    }
    table.append(head, body); wrap.replaceChildren(table);
    state.textContent = visible.length ? `${visible.length} songs · Blank cells have no verified score.` : "No songs match your search.";
  };
  async function load() {
    state.textContent = "Loading song scores…"; retry.hidden = true;
    try {
      songs = (await reader.catalog()).slice().sort((a, b) => a.title.localeCompare(b.title));
      if (!disposed) draw();
    } catch { if (!disposed) { state.textContent = "Could not load song scores. Try again."; retry.hidden = false; retryAction = () => { void load(); }; } }
  }
  search.oninput = draw;
  element.append(note, search, state, retry, wrap, detail);
  void load();
  return { element, dispose() { disposed = true; generation++; } };
}
