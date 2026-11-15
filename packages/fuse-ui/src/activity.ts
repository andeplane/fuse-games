import type {
  ActivitySource,
  ActivityQuery,
  ActivityPage,
  ActivityGroup,
  GameActivity,
} from "fuse-platform/activity-api";
import { el } from "./dom.js";

export function createActivitySource(options: {
  apiUrl(path: string): string;
  fetch: typeof fetch;
  token(): Promise<string | undefined>;
}): ActivitySource {
  const read = async (path: string) => {
    const token = await options.token();
    const response = await options.fetch(
      options.apiUrl(`/api/activity${path}`),
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        typeof body?.error === "string"
          ? body.error
          : "Could not load activity",
      );
    return body;
  };
  return {
    async list(query) {
      const params = new URLSearchParams();
      if (query.gameId) params.set("gameId", query.gameId);
      if (query.player) params.set("player", query.player);
      if (query.mine) params.set("scope", "mine");
      if (query.mode) params.set("mode", query.mode);
      if (query.kind) params.set("kind", query.kind);
      if (query.before)
        params.set("before", `${query.before.at}:${query.before.id}`);
      const body = await read(`?${params}`);
      if (!Array.isArray(body.events))
        throw new Error("Invalid activity response");
      return body as ActivityPage;
    },
    async event(id) {
      const body = await read(`/${encodeURIComponent(id)}`);
      if (!body.event) throw new Error("Activity unavailable");
      return body.event as GameActivity;
    },
    async group(id) {
      const body = await read(`/groups/${encodeURIComponent(id)}`);
      if (
        !Array.isArray(body.events) ||
        (body.truncated !== undefined && typeof body.truncated !== "boolean")
      )
        throw new Error("Match rounds unavailable");
      return body as ActivityGroup;
    },
  };
}

export interface ActivityBrowserOptions {
  source: ActivitySource;
  document?: Document;
  signedIn(): boolean;
  signIn(): void;
  gameName?(id: string): string;
}
/** One browser for every game's public, own and player activity; fetches only on explicit navigation. */
export function createActivityBrowser(options: ActivityBrowserOptions) {
  const doc = options.document ?? document;
  const node = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text = "",
    className = "",
  ) => el(tag, text, className, doc);
  const button = (text: string, action: () => void, className = "") => {
    const result = node("button", text, `fui-button ${className}`);
    result.type = "button";
    result.onclick = action;
    return result;
  };
  const labelGame =
    options.gameName ?? ((id) => id.replaceAll("-", " ").toUpperCase());
  const element = node("section", "", "fui-activity");
  element.setAttribute("aria-label", "Gameplay activity");
  const scope = node("div", "", "fui-activity-scope");
  const heading = node("h3", "RECENT ACTIVITY");
  heading.tabIndex = -1;
  const filters = node("div", "", "fui-activity-filters");
  const select = (label: string, values: readonly [string, string][]) => {
    const wrap = node("label", "", "fui-activity-filter"),
      input = node("select");
    input.setAttribute("aria-label", label);
    wrap.append(node("span", label), input);
    for (const [value, text] of values) {
      const option = node("option", text);
      option.value = value;
      input.append(option);
    }
    input.onchange = () => {
      void load();
    };
    filters.append(wrap);
    return input;
  };
  const game = select("Game", [["", "All games"]]);
  const kind = select("Show", [
    ["match", "Matches"],
    ["round", "Rounds"],
    ["", "All activity"],
  ]);
  const mode = select("Players", [
    ["", "Solo and multiplayer"],
    ["solo", "Solo"],
    ["multiplayer", "Multiplayer"],
  ]);
  const status = node("p", "", "fui-activity-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const results = node("div", "", "fui-activity-results");
  const retry = button("TRY AGAIN", () => {
    void load(retryOlder);
  });
  retry.hidden = true;
  const enter = button("SIGN IN", options.signIn);
  enter.hidden = true;
  const more = button("OLDER ACTIVITY", () => {
    void load(true);
  });
  more.hidden = true;
  const overview = node("div");
  overview.append(scope, heading, filters, status, retry, enter, results, more);
  const detail = node("section", "", "fui-activity-detail");
  detail.hidden = true;
  element.append(overview, detail);
  let who: "everyone" | "mine" | { id: string; name: string } = "everyone";
  let generation = 0,
    disposed = false,
    opened = false,
    loading = false,
    retryOlder = false;
  let page: ActivityPage = { events: [] },
    returnFocus: HTMLElement | undefined;
  const everyone = button("EVERYONE", () => {
    who = "everyone";
    void load();
  });
  const yours = button("YOURS", () => {
    who = "mine";
    void load();
  });
  scope.append(everyone, yours);
  const query = (): ActivityQuery => ({
    ...(game.value ? { gameId: game.value } : {}),
    ...(kind.value ? { kind: kind.value as ActivityQuery["kind"] } : {}),
    ...(mode.value ? { mode: mode.value as ActivityQuery["mode"] } : {}),
    ...(who === "mine"
      ? { mine: true }
      : typeof who === "object"
        ? { player: who.id }
        : {}),
  });
  const showPlayer = (id: string, name: string) => {
    who = { id, name };
    game.value = "";
    // Some games report only matches; a player's default feed must include those too.
    kind.value = "";
    mode.value = "";
    opened = true;
    detail.hidden = true;
    overview.hidden = false;
    void load();
    heading.focus?.();
  };
  const playerName = (player: GameActivity["players"][number]) =>
    player.publicId
      ? button(
          player.name,
          () => showPlayer(player.publicId!, player.name),
          "fui-activity-player",
        )
      : node("span", `${player.name}${player.bot ? " · AI" : ""}`);
  const score = (event: GameActivity, value: number) => {
    const supplied = event.context.scoreDivisor;
    const divisor =
      typeof supplied === "number" &&
      Number.isSafeInteger(supplied) &&
      supplied > 0
        ? supplied
        : 1;
    return event.context.scoreUnit === "percent"
      ? `${(Math.floor(value / divisor / 100) / 100).toFixed(2)}%`
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };
  const title = (event: GameActivity) => {
    const winner = event.players.find((player) => player.id === event.winner);
    return `${winner ? `${winner.name} won · ` : ""}${event.title}`;
  };
  const dated = (event: GameActivity) => {
    const time = node(
      "time",
      new Date(event.endedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    );
    time.dateTime = new Date(event.endedAt).toISOString();
    return time;
  };
  const goBack = () => {
    generation++;
    detail.hidden = true;
    overview.hidden = false;
    returnFocus?.focus();
  };
  async function openEvent(id: string, source?: HTMLElement) {
    if (disposed) return;
    const own = ++generation;
    if (loading) {
      more.disabled = false;
      status.textContent = page.events.length
        ? "Newest first. Select a result for its details, or a player for their activity."
        : "No recorded activity for these filters. Older full games are available under Matches.";
    }
    loading = false;
    returnFocus =
      source ?? (detail.hidden ? heading : (returnFocus ?? heading));
    overview.hidden = true;
    detail.hidden = false;
    const back = button("BACK TO ACTIVITY", goBack),
      name = node("h3", "Loading result…"),
      message = node("p", "Loading result…");
    name.tabIndex = -1;
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    detail.replaceChildren(back, name, message);
    name.focus?.();
    try {
      const event = await options.source.event(id);
      if (disposed || own !== generation) return;
      name.textContent = title(event);
      message.textContent =
        "Result loaded. Standings and linked rounds are below.";
      detail.append(
        node(
          "p",
          `${labelGame(event.gameId)} · ${event.mode === "unknown" ? "Earlier play" : event.mode === "solo" ? "Solo" : "Multiplayer"} · ${event.kind === "round" ? `Round ${event.round}` : `${event.rounds} rounds`}${typeof event.context.playStyle === "string" ? ` · ${event.context.playStyle}` : ""}`,
        ),
        dated(event),
        node(
          "p",
          event.proof === "server-replayed"
            ? "Replay-verified result"
            : event.proof === "peer-agreed"
              ? "Peer-confirmed result"
              : "Account-reported result",
          "fui-activity-status",
        ),
      );
      const table = node("table", "", "fui-activity-standings"),
        head = node("thead"),
        row = node("tr"),
        body = node("tbody");
      for (const text of ["PLAYER", "SCORE", "WINS"]) {
        const th = node("th", text);
        th.scope = "col";
        row.append(th);
      }
      head.append(row);
      for (const player of [...event.players].sort(
        (a, b) => a.place - b.place,
      )) {
        const line = node("tr"),
          name = node("th");
        name.scope = "row";
        name.append(playerName(player));
        if (player.label) name.append(node("small", player.label));
        line.append(
          name,
          node("td", score(event, player.score)),
          node("td", String(player.wins)),
        );
        body.append(line);
      }
      table.append(head, body);
      detail.append(table);
      const details = node("details"),
        summary = node("summary", "FULL STATS");
      details.append(summary);
      for (const player of event.players) {
        const list = node("dl");
        for (const [key, value] of Object.entries(player.stats))
          list.append(
            node("dt", key.replace(/([a-z])([A-Z])/g, "$1 $2")),
            node("dd", value.toLocaleString()),
          );
        details.append(node("h4", player.name), list);
      }
      detail.append(details);
      const related = node("section"),
        relatedStatus = node("p", "Loading linked rounds…"),
        relatedHeading = node("h4", "MATCH AND ROUNDS");
      relatedStatus.setAttribute("role", "status");
      related.append(relatedHeading, relatedStatus);
      detail.append(related);
      const loadGroup = async () => {
        try {
          const group = await options.source.group(event.groupId);
          if (disposed || own !== generation) return;
          relatedStatus.textContent = [
            group.truncated
              ? `Showing the latest ${group.events.length} linked results. Older results are not included.`
              : "",
            group.events.some((item) => item.kind === "match")
              ? ""
              : "Match summary is not available yet.",
          ]
            .filter(Boolean)
            .join(" ");
          const list = node("ol");
          for (const item of [...group.events].sort((a, b) =>
            a.kind !== b.kind
              ? a.kind === "match"
                ? -1
                : 1
              : (a.round ?? 0) - (b.round ?? 0) || a.id.localeCompare(b.id),
          )) {
            const line = node("li"),
              open = button(
                `${item.kind === "match" ? "MATCH" : `ROUND ${item.round}`} · ${title(item)}`,
                () => {
                  void openEvent(item.id);
                },
              );
            open.disabled = item.id === event.id;
            line.append(open);
            list.append(line);
          }
          related.append(list);
        } catch {
          if (!disposed && own === generation) {
            relatedStatus.textContent = "Could not load linked rounds.";
            related.append(
              button("RETRY ROUNDS", () => {
                related.replaceChildren(relatedHeading, relatedStatus);
                void loadGroup();
              }),
            );
          }
        }
      };
      void loadGroup();
    } catch (error) {
      if (!disposed && own === generation) {
        name.textContent = "RESULT UNAVAILABLE";
        message.textContent =
          error instanceof Error ? error.message : "Could not load result.";
        detail.append(
          button("TRY AGAIN", () => {
            void openEvent(id, source);
          }),
        );
      }
    }
  }
  const draw = () => {
    const list = node("ol", "", "fui-activity-list");
    for (const event of page.events) {
      const row = node("li"),
        open = button(
          `${labelGame(event.gameId)} · ${title(event)}`,
          () => {
            void openEvent(event.id, open);
          },
          "fui-activity-open",
        ),
        players = node("div", "", "fui-activity-players");
      row.append(
        dated(event),
        open,
        node(
          "small",
          `${event.mode === "unknown" ? "Earlier play" : event.mode === "solo" ? "Solo" : "Multiplayer"} · ${event.kind === "round" ? `Round ${event.round}` : `${event.rounds} rounds`}`,
        ),
      );
      for (const player of event.players) {
        const result = node("span", "", "fui-activity-player-result");
        result.append(
          playerName(player),
          node("span", ` · ${score(event, player.score)}`),
        );
        players.append(result);
      }
      row.append(players);
      list.append(row);
    }
    results.replaceChildren(list);
    more.hidden = !page.next;
  };
  async function load(older = false) {
    if (disposed) return;
    const own = ++generation;
    loading = true;
    retry.hidden = enter.hidden = true;
    more.disabled = true;
    detail.hidden = true;
    overview.hidden = false;
    everyone.setAttribute("aria-pressed", String(who === "everyone"));
    yours.setAttribute("aria-pressed", String(who === "mine"));
    heading.textContent =
      typeof who === "object"
        ? `${who.name} · RECENT ACTIVITY`
        : who === "mine"
          ? "YOUR RECENT ACTIVITY"
          : "RECENT ACTIVITY";
    if (who === "mine" && !options.signedIn()) {
      loading = false;
      status.textContent = "Sign in to see your activity.";
      results.replaceChildren();
      more.hidden = true;
      enter.hidden = false;
      return;
    }
    status.textContent = older
      ? "Loading older activity…"
      : "Loading activity…";
    if (!older) {
      page = { events: [] };
      results.replaceChildren();
      more.hidden = true;
    }
    try {
      const next = await options.source.list({
        ...query(),
        ...(older && page.next ? { before: page.next } : {}),
      });
      if (disposed || own !== generation) return;
      if (next.games) {
        const selected = game.value;
        game.replaceChildren();
        for (const [value, label] of [
          ["", "All games"],
          ...next.games.map((id) => [id, labelGame(id)]),
        ]) {
          const option = node("option", label!);
          option.value = value!;
          game.append(option);
        }
        game.value = selected;
      }
      page = {
        ...next,
        events: older ? [...page.events, ...next.events] : next.events,
      };
      status.textContent = page.events.length
        ? "Newest first. Select a result for its details, or a player for their activity."
        : "No recorded activity for these filters. Older full games are available under Matches.";
      draw();
    } catch (error) {
      if (!disposed && own === generation) {
        status.textContent =
          error instanceof Error ? error.message : "Could not load activity.";
        retryOlder = older;
        retry.hidden = false;
      }
    } finally {
      if (own === generation) {
        loading = false;
        more.disabled = false;
      }
    }
  }
  return {
    element,
    open(force = false) {
      if (!opened || force) {
        opened = true;
        void load();
      }
    },
    openPlayer: showPlayer,
    refresh() {
      if (opened) void load();
    },
    dispose() {
      disposed = true;
      generation++;
      element.remove();
    },
  };
}
