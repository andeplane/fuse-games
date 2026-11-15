import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Window } from "happy-dom";
import { EventExplorer } from "../packages/fuse-telemetry/src/explorer.js";
import { MemoryTelemetryDatabase } from "fuse-telemetry/metrics-memory";
import { mountWorkspace, type WorkspaceAccount } from "../dev/workspace.js";
import type { ExplorerQuery } from "fuse-telemetry/explorer-contracts";
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
