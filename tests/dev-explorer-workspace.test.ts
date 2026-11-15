import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Window } from "happy-dom";
import { EventExplorer } from "../packages/fuse-telemetry/src/explorer.js";
import { MemoryTelemetryDatabase } from "fuse-telemetry/metrics-memory";
import { mountWorkspace, type WorkspaceAccount } from "../dev/workspace.js";
import type { ExplorerQuery } from "fuse-telemetry/explorer-contracts";
import type { ExplorerResult } from "fuse-telemetry/explorer-contracts";
import { renderOverview } from "../dev/overview.js";
import { createDom } from "../dev/dom.js";
async function settled(predicate: () => boolean) {
  for (let index = 0; index < 300; index++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.ok(predicate());
}
function click(root: HTMLElement, text: string) {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  );
  assert.ok(button, `Missing ${text}`);
  button.click();
}
test("real workspace composes autocomplete, game/song/player/session drilldowns and discovered columns", async () => {
  const window = new Window(),
    document = window.document as unknown as Document,
    root = document.createElement("div");
  document.body.append(root);
  const now = Date.UTC(2026, 10, 15, 12),
    db = new MemoryTelemetryDatabase(),
    player = randomUUID(),
    session = randomUUID(),
    other = randomUUID();
  await db.transact(async (tx) => {
    for (const [index, userId] of [player, other].entries()) {
      const id = randomUUID();
      tx.set(`telemetry-events/${id}`, {
        v: 1,
        id,
        userId,
        sessionId: index ? randomUUID() : session,
        gameId: "fusemania",
        name: "fuse.Round Started",
        occurredAt: now - 1000 - index,
        properties: {
          song: "Take Five",
          chart: 2,
          mode: index ? "online" : "solo",
          played: true,
        },
        expiresAt: now + 100000,
      });
    }
  });
  const explorer = new EventExplorer(
    db,
    new Set(["fusemania", "dice"]),
    () => now,
  );
  const queries: ExplorerQuery[] = [];
  const account: WorkspaceAccount = {
    ready: async () => {},
    watch(fn) {
      fn({ name: "Developer" });
      return () => {};
    },
    signIn: async () => {},
    signOut: async () => {},
    failure: () => "failed",
  };
  const unmount = mountWorkspace(root, {
    document,
    account,
    now: () => new Date(now),
    gamesUrl: "/",
    transport: {
      origin: "https://test.example",
      token: async () => "private",
      request: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/dev/me") return Response.json({ uid: "dev" });
        if (path === "/api/dev/catalog")
          return Response.json({ gameIds: ["dice", "fusemania"] });
        if (path === "/api/dev/events") {
          const query = JSON.parse(String(init?.body));
          queries.push(query);
          return Response.json(await explorer.query(query));
        }
        throw new Error("Unexpected request");
      },
    },
  });
  await settled(() => !!root.querySelector(".overview"));
  const game = root.querySelector<HTMLInputElement>('[role="combobox"]')!;
  game.focus();
  assert.equal(root.querySelectorAll('[role="option"]').length, 3);
  game.value = "mania";
  game.dispatchEvent(new window.Event("input") as unknown as Event);
  assert.equal(root.querySelectorAll('[role="option"]').length, 1);
  click(root, "fusemania");
  click(root, "Apply filters");
  await settled(
    () =>
      root.querySelector(".view-content")?.getAttribute("aria-busy") ===
      "false",
  );
  assert.equal(queries.at(-1)?.gameId, "fusemania");
  click(root, "Raw Events");
  await settled(() => !!root.querySelector(".events-view"));
  assert.ok(root.textContent?.includes("Event type"));
  assert.ok(
    [...root.querySelectorAll("th")].some((th) => th.textContent === "song"),
  );
  click(root, "Take Five");
  await settled(
    () =>
      queries
        .at(-1)
        ?.filters.groups[0]?.some(
          (rule) => rule.field === "properties.song",
        ) === true,
  );
  await settled(
    () =>
      root.querySelector(".view-content")?.getAttribute("aria-busy") ===
      "false",
  );
  click(root, `Browser ${player.slice(0, 8)}`);
  await settled(
    () =>
      queries
        .at(-1)
        ?.filters.groups[0]?.some((rule) => rule.field === "userId") === true,
  );
  await settled(
    () =>
      root.querySelector(".view-content")?.getAttribute("aria-busy") ===
      "false",
  );
  click(root, "Player Sessions");
  await settled(
    () =>
      !![...root.querySelectorAll("h2")].find(
        (node) => node.textContent === "Player sessions",
      ),
  );
  click(root, session.slice(0, 8));
  await settled(
    () =>
      queries
        .at(-1)
        ?.filters.groups[0]?.some((rule) => rule.field === "sessionId") ===
      true,
  );
  await settled(() => !!root.querySelector(".events-view"));
  assert.equal(root.querySelectorAll(".event-table tbody tr").length, 1);
  assert.equal(root.querySelectorAll(".selected-session-event").length, 1);
  root.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "z",
      metaKey: true,
      bubbles: true,
    }) as unknown as Event,
  );
  await settled(
    () =>
      root.querySelector('.workspace-nav [aria-current="page"]')
        ?.textContent === "Player Sessions",
  );
  await settled(
    () =>
      root.querySelector(".view-content")?.getAttribute("aria-busy") ===
      "false",
  );
  assert.ok(
    !queries
      .at(-1)
      ?.filters.groups.flat()
      .some((rule) => rule.field === "sessionId"),
  );
  unmount();
  await window.happyDOM.close();
});
test("keyboard filter controls survive native changes and late results, drafts survive navigation, and structural edits restore focus", async () => {
  const window = new Window(),
    document = window.document as unknown as Document,
    root = document.createElement("div");
  document.body.append(root);
  const empty: ExplorerResult = {
    events: [],
    sessions: [],
    fields: ["kind", "gameId", "properties.song"],
    commonFields: [],
    gameIds: ["fusemania"],
    scanned: 0,
    matched: 0,
    truncated: false,
    summary: {
      players: 0,
      sessions: 0,
      roundPlays: 0,
      completions: 0,
      matchPlays: 0,
      games: 0,
      completionRate: null,
    },
  };
  let hold = false,
    finish: ((value: Response) => void) | undefined;
  const account: WorkspaceAccount = {
    ready: async () => {},
    watch(fn) {
      fn({ name: "Developer" });
      return () => {};
    },
    signIn: async () => {},
    signOut: async () => {},
    failure: () => "failed",
  };
  const unmount = mountWorkspace(root, {
    document,
    account,
    now: () => new Date("2026-11-15T12:00:00Z"),
    gamesUrl: "/",
    transport: {
      origin: "https://test.example",
      token: async () => "test",
      request: async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/dev/me") return Response.json({ uid: "developer" });
        if (path === "/api/dev/catalog")
          return Response.json({ gameIds: ["fusemania"] });
        if (hold)
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        return Response.json(empty);
      },
    },
  });
  await settled(() => !!root.querySelector(".overview"));
  const keyboard = () =>
    root.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
      }) as unknown as Event,
    );
  const control = (key: string) => {
    const found = root.querySelector<HTMLElement>(`[data-focus-key="${key}"]`);
    assert.ok(found, `Missing focus target ${key}`);
    return found;
  };
  keyboard();
  control("nav-events").focus();
  click(root, "Raw Events");
  await settled(() => !!root.querySelector(".events-view"));
  assert.equal(document.activeElement, control("nav-events"));
  root.querySelector<HTMLDetailsElement>(".filter-builder")!.open = true;
  const add = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Add constraint",
  )!;
  add.focus();
  click(root, "Add constraint");
  assert.equal(document.activeElement, control("filter-0-0-property"));
  await settled(
    () =>
      root.querySelector(".view-content")?.getAttribute("aria-busy") ===
      "false",
  );
  const property = control("filter-0-0-property") as HTMLSelectElement;
  property.value = "gameId";
  property.focus();
  hold = true;
  property.dispatchEvent(
    new window.Event("change", { bubbles: true }) as unknown as Event,
  );
  assert.equal(document.activeElement, property);
  assert.ok(property.isConnected);
  await settled(() => !!finish);
  const value = control("filter-0-0-value") as HTMLInputElement;
  value.value = "unfinished";
  const game = root.querySelector<HTMLInputElement>('[role="combobox"]')!;
  game.focus();
  game.value = "fusemania";
  game.dispatchEvent(
    new window.Event("input", { bubbles: true }) as unknown as Event,
  );
  const from = root.querySelector<HTMLInputElement>('input[type="date"]')!;
  from.value = "2026-11-10";
  from.dispatchEvent(
    new window.Event("input", { bubbles: true }) as unknown as Event,
  );
  finish!(Response.json(empty));
  hold = false;
  await settled(
    () =>
      root.querySelector(".view-content")?.getAttribute("aria-busy") ===
      "false",
  );
  assert.equal(document.activeElement, game);
  assert.equal(game.value, "fusemania");
  assert.equal(value.value, "unfinished");
  assert.equal(control("filter-0-0-property"), property);
  assert.equal(from.value, "2026-11-10");
  control("nav-players").focus();
  click(root, "Player Sessions");
  await settled(
    () =>
      root.querySelector(".view-content")?.getAttribute("aria-busy") ===
      "false",
  );
  assert.equal(document.activeElement, control("nav-players"));
  assert.equal(
    root.querySelector<HTMLInputElement>('[role="combobox"]')?.value,
    "fusemania",
  );
  assert.equal(
    root.querySelector<HTMLInputElement>('input[type="date"]')?.value,
    "2026-11-10",
  );
  const addAnd = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Add AND constraint",
  )!;
  addAnd.focus();
  click(root, "Add AND constraint");
  assert.equal(document.activeElement, control("filter-0-1-property"));
  const remove =
    root.querySelectorAll<HTMLButtonElement>(".constraint button")[1]!;
  remove.focus();
  remove.click();
  assert.equal(document.activeElement, control("filters-summary"));
  await settled(
    () =>
      root.querySelector(".view-content")?.getAttribute("aria-busy") ===
      "false",
  );
  assert.equal(document.activeElement, control("filters-summary"));
  unmount();
  await window.happyDOM.close();
});
test("overview keeps active browsers visible while excluding displays and unknown legacy starts from play measures", async () => {
  const window = new Window(),
    document = window.document as unknown as Document,
    db = new MemoryTelemetryDatabase(),
    now = Date.UTC(2026, 10, 15, 12);
  await db.transact(async (tx) => {
    for (const [played, gameId, name] of [
      [false, "dice", "fuse.Match Started"],
      [undefined, "dice", "fuse.Match Started"],
      [true, "fusemania", "fuse.Round Started"],
    ] as const) {
      const id = randomUUID();
      tx.set(`telemetry-events/${id}`, {
        v: 1,
        id,
        gameId,
        name,
        userId: randomUUID(),
        sessionId: randomUUID(),
        occurredAt: now - 1000,
        properties: played === undefined ? {} : { played },
        expiresAt: now + 86400000,
      });
    }
  });
  const data = await new EventExplorer(
    db,
    new Set(["dice", "fusemania"]),
    () => now,
  ).query({
    from: "2026-11-15",
    to: "2026-11-15",
    gameId: "",
    filters: { groups: [] },
  });
  const overview = renderOverview(
    createDom(document),
    data,
    data,
    "2026-11-15",
    "2026-11-15",
    () => {},
  );
  const measure = (label: string) =>
    [...overview.querySelectorAll("dt")]
      .find((node) => node.textContent === label)
      ?.parentElement?.querySelector("dd")?.textContent;
  assert.equal(measure("DAU"), "3");
  assert.equal(measure("Round plays"), "1");
  assert.equal(measure("Match plays"), "0");
  assert.equal(measure("Games played"), "1");
  assert.ok(overview.textContent?.includes("1 legacy play observations"));
  const dice = [...overview.querySelectorAll("tbody tr")].find(
    (row) => row.querySelector("th")?.textContent === "dice",
  );
  assert.equal(dice?.querySelectorAll("td")[2]?.textContent, "0");
  assert.equal(dice?.querySelectorAll("td")[4]?.textContent, "0");
  await window.happyDOM.close();
});
