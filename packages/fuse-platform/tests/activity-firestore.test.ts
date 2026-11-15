import test from "node:test";
import assert from "node:assert/strict";
import { Firestore } from "@google-cloud/firestore";
import {
  FirestoreActivityDatabase,
  type ActivityDocument,
  type ActivityDocumentQuery,
  type ActivityDocumentReader,
} from "../src/activity-firestore.js";
import { activityId, activityScope, storeActivity } from "../src/activity.js";
import { plain } from "../src/result.js";
import type {
  ActivityCursor,
  ActivityQuery,
  GameActivity,
} from "../src/activity-api.js";

const groupId = activityId("group");
function event(index: number): GameActivity {
  return {
    version: 1,
    id: index.toString(16).padStart(40, "0"),
    gameId: "example",
    groupId,
    kind: "round",
    mode: "solo",
    proof: "account-reported",
    endedAt: 1000,
    round: index,
    rounds: 1,
    title: "Round complete",
    players: [
      {
        id: activityId("player"),
        name: "Player",
        bot: false,
        place: 1,
        score: 100,
        wins: 1,
        stats: {},
      },
    ],
    context: {},
  };
}
const document = (value: GameActivity): ActivityDocument => ({
  id: value.id,
  data: storeActivity(value),
});

class Documents implements ActivityDocumentReader {
  readonly requests: ActivityDocumentQuery[] = [];
  constructor(readonly rows: readonly ActivityDocument[]) {}
  async query(request: ActivityDocumentQuery) {
    this.requests.push(request);
    return this.rows
      .filter((row) => {
        assert.ok(plain(row.data));
        if (
          request.scope !== undefined &&
          (!Array.isArray(row.data.scopes) ||
            !row.data.scopes.includes(request.scope))
        )
          return false;
        if (
          request.groupId !== undefined &&
          row.data.groupId !== request.groupId
        )
          return false;
        if (!request.before) return true;
        assert.equal(typeof row.data.endedAt, "number");
        assert.equal(typeof request.before.at, "number");
        return (
          Number(row.data.endedAt) < Number(request.before.at) ||
          (row.data.endedAt === request.before.at && row.id < request.before.id)
        );
      })
      .sort((a, b) => {
        assert.ok(plain(a.data) && plain(b.data));
        return (
          Number(b.data.endedAt) - Number(a.data.endedAt) ||
          (a.id === b.id ? 0 : a.id < b.id ? 1 : -1)
        );
      })
      .slice(0, request.limit);
  }
  async read(id: string) {
    return this.rows.find((row) => row.id === id) ?? { id, data: undefined };
  }
}
function database(reader: ActivityDocumentReader) {
  // The SDK remains the production composition; injected reads never contact it.
  return new FirestoreActivityDatabase(
    new Firestore({ projectId: "activity-unit-test" }),
    "test",
    { reader, now: () => 1000 },
  );
}

test("Firestore reader pages all tied valid events past expired/corrupt document IDs", async () => {
  const expired = event(90),
    mismatched = event(91);
  const rows = Array.from({ length: 47 }, (_, index) =>
    document(event(index + 1)),
  );
  rows.push(
    { id: "z-invalid-document-id", data: storeActivity(event(92)) },
    { id: expired.id, data: storeActivity(expired, 999) },
    { id: "e".repeat(40), data: storeActivity(mismatched) },
    { id: "d".repeat(40), data: { ...storeActivity(event(93)), players: [] } },
  );
  const reader = new Documents(rows),
    db = database(reader),
    ids: string[] = [];
  const filter: ActivityQuery = {
    gameId: "example",
    mode: "solo",
    kind: "round",
  };
  let before: ActivityCursor | undefined;
  do {
    const page = await db.listActivity({ ...filter, before }, 20);
    assert.ok(page.events.length <= 20);
    if (page.next) assert.match(page.next.id, /^[a-f0-9]{40}$/);
    ids.push(...page.events.map((value) => value.id));
    before = page.next;
  } while (before);
  assert.equal(ids.length, 47);
  assert.equal(new Set(ids).size, 47);
  assert.ok(
    reader.requests.every((request) => request.scope === activityScope(filter)),
  );
  assert.deepEqual(
    ids,
    Array.from({ length: 47 }, (_, index) => event(47 - index).id),
  );
});

test("Firestore reader rejects mismatched document identities consistently in detail and groups", async () => {
  const valid = event(1),
    mismatch = event(2),
    expired = event(3);
  const db = database(
    new Documents([
      document(valid),
      { id: "e".repeat(40), data: storeActivity(mismatch) },
      { id: expired.id, data: storeActivity(expired, 1000) },
    ]),
  );
  assert.equal(await db.readActivity("e".repeat(40)), undefined);
  assert.equal(await db.readActivity(expired.id), undefined);
  assert.equal(await db.readActivity("f".repeat(40)), undefined);
  assert.deepEqual(
    (await db.groupActivity(groupId, 101)).map((value) => value.id),
    [valid.id],
  );
});

test("Firestore corrupt-row scanning has a fixed read budget and fails without an unusable cursor", async () => {
  const reader = new Documents(
    Array.from({ length: 120 }, (_, index) => ({
      id: `invalid-${index.toString().padStart(3, "0")}`,
      data: storeActivity(event(index + 1)),
    })),
  );
  await assert.rejects(
    database(reader).listActivity({}, 20),
    /scan limit exceeded/,
  );
  assert.equal(
    reader.requests.reduce((total, request) => total + request.limit, 0),
    100,
  );
  assert.equal(reader.requests.length, 5);
});
