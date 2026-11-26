import { button, el } from "fuse-ui";
import { RACE_LIMIT, centiseconds } from "../engine/index.js";
import {
  LEVEL_BOARD_PAGE_SIZE,
  LEVEL_BOARD_PLACES,
  type LevelBoardPage,
  type LevelTime,
} from "../level-times.js";
import { clockText } from "../render/hud.js";

const validName = (name: unknown): name is string =>
  typeof name === "string" && name.length > 0 && name.length <= 80;

export function parseLevelBoardPage(
  body: unknown,
  from: number,
  levelCount: number,
): LevelBoardPage {
  if (!body || typeof body !== "object" || !("levels" in body))
    throw new Error("Invalid leaderboard");
  const expected = Math.min(LEVEL_BOARD_PAGE_SIZE, levelCount - from);
  if (!Array.isArray(body.levels) || body.levels.length !== expected)
    throw new Error("Invalid leaderboard page");
  const levels = body.levels.map((times: unknown): LevelTime[] => {
    if (!Array.isArray(times) || times.length > LEVEL_BOARD_PLACES)
      throw new Error("Invalid level times");
    return times.map((time: unknown) => {
      if (
        !time ||
        typeof time !== "object" ||
        !("name" in time) ||
        !("steps" in time)
      )
        throw new Error("Invalid leaderboard row");
      const { name, steps } = time;
      if (
        !validName(name) ||
        typeof steps !== "number" ||
        !Number.isInteger(steps) ||
        steps < 1 ||
        steps > RACE_LIMIT
      )
        throw new Error("Invalid leaderboard row");
      return { name, steps };
    });
  });
  if (from !== 0) return { levels };
  const standings = "standings" in body ? body.standings : undefined;
  if (!Array.isArray(standings) || standings.length > levelCount)
    throw new Error("Invalid record standings");
  return {
    levels,
    standings: standings.map((row: unknown) => {
      if (
        !row ||
        typeof row !== "object" ||
        !("name" in row) ||
        !("records" in row)
      )
        throw new Error("Invalid record standings");
      const { name, records } = row;
      if (
        !validName(name) ||
        typeof records !== "number" ||
        !Number.isInteger(records) ||
        records < 1 ||
        records > levelCount
      )
        throw new Error("Invalid record standings");
      return { name, records };
    }),
  };
}

function rankingTable(title: string, headings: readonly string[]) {
  const table = el("table");
  const head = el("thead");
  const row = el("tr");
  for (const heading of headings) {
    const th = el("th", heading);
    th.scope = "col";
    row.append(th);
  }
  head.append(row);
  const rows = el("tbody");
  table.hidden = true;
  table.append(el("caption", title), head, rows);
  return { table, rows };
}

export function createLevelLeaderboards(options: {
  levels: readonly { level: number; title: string }[];
  playHref(level: number): string | undefined;
  load(from: number, signal: AbortSignal): Promise<LevelBoardPage>;
}) {
  const element = el("section", "", "ef-level-board");
  const standings = rankingTable("Overall standings", [
    "Rank",
    "Rider",
    "Level records",
  ]);
  const levels = rankingTable("Fastest solo finishes by level", [
    "Level",
    "1st",
    "2nd",
    "3rd",
  ]);
  levels.table.classList.add("ef-level-times");
  const status = el("p");
  status.setAttribute("role", "status");
  const more = button("Load more levels");
  more.hidden = true;
  const pending = new AbortController();
  let shown = 0;
  let loading = false;
  element.append(standings.table, levels.table, status, more);

  async function loadMore() {
    if (loading || pending.signal.aborted) return;
    loading = more.disabled = true;
    status.textContent = "Loading times…";
    try {
      const page = await options.load(shown, pending.signal);
      if (pending.signal.aborted) return;
      if (page.standings) {
        let rank = 0;
        let previous = 0;
        const rows = page.standings.map(({ name, records }, index) => {
          if (records !== previous) rank = index + 1;
          previous = records;
          const row = el("tr");
          row.append(
            el("td", String(rank)),
            el("td", name),
            el("td", String(records)),
          );
          return row;
        });
        if (!rows.length) {
          const row = el("tr");
          const empty = el("td", "No level records yet.");
          empty.colSpan = 3;
          row.append(empty);
          rows.push(row);
        }
        standings.rows.replaceChildren(...rows);
        standings.table.hidden = false;
      }
      for (const [index, times] of page.levels.entries()) {
        const choice = options.levels[shown + index]!;
        const row = el("tr");
        const name = `${choice.level + 1} ${choice.title}`;
        const level = el("th", name);
        level.scope = "row";
        const href = options.playHref(choice.level);
        if (href) {
          const play = el("a", "Play", "fui-button");
          play.href = href;
          play.setAttribute("aria-label", `Play level ${name}`);
          level.append(play);
        }
        row.append(level);
        for (let place = 0; place < LEVEL_BOARD_PLACES; place++) {
          const time = times[place];
          const cell = el("td", time ? "" : "—");
          if (time)
            cell.append(
              el("span", time.name),
              el("span", clockText(centiseconds(time.steps)), "ef-record-time"),
            );
          row.append(cell);
        }
        levels.rows.append(row);
      }
      shown += page.levels.length;
      levels.table.hidden = false;
      status.textContent = `Showing ${shown} of ${options.levels.length} levels`;
      more.textContent = "Load more levels";
      more.hidden = shown >= options.levels.length;
    } catch {
      if (pending.signal.aborted) return;
      status.textContent = "Could not load times.";
      more.textContent = "Retry";
      more.hidden = false;
    } finally {
      loading = more.disabled = false;
    }
  }
  more.onclick = () => void loadMore();
  void loadMore();
  return { element, dispose: () => pending.abort() };
}
