import type {
  ExplorerEvent,
  ExplorerResult,
  EventConstraint,
} from "fuse-telemetry/explorer-contracts";
import type { Dom } from "./dom.js";
import { coverageNote } from "./events.js";
import { isParticipation } from "fuse-telemetry/explorer-contracts";
const count = (events: readonly ExplorerEvent[], name: string) =>
  events.filter((event) => event.name === name && isParticipation(event))
    .length;
const unique = (
  events: readonly ExplorerEvent[],
  key: "userId" | "sessionId",
) => new Set(events.map((event) => event[key])).size;
export function renderOverview(
  dom: Dom,
  data: ExplorerResult,
  activeMonth: ExplorerResult,
  from: string,
  to: string,
  drill: (rule?: EventConstraint) => void,
): HTMLElement {
  const { node, button } = dom;
  const section = node("section", "overview");
  const top = node("div", "section-heading");
  top.append(
    node("h2", "", "Who is playing, and how much?"),
    button("Explore raw events", () => drill(), "quiet"),
  );
  section.append(top);
  const daily = activeMonth.events.filter(
    (event) => new Date(event.occurredAt).toISOString().slice(0, 10) === to,
  );
  const stats = node("dl", "activity-summary");
  const measures = [
    [
      "DAU",
      activeMonth.truncated ? "—" : String(unique(daily, "userId")),
      `Active browsers · ${to}`,
    ],
    [
      "MAU",
      activeMonth.truncated
        ? "—"
        : String(unique(activeMonth.events, "userId")),
      `Active browsers · ${to.slice(0, 7)} to date`,
    ],
    [
      "Round plays",
      `${data.truncated ? "≥ " : ""}${data.summary.roundPlays}`,
      "Participating browsers · selected dates",
    ],
    [
      "Match plays",
      `${data.truncated ? "≥ " : ""}${data.summary.matchPlays}`,
      "Match starts · selected dates",
    ],
    [
      "Sessions",
      `${data.truncated ? "≥ " : ""}${data.summary.sessions}`,
      "Visits with matching events",
    ],
    [
      "Games played",
      `${data.truncated ? "≥ " : ""}${new Set(data.events.filter((event) => isParticipation(event) && (event.name === "fuse.Round Started" || event.name === "fuse.Match Started")).map((event) => event.gameId)).size}`,
      "Games with a round or match start",
    ],
  ];
  for (const [label, value, detail] of measures) {
    const block = node("div");
    block.append(
      node("dt", "", label),
      node("dd", "number", value),
      node("p", "muted", detail),
    );
    stats.append(block);
  }
  section.append(stats, coverageNote(dom, data));
  if (data.summary.participationUnknown)
    section.append(
      node(
        "p",
        "notice",
        `${data.summary.participationUnknown} legacy play observations have no participation flag. They remain in Raw Events and browser/session activity, but are excluded from play totals.`,
      ),
    );
  if (activeMonth.truncated)
    section.append(
      node(
        "p",
        "notice",
        "Complete active-browser history is unavailable within the query or retention limit. DAU/MAU are withheld rather than undercounted. Narrow the game or filters, or choose a recent month.",
      ),
    );
  const charts = node("div", "activity-charts");
  const days: string[] = [];
  for (
    let time = Date.parse(`${from}T00:00:00Z`);
    time <= Date.parse(`${to}T00:00:00Z`);
    time += 86400_000
  )
    days.push(new Date(time).toISOString().slice(0, 10));
  const dailyEvents = days.map((day) =>
    data.events.filter((event) =>
      new Date(event.occurredAt).toISOString().startsWith(day),
    ),
  );
  charts.append(
    activityChart(
      dom,
      "Daily active browsers",
      days,
      dailyEvents.map((events) => unique(events, "userId")),
      "browsers",
    ),
    activityChart(
      dom,
      "Rounds played and completed",
      days,
      dailyEvents.map((events) => count(events, "fuse.Round Started")),
      "round plays",
      dailyEvents.map((events) => count(events, "fuse.Round Ended")),
    ),
  );
  if (data.truncated)
    section.append(
      node(
        "p",
        "notice",
        "Charts are withheld because the selected history is incomplete. Narrow the dates or game to show complete daily values.",
      ),
    );
  else section.append(charts);
  const heading = node("div", "section-heading");
  heading.append(
    node("h2", "", "Which games are people playing?"),
    node("p", "muted", `${from} – ${to} · click any game to investigate`),
  );
  section.append(heading);
  const wrap = node("div", "table-wrap"),
    table = node("table"),
    head = node("thead"),
    tr = node("tr");
  for (const label of [
    "Game",
    "Players",
    "Sessions",
    "Round plays",
    "Completions",
    "Match plays",
    "Events",
  ]) {
    const th = node("th", "", label);
    th.scope = "col";
    tr.append(th);
  }
  head.append(tr);
  const body = node("tbody");
  const games = [...new Set(data.events.map((event) => event.gameId))]
    .map((game) => ({
      game,
      events: data.events.filter((event) => event.gameId === game),
    }))
    .sort(
      (a, b) =>
        count(b.events, "fuse.Round Started") -
          count(a.events, "fuse.Round Started") ||
        b.events.length - a.events.length,
    );
  for (const { game, events } of games) {
    const row = node("tr"),
      title = node("th");
    title.scope = "row";
    title.append(
      button(
        game,
        () => drill({ field: "gameId", operator: "eq", value: game }),
        "dimension",
      ),
    );
    row.append(title);
    for (const value of [
      unique(events, "userId"),
      unique(events, "sessionId"),
      count(events, "fuse.Round Started"),
      count(events, "fuse.Round Ended"),
      count(events, "fuse.Match Started"),
      events.length,
    ])
      row.append(node("td", "number", value.toLocaleString()));
    body.append(row);
  }
  table.append(head, body);
  wrap.append(table);
  section.append(wrap);
  if (!games.length)
    section.append(
      node(
        "p",
        "empty-state",
        "No matching activity. Choose another game or date range, or clear a constraint.",
      ),
    );
  const details = node("details", "metric-definitions");
  details.append(
    node("summary", "", "How these numbers are counted"),
    node(
      "p",
      "muted",
      "DAU counts distinct anonymous browsers on the selected end date. MAU counts distinct browsers from the first of that calendar month through the end date. They use the same game and event constraints. Round and match plays count browser participation, not unique multiplayer worlds. Completion counts are end events in the selected period; they are not a cohort conversion rate. Session times cover observed matching events, not continuous measured playtime.",
    ),
  );
  section.append(details);
  return section;
}
function activityChart(
  dom: Dom,
  title: string,
  dates: string[],
  values: number[],
  unit: string,
  secondary?: number[],
): HTMLElement {
  const { node } = dom;
  const figure = node("figure", "activity-chart");
  figure.append(node("figcaption", "", title));
  const document = figure.ownerDocument,
    ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 620 220");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${title}. ${unit}; exact daily values below.`,
  );
  const max = Math.max(1, ...values, ...(secondary ?? [])),
    ceiling = Math.max(1, Math.ceil(max / 4) * 4);
  for (let index = 0; index <= 4; index++) {
    const y = 180 - index * 40;
    const line = document.createElementNS(ns, "line");
    for (const [key, value] of Object.entries({
      x1: 44,
      x2: 608,
      y1: y,
      y2: y,
    }))
      line.setAttribute(key, String(value));
    line.setAttribute("class", "chart-grid");
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", "34");
    text.setAttribute("y", String(y + 4));
    text.setAttribute("text-anchor", "end");
    text.textContent = String((index * ceiling) / 4);
    svg.append(line, text);
  }
  const draw = (numbers: number[], className: string) => {
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute(
      "points",
      numbers
        .map(
          (value, index) =>
            `${numbers.length < 2 ? 326 : 44 + (index / (numbers.length - 1)) * 564},${180 - (value / ceiling) * 160}`,
        )
        .join(" "),
    );
    line.setAttribute("class", className);
    svg.append(line);
    numbers.forEach((value, index) => {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute(
        "cx",
        String(
          numbers.length < 2 ? 326 : 44 + (index / (numbers.length - 1)) * 564,
        ),
      );
      dot.setAttribute("cy", String(180 - (value / ceiling) * 160));
      dot.setAttribute("r", "3");
      dot.setAttribute("class", className);
      const tooltip = document.createElementNS(ns, "title");
      tooltip.textContent = `${dates[index]}: ${value} ${className === "chart-secondary" ? "completions" : unit}`;
      dot.append(tooltip);
      svg.append(dot);
    });
  };
  draw(values, "chart-primary");
  if (secondary) draw(secondary, "chart-secondary");
  for (const [x, anchor, text] of [
    [44, "start", dates[0]],
    [608, "end", dates.at(-1)],
  ] as const) {
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", String(x));
    label.setAttribute("y", "210");
    label.setAttribute("text-anchor", anchor);
    label.textContent = text ?? "";
    svg.append(label);
  }
  figure.append(svg);
  if (secondary)
    figure.append(
      node("p", "chart-legend", "Cyan: round plays · Lime: completions"),
    );
  const details = node("details");
  details.append(node("summary", "", "Daily values"));
  const table = node("table"),
    head = node("tr");
  for (const label of [
    "Date · UTC",
    unit,
    ...(secondary ? ["Completions"] : []),
  ])
    head.append(node("th", "", label));
  const thead = node("thead");
  thead.append(head);
  const body = node("tbody");
  dates.forEach((day, index) => {
    const row = node("tr");
    row.append(node("th", "", day), node("td", "", String(values[index])));
    if (secondary) row.append(node("td", "", String(secondary[index])));
    body.append(row);
  });
  table.append(thead, body);
  details.append(table);
  figure.append(details);
  return figure;
}
