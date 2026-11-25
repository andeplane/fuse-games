import type {
  MetricsResponse,
  RecordingsPage,
  ReportsPage,
  RecordingDetail,
  ReportView,
} from "fuse-telemetry/contracts";
import type { ActionsPage } from "../packages/fuse-telemetry/src/action-contracts.js";
import {
  createWorkspaceApi,
  WorkspaceError,
  type WorkspaceTransport,
} from "./api.js";
import { createDom } from "./dom.js";
import { defaultDateRange } from "./model.js";
import { metricsQuery, type MetricsFilters } from "./metrics.js";
import {
  baseEventFields,
  isEventFilters,
  type EventFilters,
  type EventConstraint,
  type ExplorerResult,
} from "fuse-telemetry/explorer-contracts";
import { constrain, filterEditor, gameAutocomplete } from "./filters.js";
import { renderEvents, renderPlayerSessions } from "./events.js";
import { renderOverview } from "./overview.js";
import { createAssistant } from "./assistant.js";
import { githubConnection, issueComposer } from "./github.js";
import type { ActionItem } from "fuse-telemetry/contracts";
import {
  createPrivateMedia,
  recordingDetail,
  recordingList,
  reportArticle,
  type PlaytestReview,
  type PrivateMedia,
} from "./sessions.js";
import {
  actionStatuses,
  renderActions,
  tokenTools,
  type MintedToken,
} from "./actions.js";

export interface WorkspaceAccount {
  ready(): Promise<void>;
  watch(listener: (account: { name: string } | undefined) => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  reauthenticate?(): Promise<void>;
  connectGithub?(): Promise<string>;
  failure(error: unknown): string;
}
export interface WorkspaceDependencies {
  document: Document;
  account: WorkspaceAccount;
  transport: WorkspaceTransport;
  now(): Date;
  gamesUrl: string;
}
const sections = [
  ["metrics", "Overview"],
  ["events", "Raw Events"],
  ["players", "Player Sessions"],
  ["sessions", "Playtest sessions"],
  ["reports", "Reports"],
  ["actions", "Action proposals"],
] as const;
type View = (typeof sections)[number][0];

const isDefaultColumn = (key: string) =>
  key !== "accountId" && key !== "accountName";

export function mountWorkspace(
  root: HTMLElement,
  deps: WorkspaceDependencies,
): () => void {
  const dom = createDom(deps.document);
  const { node, button, select, field } = dom;
  const api = createWorkspaceApi(deps.transport);
  const header = node("header", "workspace-header");
  const brand = node("a", "brand", "FUSE GAMES");
  brand.href = deps.gamesUrl;
  const title = node("h1", "", "Developer workspace");
  const identity = node("div", "identity");
  header.append(brand, title, identity);
  const main = node("main", "workspace");
  main.id = "workspace";
  main.tabIndex = -1;
  root.replaceChildren(header, main);
  const filters: MetricsFilters = {
    period: "day",
    ...defaultDateRange(deps.now()),
    gameId: "",
  };
  const filterDraft: MetricsFilters = { ...filters };
  const actionDraft = { gameId: "", status: "" };
  let keyboardMode = false;
  let current: View = "metrics";
  let controller = new AbortController();
  let disposed = false;
  let loginReady = false;
  let accountName = "";
  let canReviewPlaytests = false;
  let selectedRecording: string | undefined;
  let selectedReport: string | undefined;
  let selectedOffset: number | undefined;
  let actionStatus = "";
  let actionGame = "";
  let cursor: string | undefined;
  const tokens: MintedToken[] = [];
  let navigation: HTMLElement;
  let content: HTMLElement;
  let toolbar: HTMLElement;
  let gameIds: string[] = [];
  let eventFilters: EventFilters = { groups: [] };
  let columns: string[] = baseEventFields.filter(isDefaultColumn);
  let customColumns = false;
  let availableFields: string[] = [...baseEventFields];
  const filterHistory: {
    eventFilters: EventFilters;
    columns: string[];
    customColumns: boolean;
    filters: MetricsFilters;
    filterDraft: MetricsFilters;
    view: View;
  }[] = [];
  function remember() {
    filterHistory.push({
      eventFilters: structuredClone(eventFilters),
      columns: [...columns],
      customColumns,
      filters: { ...filters },
      filterDraft: { ...filterDraft },
      view: current,
    });
    if (filterHistory.length > 40) filterHistory.shift();
  }
  function undo() {
    const previous = filterHistory.pop();
    if (!previous) return;
    eventFilters = previous.eventFilters;
    columns = previous.columns;
    customColumns = previous.customColumns;
    Object.assign(filters, previous.filters);
    Object.assign(filterDraft, previous.filterDraft);
    current = previous.view;
    shell();
    void load();
  }
  const undoKey = (event: KeyboardEvent) => {
    keyboardMode = true;
    const target = event.target as HTMLElement | null;
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      event.key.toLowerCase() === "z" &&
      !target?.closest('textarea,input:not([type="checkbox"])') &&
      filterHistory.length
    ) {
      event.preventDefault();
      undo();
    }
  };
  root.addEventListener("keydown", undoKey);
  const pointerMode = () => {
    keyboardMode = false;
  };
  root.addEventListener("pointerdown", pointerMode);
  let actionsPage: ActionsPage | undefined;
  const assistant = createAssistant(dom, api, executeTool, screen);
  let controlSequence = 0;
  const screenControls = new Map<string, HTMLElement>();
  function openIssue(
    item: ActionItem,
    draft?: { title: string; body: string },
  ) {
    content.querySelector(".issue-composer")?.remove();
    const composer = issueComposer(
      dom,
      api,
      controller.signal,
      item,
      () => composer.remove(),
      draft,
    );
    content.prepend(composer);
    composer.focus();
    composer.scrollIntoView?.({ block: "start" });
  }
  function screen(includeControls = true): string {
    screenControls.clear();
    const controls: { id: string; label: string; value?: string }[] = [];
    for (const element of main.querySelectorAll<HTMLElement>(
      "button,input,select,summary",
    )) {
      if (
        element.closest(
          ".workspace-assistant,.token-tools,.issue-composer,[hidden]",
        ) ||
        (element.closest("details:not([open])") &&
          element.tagName !== "SUMMARY") ||
        element.hidden ||
        element.matches(":disabled")
      )
        continue;
      const label =
        element.closest("label")?.querySelector(".field-label")?.textContent ??
        element.getAttribute("aria-label") ??
        element.textContent ??
        "";
      if (/sign (?:in|out)|connect github|credential|publish/i.test(label))
        continue;
      if (!element.dataset.agentControl)
        element.dataset.agentControl = `control-${++controlSequence}`;
      const id = element.dataset.agentControl;
      screenControls.set(id, element);
      controls.push({
        id,
        label: label.trim().slice(0, 120),
        ...("value" in element
          ? { value: String(element.value).slice(0, 200) }
          : {}),
      });
    }
    const clone = main.cloneNode(true) as HTMLElement;
    for (const element of clone.querySelectorAll(
      ".workspace-assistant, .token-tools, .issue-composer",
    ))
      element.remove();
    return JSON.stringify({
      view: current,
      dates: { from: filters.from, to: filters.to },
      gameId: filters.gameId,
      filters: eventFilters,
      columns,
      availableFields,
      ...(includeControls ? { controls: controls.slice(0, 30) } : {}),
      visible: (clone.innerText || clone.textContent || "").slice(0, 3000),
    }).slice(0, 8000);
  }
  function changeFilters(
    next: EventFilters,
    rebuild = true,
    focusKey = "filters-summary",
  ) {
    remember();
    eventFilters = next;
    if (rebuild) buildToolbar(keyboardMode ? focusKey : undefined);
    else refreshToolbar();
    void load();
  }
  function addFilter(rule: EventConstraint) {
    changeFilters(constrain(eventFilters, rule));
  }
  function selectSession(
    player: string,
    sessionId: string,
    accountId?: string,
  ) {
    remember();
    current = "events";
    eventFilters = constrain(
      constrain(eventFilters, {
        field: accountId ? "accountId" : "userId",
        operator: "eq",
        value: accountId ?? player,
      }),
      { field: "sessionId", operator: "eq", value: sessionId },
    );
    shell();
    return load();
  }
  function applyToolFilters(args: Record<string, unknown>) {
    const { from, to, gameId, filters: next } = args;
    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      typeof gameId !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      (gameId && !gameIds.includes(gameId)) ||
      !isEventFilters(next)
    )
      throw new Error();
    remember();
    Object.assign(filters, { from, to, gameId });
    Object.assign(filterDraft, filters);
    eventFilters = next;
    buildToolbar();
    return load();
  }

  function applyToolColumns(keys: unknown) {
    if (
      !Array.isArray(keys) ||
      keys.length > 24 ||
      !keys.every(
        (key): key is string =>
          typeof key === "string" && availableFields.includes(key),
      )
    )
      throw new Error();
    remember();
    columns = [...new Set(["kind", ...keys])];
    customColumns = true;
    if (current !== "events") {
      current = "events";
      shell();
    }
    return load();
  }

  function toolControl(id: unknown) {
    const control = typeof id === "string" ? screenControls.get(id) : undefined;
    if (!control || !main.contains(control)) throw new Error();
    return control;
  }

  function fillToolControl(id: unknown, value: unknown) {
    const control = toolControl(id);
    if (
      typeof value !== "string" ||
      value.length > 200 ||
      (control.tagName !== "INPUT" && control.tagName !== "SELECT")
    )
      throw new Error();
    (control as HTMLInputElement | HTMLSelectElement).value = value;
    const Event = deps.document.defaultView?.Event;
    if (!Event) return;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function prepareToolIssue(args: Record<string, unknown>) {
    const { actionId, title, body } = args;
    if (
      typeof actionId !== "string" ||
      typeof title !== "string" ||
      typeof body !== "string" ||
      title.length > 140 ||
      body.length > 6000
    )
      throw new Error();
    const item = actionsPage?.actions.find((item) => item.id === actionId);
    if (!item) throw new Error();
    openIssue(item, { title, body });
  }

  async function executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (name) {
      case "navigate": {
        const section = sections.find(([id]) => id === args.view);
        if (!section) throw new Error();
        current = section[0];
        selectedRecording = undefined;
        cursor = undefined;
        shell();
        await load();
        break;
      }
      case "set_filters":
        await applyToolFilters(args);
        break;
      case "set_columns":
        await applyToolColumns(args.columns);
        break;
      case "select_session":
        if (
          typeof args.player !== "string" ||
          typeof args.sessionId !== "string"
        )
          throw new Error();
        await selectSession(args.player, args.sessionId);
        break;
      case "open_recording":
        if (
          typeof args.recordingId !== "string" ||
          !/^[A-Za-z0-9_-]{1,160}$/.test(args.recordingId)
        )
          throw new Error();
        current = "sessions";
        selectedRecording = args.recordingId;
        shell();
        await load();
        break;
      case "refresh":
        await load();
        break;
      case "click_control":
        toolControl(args.id).click();
        await activeLoad;
        break;
      case "fill_control":
        fillToolControl(args.id, args.value);
        await activeLoad;
        break;
      case "prepare_issue":
        prepareToolIssue(args);
        break;
      case "inspect_screen":
        break;
      default:
        throw new Error();
    }
    return screen(false);
  }

  const cancel = () => {
    controller.abort();
    controller = new AbortController();
    return controller.signal;
  };
  const isCurrent = (signal: AbortSignal) => !disposed && !signal.aborted;
  function failure(
    error: unknown,
    target: HTMLElement,
    retry: () => void,
    current: () => boolean = () => true,
  ) {
    const message =
      error instanceof WorkspaceError
        ? error.message
        : "Could not connect to the developer service. Check your connection and retry.";
    const notice = node("div", "notice error");
    notice.setAttribute("role", "alert");
    notice.append(node("p", "", message), button("Retry", retry));
    if (
      error instanceof WorkspaceError &&
      error.status === 401 &&
      deps.account.reauthenticate
    ) {
      notice.append(
        button("Confirm Google sign-in", () => {
          void deps.account.reauthenticate!()
            .then(retry)
            .catch((reason: unknown) => {
              if (!current()) return;
              const message =
                deps.account.failure(reason) || "Sign-in cancelled.";
              failure(new WorkspaceError(401, message), target, retry, current);
            });
        }),
      );
    }
    if (
      error instanceof WorkspaceError &&
      (error.status === 401 || error.status === 403)
    ) {
      notice.append(
        button("Use another Google account", () => {
          void deps.account
            .signOut()
            .catch(() =>
              signedOut("Could not sign out. Retry from this browser."),
            );
        }),
      );
    }
    target.replaceChildren(notice);
  }
  function signedOut(message = "") {
    cancel();
    assistant.clear();
    actionsPage = undefined;
    eventFilters = { groups: [] };
    filterHistory.length = 0;
    tokens.length = 0;
    identity.replaceChildren();
    const panel = node("section", "auth-panel");
    panel.append(
      node("h2", "", "Sign in to continue"),
      node(
        "p",
        "",
        "Metrics, playtest recordings and reports are private. Sign in with an approved developer Google account.",
      ),
    );
    const signIn = button(
      loginReady ? "Sign in with Google" : "Preparing Google sign-in…",
      () => {
        signIn.disabled = true;
        void deps.account.signIn().catch((error) => {
          const reason = deps.account.failure(error);
          signedOut(reason);
        });
      },
      "primary",
    );
    signIn.disabled = !loginReady;
    panel.append(signIn);
    if (message) {
      const notice = node("p", "error", message);
      notice.setAttribute("role", "alert");
      panel.append(notice);
    }
    panel.append(
      node(
        "p",
        "muted",
        "Access is verified by the server. Signing in alone does not grant developer access.",
      ),
    );
    main.replaceChildren(panel);
  }
  function shell() {
    const focusKey = keyboardMode
      ? ((deps.document.activeElement as HTMLElement | null)?.dataset
          .focusKey ?? `nav-${current}`)
      : undefined;
    identity.replaceChildren(
      node("span", "", accountName),
      button("Sign out", () => {
        void deps.account
          .signOut()
          .catch((error) => failure(error, content, () => shell()));
      }),
    );
    navigation = node("nav", "workspace-nav");
    navigation.setAttribute("aria-label", "Developer sections");
    for (const [id, text] of sections) {
      const tab = button(text, () => {
        current = id;
        selectedRecording = undefined;
        selectedReport = undefined;
        selectedOffset = undefined;
        cursor = undefined;
        shell();
        void load();
      });
      tab.setAttribute("aria-current", current === id ? "page" : "false");
      tab.dataset.focusKey = `nav-${id}`;
      navigation.append(tab);
    }
    toolbar = node("div", "toolbar");
    content = node("div", "view-content");
    content.setAttribute("aria-live", "polite");
    content.setAttribute("aria-atomic", "false");
    main.replaceChildren(navigation, assistant.element, toolbar, content);
    buildToolbar();
    if (focusKey) focusControl(focusKey);
  }
  function focusControl(key: string) {
    const target = root.querySelector<HTMLElement>(`[data-focus-key="${key}"]`);
    if (target && !target.closest("[hidden]"))
      target.focus({ preventScroll: true });
  }
  function refreshToolbar() {
    const undoControl =
      toolbar.querySelector<HTMLButtonElement>(".undo-control");
    if (undoControl) undoControl.hidden = !filterHistory.length;
    for (const select of toolbar.querySelectorAll<HTMLSelectElement>(
      "select[data-event-field]",
    ))
      for (const key of availableFields)
        if (![...select.options].some((option) => option.value === key)) {
          const option = node("option", "", key.replace(/^properties\./, ""));
          option.value = key;
          select.append(option);
        }
  }
  function buildToolbar(focusKey?: string) {
    toolbar.replaceChildren();
    const form = node("form", "filters");
    if (["metrics", "events", "players"].includes(current)) {
      const from = node("input");
      from.type = "date";
      from.value = filterDraft.from;
      from.addEventListener("input", () => {
        filterDraft.from = from.value;
      });
      from.required = true;
      const to = node("input");
      to.type = "date";
      to.value = filterDraft.to;
      to.addEventListener("input", () => {
        filterDraft.to = to.value;
      });
      to.required = true;
      const gameControl = gameAutocomplete(
          dom,
          gameIds,
          filterDraft.gameId,
          (value) => {
            filterDraft.gameId = value;
          },
        ),
        game = gameControl.input;
      form.append(
        field("From · UTC", from),
        field("To · UTC", to),
        field("Game ID", gameControl.element),
      );
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (from.value > to.value) {
          to.setCustomValidity(
            "Choose an end date on or after the start date.",
          );
          to.reportValidity();
          return;
        }
        to.setCustomValidity("");
        remember();
        filters.from = from.value;
        filters.to = to.value;
        filters.gameId = game.value.trim();
        void load();
      });
      to.addEventListener("input", () => to.setCustomValidity(""));
      from.addEventListener("input", () => to.setCustomValidity(""));
    } else if (current === "actions") {
      const status = select(actionStatuses, actionDraft.status);
      status.addEventListener("change", () => {
        actionDraft.status = status.value;
      });
      const gameControl = gameAutocomplete(
          dom,
          gameIds,
          actionDraft.gameId,
          (value) => {
            actionDraft.gameId = value;
          },
        ),
        game = gameControl.input;
      form.append(
        field("Status", status),
        field("Game ID", gameControl.element),
      );
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        actionStatus = status.value;
        actionGame = game.value.trim();
        cursor = undefined;
        void load();
      });
    } else {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void load();
      });
      if (selectedRecording)
        form.append(
          button(
            "Back to sessions",
            () => {
              selectedRecording = undefined;
              selectedReport = undefined;
              selectedOffset = undefined;
              buildToolbar();
              void load();
            },
            "text-button",
          ),
        );
      form.append(
        node(
          "h2",
          "view-title",
          selectedRecording
            ? "Playtest session"
            : current === "sessions"
              ? "Playtest sessions"
              : "All reports",
        ),
      );
    }
    const apply = node(
      "button",
      "primary",
      ["metrics", "events", "players", "actions"].includes(current)
        ? "Apply filters"
        : "Refresh",
    );
    apply.type = "submit";
    form.append(apply);
    if (["metrics", "events", "players", "actions"].includes(current))
      form.append(
        button("Refresh", () => {
          void load();
        }),
      );
    toolbar.append(form);
    if (["metrics", "events", "players"].includes(current)) {
      toolbar.append(
        filterEditor(dom, eventFilters, availableFields, changeFilters),
      );
      {
        const control = button("Undo changes", undo, "quiet undo-control");
        control.dataset.focusKey = "undo";
        control.hidden = !filterHistory.length;
        control.title = "Undo changes (Cmd/Ctrl+Z)";
        toolbar.append(control);
      }
    }
    if (focusKey) focusControl(focusKey);
  }
  function openRecording(id: string, reportId?: string, offsetMs?: number) {
    current = "sessions";
    selectedRecording = id;
    selectedReport = reportId;
    selectedOffset = offsetMs;
    cursor = undefined;
    shell();
    void load();
  }
  function pagination(nextCursor: string | undefined) {
    if (!cursor && !nextCursor) return;
    const controls = node("div", "pagination");
    if (cursor)
      controls.append(
        button("First page", () => {
          cursor = undefined;
          void load();
        }),
      );
    if (nextCursor)
      controls.append(
        button("Next page", () => {
          cursor = nextCursor;
          void load();
        }),
      );
    content.append(controls);
  }
  function playtestReview(signal: AbortSignal): PlaytestReview | undefined {
    if (!canReviewPlaytests) return;
    return (kind, id, handled) =>
      api.json<{ handled: boolean }>(
        `/api/dev/${kind}/${encodeURIComponent(id)}/review`,
        signal,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handled }),
        },
      );
  }

  function showRecording(
    data: RecordingDetail,
    signal: AbortSignal,
    media: PrivateMedia,
  ) {
    for (const audio of content.querySelectorAll("audio")) audio.pause();
    content.replaceChildren(
      recordingDetail(
        dom,
        data,
        media,
        openRecording,
        selectedOffset,
        playtestReview(signal),
      ),
    );
    selectedOffset = undefined;
    if (data.reportsNextCursor) {
      const nextArea = node("div", "pagination");
      const more = button("Load more reports in this session", () => {
        more.disabled = true;
        const query = new URLSearchParams({
          recordingId: data.recording.id,
          cursor: data.reportsNextCursor!,
          limit: "50",
        });
        void api
          .json<ReportsPage>(`/api/dev/reports?${query}`, signal)
          .then((page) => {
            if (!isCurrent(signal)) return;
            const reports = [
              ...new Map(
                [...data.reports, ...page.reports].map((report) => [
                  report.id,
                  report,
                ]),
              ).values(),
            ];
            showRecording(
              { ...data, reports, reportsNextCursor: page.nextCursor },
              signal,
              media,
            );
          })
          .catch((error) => {
            if (isCurrent(signal))
              failure(error, nextArea, () => {
                more.disabled = false;
                nextArea.replaceChildren(more);
              });
          });
      });
      nextArea.append(more);
      content.append(nextArea);
    }
    if (selectedReport) {
      const target = deps.document.getElementById(`report-${selectedReport}`);
      if (target) {
        target.tabIndex = -1;
        target.focus();
        target.scrollIntoView?.({ block: "center" });
      } else
        content.prepend(
          node(
            "p",
            "notice",
            "The linked report is not on this page. Load more reports in this session to find it, or check All reports if it has expired.",
          ),
        );
    }
  }
  let activeLoad: Promise<void> = Promise.resolve();
  function load(): Promise<void> {
    activeLoad = loadView();
    return activeLoad;
  }
  function queryEvents(
    signal: AbortSignal,
    from = filters.from,
    after?: string,
  ): Promise<ExplorerResult> {
    return api.json<ExplorerResult>("/api/dev/events", signal, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: filters.to,
        gameId: filters.gameId,
        filters: eventFilters,
        ...(after ? { cursor: after } : {}),
      }),
    });
  }

  function showExplorerResult(result: ExplorerResult, signal: AbortSignal) {
    if (!isCurrent(signal)) return;
    if (current === "players") {
      content.replaceChildren(
        renderPlayerSessions(
          dom,
          result,
          addFilter,
          (player, session, accountId) => {
            void selectSession(player, session, accountId);
          },
        ),
      );
    } else {
      const updateColumns = (next: string[]) => {
        remember();
        columns = next;
        customColumns = true;
        showExplorerResult(result, signal);
        refreshToolbar();
      };
      const selectedSession = eventFilters.groups
        .flat()
        .find(
          (rule) => rule.field === "sessionId" && rule.operator === "eq",
        )?.value;
      content.replaceChildren(
        renderEvents(
          dom,
          result,
          columns,
          updateColumns,
          addFilter,
          typeof selectedSession === "string" ? selectedSession : undefined,
        ),
      );
    }
    const nextCursor = result.nextCursor;
    if (!nextCursor) return;
    const older = button("Load older events", () => {
      older.disabled = true;
      void loadOlderEvents(nextCursor, signal);
    });
    content.append(older);
  }

  async function loadOlderEvents(after: string, signal: AbortSignal) {
    try {
      const next = await queryEvents(signal, filters.from, after);
      if (!isCurrent(signal)) return;
      availableFields = [...new Set([...availableFields, ...next.fields])];
      showExplorerResult(next, signal);
    } catch (error) {
      if (isCurrent(signal)) failure(error, content, retryLoad);
    }
  }

  function retryLoad() {
    void load();
  }

  function drillIntoEvents(rule?: EventConstraint) {
    remember();
    current = "events";
    if (rule) eventFilters = constrain(eventFilters, rule);
    shell();
    void load();
  }

  async function loadOverview(data: ExplorerResult, signal: AbortSignal) {
    let activeCounts: { daily: number; monthly: number } | undefined;
    // Monthly summaries cover the whole aligned month. A historical mid-month
    // end date needs raw events so later days cannot leak into its MAU.
    const completeMonth =
      new Date(
        Date.parse(`${filters.to}T00:00:00Z`) + 86400_000,
      ).getUTCDate() === 1;
    if (
      !eventFilters.groups.length &&
      (filters.to === deps.now().toISOString().slice(0, 10) || completeMonth)
    ) {
      const readActivity = (period: "day" | "month") =>
        api.json<MetricsResponse>(
          metricsQuery({
            ...filters,
            period,
            from: filters.to,
            to: filters.to,
          }),
          signal,
        );
      const [byDay, byMonth] = await Promise.allSettled([
        readActivity("day"),
        readActivity("month"),
      ]);
      const daily =
        byDay.status === "fulfilled"
          ? byDay.value.series?.at(-1)?.users
          : undefined;
      const monthly =
        byMonth.status === "fulfilled"
          ? byMonth.value.series?.at(-1)?.users
          : undefined;
      if (Number.isSafeInteger(daily) && Number.isSafeInteger(monthly))
        activeCounts = { daily: daily!, monthly: monthly! };
    }

    let month = data;
    if (!activeCounts) {
      const monthFrom = `${filters.to.slice(0, 7)}-01`;
      if (filters.from <= monthFrom) {
        const monthStart = Date.parse(`${monthFrom}T00:00:00Z`);
        month = {
          ...data,
          events: data.events.filter((event) => event.occurredAt >= monthStart),
        };
      } else {
        try {
          month = await queryEvents(signal, monthFrom);
        } catch (error) {
          if (!(error instanceof WorkspaceError && error.status === 422))
            throw error;
          month = { ...data, truncated: true };
        }
      }
    }
    if (!isCurrent(signal)) return;
    content.replaceChildren(
      renderOverview(
        dom,
        data,
        month,
        filters.from,
        filters.to,
        drillIntoEvents,
        activeCounts,
      ),
    );
  }

  async function loadExplorer(signal: AbortSignal) {
    const data = await queryEvents(signal);
    if (!isCurrent(signal)) return;
    availableFields = [...new Set([...baseEventFields, ...data.fields])];
    if (!customColumns)
      columns = [
        ...new Set(
          [...baseEventFields, ...data.commonFields].filter(isDefaultColumn),
        ),
      ].slice(0, 24);
    if (current === "metrics") {
      await loadOverview(data, signal);
      if (!isCurrent(signal)) return;
    } else {
      showExplorerResult(data, signal);
    }
    refreshToolbar();
  }

  async function loadRecording(
    id: string,
    signal: AbortSignal,
    media: PrivateMedia,
  ) {
    const data = await api.json<RecordingDetail>(
      `/api/dev/recordings/${encodeURIComponent(id)}`,
      signal,
    );
    if (
      selectedReport &&
      !data.reports.some((report) => report.id === selectedReport)
    ) {
      try {
        const { report } = await api.json<{ report: ReportView }>(
          `/api/dev/reports/${encodeURIComponent(selectedReport)}`,
          signal,
        );
        if (report.recordingId === data.recording.id) data.reports.push(report);
      } catch (error) {
        if (!(error instanceof WorkspaceError && error.status === 404))
          throw error;
      }
    }
    if (isCurrent(signal)) showRecording(data, signal, media);
  }

  function pageQuery() {
    const query = new URLSearchParams({ limit: "25" });
    if (cursor) query.set("cursor", cursor);
    return query;
  }

  async function loadSessions(signal: AbortSignal) {
    const data = await api.json<RecordingsPage>(
      `/api/dev/recordings?${pageQuery()}`,
      signal,
    );
    if (!isCurrent(signal)) return;
    content.replaceChildren(recordingList(dom, data.recordings, openRecording));
    pagination(data.nextCursor);
  }

  async function loadReports(signal: AbortSignal, media: PrivateMedia) {
    const data = await api.json<ReportsPage>(
      `/api/dev/reports?${pageQuery()}`,
      signal,
    );
    if (!isCurrent(signal)) return;
    content.replaceChildren(
      node(
        "p",
        "muted",
        "All reports, including reports sent without a recording. Screenshots load privately when opened.",
      ),
    );
    if (!data.reports.length)
      content.append(
        node(
          "p",
          "empty-state",
          "No reports yet. Reports sent from any game will appear here.",
        ),
      );
    for (const report of data.reports)
      content.append(
        reportArticle(
          dom,
          report,
          media,
          openRecording,
          undefined,
          playtestReview(signal),
        ),
      );
    pagination(data.nextCursor);
  }

  async function loadActions(signal: AbortSignal) {
    const query = pageQuery();
    if (actionStatus) query.set("status", actionStatus);
    if (actionGame) query.set("gameId", actionGame);
    const data = await api.json<ActionsPage>(
      `/api/dev/actions?${query}`,
      signal,
    );
    if (!isCurrent(signal)) return;
    content.replaceChildren(
      node(
        "p",
        "muted",
        "Explicit spoken development directives become proposals. Proposals do not start work automatically. Evidence links open the original session and related reports.",
      ),
      tokenTools(dom, api, signal, tokens, failure),
      githubConnection(dom, api, signal, deps.account.connectGithub),
      renderActions(dom, data, openRecording, openIssue),
    );
    actionsPage = data;
    pagination(data.nextCursor);
  }

  async function loadView() {
    const signal = cancel();
    content.replaceChildren(
      node("p", "loading-state", "Loading private data…"),
    );
    content.setAttribute("aria-busy", "true");
    const media = createPrivateMedia(api, signal, failure);
    try {
      if (
        current === "metrics" ||
        current === "events" ||
        current === "players"
      )
        await loadExplorer(signal);
      else if (selectedRecording)
        await loadRecording(selectedRecording, signal, media);
      else if (current === "sessions") await loadSessions(signal);
      else if (current === "reports") await loadReports(signal, media);
      else await loadActions(signal);
    } catch (error) {
      if (isCurrent(signal)) failure(error, content, retryLoad);
    } finally {
      if (isCurrent(signal)) content.setAttribute("aria-busy", "false");
    }
  }
  async function authorize(name: string) {
    const signal = cancel();
    main.replaceChildren(
      node("p", "loading-state", "Verifying developer access…"),
    );
    try {
      const me = await api.json<{ capabilities?: string[] }>(
        "/api/dev/me",
        signal,
      );
      const catalog = await api.json<{ gameIds: string[] }>(
        "/api/dev/catalog",
        signal,
      );
      if (Array.isArray(catalog.gameIds)) gameIds = catalog.gameIds;
      if (!isCurrent(signal)) return;
      accountName = name;
      canReviewPlaytests = me.capabilities?.includes("token") ?? false;
      shell();
      await load();
    } catch (error) {
      if (isCurrent(signal))
        failure(error, main, () => {
          void authorize(name);
        });
    }
  }
  const unwatch = deps.account.watch((account) => {
    if (disposed) return;
    if (account) void authorize(account.name);
    else signedOut();
  });
  void deps.account
    .ready()
    .then(() => {
      loginReady = true;
      const login = main.querySelector<HTMLButtonElement>(".auth-panel button");
      if (login) {
        login.disabled = false;
        login.textContent = "Sign in with Google";
      }
    })
    .catch(() => {
      if (!disposed)
        signedOut("Google sign-in could not load. Reload this page to retry.");
    });
  return () => {
    disposed = true;
    root.removeEventListener("keydown", undoKey);
    root.removeEventListener("pointerdown", pointerMode);
    assistant.clear();
    controller.abort();
    unwatch();
    root.replaceChildren();
  };
}
