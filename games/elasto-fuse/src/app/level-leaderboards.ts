import { button, el } from "fuse-ui";
import { RACE_LIMIT, centiseconds } from "../engine/index.js";
import type { LevelTime } from "../level-times.js";
import { clockText } from "../render/hud.js";

/** Display only the bounded public ranking returned by the level-times route. */
export function parseLevelTimes(body: unknown): LevelTime[] {
  const players =
    body && typeof body === "object" && "players" in body ? body.players : null;
  if (!Array.isArray(players) || players.length > 100)
    throw new Error("Invalid leaderboard");
  return players.map((player: unknown) => {
    if (
      !player ||
      typeof player !== "object" ||
      !("name" in player) ||
      !("steps" in player)
    )
      throw new Error("Invalid leaderboard row");
    const { name, steps } = player;
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > 80 ||
      typeof steps !== "number" ||
      !Number.isInteger(steps) ||
      steps < 1 ||
      steps > RACE_LIMIT
    )
      throw new Error("Invalid leaderboard row");
    return { name, steps };
  });
}

export function createLevelLeaderboards(options: {
  initial: number;
  levels: readonly { level: number; title: string }[];
  playHref(level: number): string | undefined;
  load(level: number, signal: AbortSignal): Promise<LevelTime[]>;
}) {
  const element = el("section", "", "ef-level-board");
  const fields = el("div", "", "ef-level-board-fields");
  const label = el("label", "", "ef-level-picker");
  const select = el("select");
  label.append(el("span", "Level"), select);
  for (const choice of options.levels) {
    const row = el("option", `${choice.level + 1} ${choice.title}`);
    row.value = String(choice.level);
    select.append(row);
  }
  select.value = String(options.initial);
  const play = el("a", "Play this level", "fui-button fui-button-primary");
  fields.append(label, play);
  const status = el("p");
  status.setAttribute("role", "status");
  const retry = button("Retry");
  retry.hidden = true;
  const table = el("table");
  const caption = el("caption", "Fastest solo finishes");
  const head = el("thead");
  const headings = el("tr");
  for (const label of ["Rank", "Rider", "Time"]) {
    const heading = el("th", label);
    heading.scope = "col";
    headings.append(heading);
  }
  head.append(headings);
  const rows = el("tbody");
  table.append(caption, head, rows);
  element.append(fields, status, retry, table);
  let pending: AbortController | undefined;
  async function refresh() {
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    const level = Number(select.value);
    const playHref = options.playHref(level);
    play.hidden = !playHref;
    if (playHref) play.href = playHref;
    else play.removeAttribute("href");
    status.textContent = "Loading times…";
    retry.hidden = table.hidden = true;
    rows.replaceChildren();
    try {
      const times = await options.load(level, controller.signal);
      if (controller.signal.aborted) return;
      status.textContent = times.length
        ? ""
        : "No times yet. Sign in and finish this level to set the first one.";
      for (const [index, time] of times.entries()) {
        const row = el("tr");
        row.append(
          el("td", String(index + 1)),
          el("td", time.name),
          el("td", clockText(centiseconds(time.steps))),
        );
        rows.append(row);
      }
      table.hidden = times.length === 0;
    } catch {
      if (controller.signal.aborted) return;
      status.textContent = "Could not load times.";
      retry.hidden = false;
    }
  }
  select.onchange = retry.onclick = () => void refresh();
  void refresh();
  return { element, dispose: () => pending?.abort() };
}
