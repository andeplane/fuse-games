import {
  baseEventFields,
  eventValue,
  type ExplorerResult,
  type EventConstraint,
} from "../packages/fuse-telemetry/src/explorer-contracts.js";
import type { TelemetryProperty } from "fuse-telemetry/contracts";
import type { Dom } from "./dom.js";
import { fieldLabel } from "./filters.js";
export const shortPlayer = (id: string) => `Browser ${id.slice(0, 8)}`;
const date = (time: number) =>
  new Date(time).toISOString().replace("T", " ").slice(0, 19);
export function coverageNote(dom: Dom, data: ExplorerResult): HTMLElement {
  return dom.node(
    "p",
    data.truncated ? "notice" : "muted",
    data.truncated
      ? `Loaded a slice of ${data.scanned.toLocaleString()} events. ${data.nextCursor ? "More history is available: load older events or narrow the dates." : "This is the oldest slice in this query."} Counts and columns describe this slice only.`
      : `${data.matched.toLocaleString()} matching events · ${data.scanned.toLocaleString()} examined · UTC. Names identify verified accounts; browser labels identify guests or older events. Raw history is retained for 90 days.`,
  );
}
export function renderEvents(
  dom: Dom,
  data: ExplorerResult,
  columns: string[],
  onColumns: (columns: string[]) => void,
  filter: (rule: EventConstraint) => void,
  selectedSession?: string,
): HTMLElement {
  const { node, button } = dom;
  const section = node("section", "events-view");
  const heading = node("div", "section-heading");
  heading.append(node("h2", "", "Raw events"));
  const picker = node("details", "column-picker");
  picker.append(node("summary", "", `Columns · ${columns.length}`));
  const choices = node("div", "column-choices");
  for (const key of [...new Set([...baseEventFields, ...data.fields])]) {
    const check = node("input");
    check.type = "checkbox";
    check.checked = columns.includes(key);
    check.disabled = key === "kind";
    check.dataset.column = key;
    check.addEventListener("change", () => {
      const container = section.parentElement,
        keyboard = check.matches(":focus-visible");
      onColumns(
        check.checked
          ? [...columns, key]
          : columns.filter((column) => column !== key),
      );
      const replacement =
        container?.querySelector<HTMLDetailsElement>(".column-picker");
      if (replacement) {
        replacement.open = true;
        if (keyboard)
          [...replacement.querySelectorAll<HTMLInputElement>("input")]
            .find((input) => input.dataset.column === key)
            ?.focus();
      }
    });
    const label = node("label");
    label.append(
      check,
      node(
        "span",
        "",
        `${fieldLabel(key)}${data.commonFields.includes(key) ? " · all events" : ""}`,
      ),
    );
    choices.append(label);
  }
  picker.append(choices);
  heading.append(picker);
  section.append(heading, coverageNote(dom, data));
  if (selectedSession)
    section.append(
      node(
        "p",
        "session-selection",
        `Session ${selectedSession.slice(0, 8)} · all matching events from this visit are highlighted below.`,
      ),
    );
  const link = (field: string, value: TelemetryProperty, label?: string) => {
    const control = button(
      label ?? String(value),
      () => filter({ field, operator: "eq", value }),
      "dimension",
    );
    control.title = `Filter ${fieldLabel(field)} = ${String(value)}`;
    return control;
  };
  const wrap = node("div", "table-wrap event-table");
  wrap.tabIndex = 0;
  wrap.setAttribute(
    "aria-label",
    "Events; scroll horizontally for more columns",
  );
  const table = node("table");
  const head = node("thead"),
    row = node("tr");
  for (const key of columns) {
    const th = node("th", "", fieldLabel(key));
    th.scope = "col";
    row.append(th);
  }
  const participantsHeading = node("th", "", "Reported participants");
  participantsHeading.scope = "col";
  row.append(participantsHeading);
  head.append(row);
  const body = node("tbody");
  let shown = 0;
  const drawMore = () => {
    for (const event of data.events.slice(shown, shown + 100)) {
      const tr = node("tr");
      tr.dataset.eventId = event.id;
      if (event.sessionId === selectedSession)
        tr.className = "selected-session-event";
      for (const key of columns) {
        const cell = node("td");
        const value = eventValue(event, key);
        if (key === "occurredAt")
          cell.append(link(key, event.occurredAt, date(event.occurredAt)));
        else if (value === undefined) cell.textContent = "—";
        else
          cell.append(
            link(
              key === "userId" && event.accountId ? "accountId" : key,
              key === "userId" && event.accountId ? event.accountId : value,
              key === "userId"
                ? (event.accountName ?? shortPlayer(String(value)))
                : key === "sessionId"
                  ? String(value).slice(0, 8)
                  : String(value),
            ),
          );
        tr.append(cell);
      }
      const peers = node("td", "participant-cell");
      const reference = event.properties.roundRef ?? event.properties.matchRef;
      const players =
        typeof reference === "string"
          ? (data.participants?.[reference] ?? [
              event.accountId ? `account:${event.accountId}` : event.userId,
            ])
          : [event.accountId ? `account:${event.accountId}` : event.userId];
      for (const player of players) {
        const uid = player.startsWith("account:") ? player.slice(8) : undefined;
        peers.append(
          uid
            ? link("accountId", uid, data.accounts?.[uid] ?? "Signed-in player")
            : link("userId", player, shortPlayer(player)),
        );
      }
      if (!reference)
        peers.append(node("span", "muted", "Other participants not recorded"));
      tr.append(peers);
      body.append(tr);
    }
    shown = Math.min(shown + 100, data.events.length);
    more.hidden = shown >= data.events.length;
    more.textContent = `Show next ${Math.min(100, data.events.length - shown)} events`;
  };
  const more = button("Show more events", drawMore, "quiet");
  table.append(head, body);
  wrap.append(table);
  section.append(wrap, more);
  if (!data.events.length)
    section.append(
      node(
        "p",
        "empty-state",
        "No events match. Clear a constraint, choose another game or widen the dates.",
      ),
    );
  drawMore();
  return section;
}
export function renderPlayerSessions(
  dom: Dom,
  data: ExplorerResult,
  filter: (rule: EventConstraint) => void,
  open: (player: string, session: string, accountId?: string) => void,
): HTMLElement {
  const { node, button } = dom;
  const section = node("section");
  section.append(
    node("h2", "", "Player sessions"),
    node(
      "p",
      "muted",
      "A visit continues across games and solo/multiplayer until 30 minutes of inactivity. Times and counts cover matching events within the selected dates.",
    ),
    coverageNote(dom, data),
  );
  const wrap = node("div", "table-wrap"),
    table = node("table"),
    head = node("thead"),
    row = node("tr");
  for (const text of [
    "Session",
    "Player",
    "First event · UTC",
    "Last event · UTC",
    "Games",
    "Modes",
    "Rounds",
    "Matches",
    "Events",
  ]) {
    const th = node("th", "", text);
    th.scope = "col";
    row.append(th);
  }
  head.append(row);
  const body = node("tbody");
  for (const session of data.sessions) {
    const tr = node("tr"),
      id = node("td"),
      player = node("td"),
      games = node("td");
    id.append(
      button(
        session.id.slice(0, 8),
        () => open(session.player, session.id, session.accountId),
        "dimension",
      ),
    );
    player.append(
      button(
        session.accountName ?? shortPlayer(session.player),
        () =>
          filter({
            field: session.accountId ? "accountId" : "userId",
            operator: "eq",
            value: session.accountId ?? session.player,
          }),
        "dimension",
      ),
    );
    for (const game of session.games)
      games.append(
        button(
          game,
          () => filter({ field: "gameId", operator: "eq", value: game }),
          "dimension",
        ),
      );
    tr.append(
      id,
      player,
      node("td", "", date(session.startedAt)),
      node("td", "", date(session.lastEventAt)),
      games,
      node("td", "", session.modes.join(", ") || "—"),
      node("td", "number", String(session.rounds)),
      node("td", "number", String(session.matches)),
      node("td", "number", String(session.events)),
    );
    body.append(tr);
  }
  table.append(head, body);
  wrap.append(table);
  section.append(wrap);
  if (!data.sessions.length)
    section.append(
      node("p", "empty-state", "No sessions match these filters."),
    );
  return section;
}
