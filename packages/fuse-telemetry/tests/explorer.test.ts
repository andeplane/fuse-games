import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  EventExplorer,
  parseEventFilters,
  parseExplorerQuery,
} from "../src/explorer.js";
import { MemoryTelemetryDatabase } from "../src/metrics-memory.js";
import {
  eventKind,
  matchesEvent,
  isEventFilters,
  type ExplorerEvent,
} from "../src/explorer-contracts.js";
const now = Date.UTC(2026, 10, 15, 12),
  games = new Set(["fusemania", "dice"]);
const player = randomUUID(),
  session = randomUUID();
const event = (change: Partial<ExplorerEvent> = {}): ExplorerEvent => ({
  v: 1,
  id: randomUUID(),
  userId: player,
  sessionId: session,
  gameId: "fusemania",
  name: "fuse.Round Started",
  kind: "round",
  occurredAt: now - 1000,
  properties: { song: "jazz", chart: 2, played: true, mode: "solo" },
  ...change,
});
const query = {
  from: "2026-11-01",
  to: "2026-11-15",
  gameId: "",
  filters: { groups: [] },
};
async function database(events: ExplorerEvent[]) {
  const db = new MemoryTelemetryDatabase();
  await db.transact(async (tx) => {
    for (const { kind: _kind, ...value } of events)
      tx.set(`telemetry-events/${value.id}`, {
        ...value,
        expiresAt: now + 86400_000,
      });
  });
  return db;
}
test("AND/OR constraints preserve types, reject missing dimensions and handle bounds", () => {
  const e = event();
  assert.equal(eventKind("fuse.Match Ended"), "match");
  const filter = parseEventFilters({
    groups: [
      [{ field: "gameId", operator: "eq", value: "dice" }],
      [
        { field: "properties.song", operator: "contains", value: "JAZ" },
        { field: "properties.chart", operator: "gte", value: 2 },
      ],
    ],
  });
  assert.equal(matchesEvent(e, filter), true);
  assert.equal(
    matchesEvent(e, {
      groups: [[{ field: "properties.missing", operator: "neq", value: "x" }]],
    }),
    false,
  );
  assert.equal(
    matchesEvent(e, {
      groups: [[{ field: "properties.chart", operator: "eq", value: "2" }]],
    }),
    false,
  );
  assert.equal(isEventFilters(filter), true);
  for (const bad of [
    { groups: [[]] },
    {
      groups: [[{ field: "properties.__proto__", operator: "eq", value: "x" }]],
    },
    { groups: [[{ field: "kind", operator: "bad", value: "round" }]] },
    { groups: [[{ field: "kind", operator: "eq", value: {} }]] },
  ]) {
    assert.throws(() => parseEventFilters(bad));
    assert.equal(isEventFilters(bad), false);
  }
  assert.throws(() =>
    parseExplorerQuery({ ...query, from: "2026-02-30" }, games, now),
  );
  assert.throws(() =>
    parseExplorerQuery({ ...query, gameId: "unknown" }, games, now),
  );
  assert.throws(() =>
    parseExplorerQuery({ ...query, to: "2027-01-01" }, games, now),
  );
});
test("events discover common/optional columns, filter song and scope sessions by browser", async () => {
  const first = event(),
    second = event({
      name: "fuse.Match Started",
      kind: "match",
      gameId: "dice",
      occurredAt: now - 2000,
      properties: { mode: "online" },
    }),
    third = event({ userId: randomUUID(), occurredAt: now - 3000 });
  const explorer = new EventExplorer(
    await database([first, second, third]),
    games,
    () => now,
  );
  const all = await explorer.query(query);
  assert.equal(all.sessions.length, 2);
  assert.equal(all.summary.players, 2);
  assert.equal(
    all.sessions.find((row) => row.player === player)?.games.length,
    2,
  );
  assert.ok(all.fields.includes("properties.song"));
  assert.ok(!all.commonFields.includes("properties.song"));
  assert.deepEqual(all.gameIds, ["dice", "fusemania"]);
  const songs = await explorer.query({
    ...query,
    filters: {
      groups: [[{ field: "properties.song", operator: "eq", value: "jazz" }]],
    },
  });
  assert.equal(songs.events.length, 2);
  assert.ok(songs.commonFields.includes("properties.song"));
  assert.equal(songs.events[0]?.id, first.id);
});
test("bounded source scans continue through equal timestamps without duplicates and label later slices", async () => {
  const values = Array.from({ length: 2003 }, () => event());
  const explorer = new EventExplorer(await database(values), games, () => now);
  const first = await explorer.query(query);
  assert.equal(first.events.length, 2000);
  assert.equal(first.truncated, true);
  assert.ok(first.nextCursor);
  const second = await explorer.query({ ...query, cursor: first.nextCursor });
  assert.equal(second.events.length, 3);
  assert.equal(second.nextCursor, undefined);
  assert.equal(second.truncated, true);
  assert.equal(
    new Set([...first.events, ...second.events].map((event) => event.id)).size,
    2003,
  );
  await assert.rejects(explorer.query({ ...query, cursor: "bad" }));
});
