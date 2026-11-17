import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  Firestore,
  Timestamp,
  type DocumentReference,
  FieldPath,
} from "@google-cloud/firestore";
import {
  FirestoreTelemetryDatabase,
  type TelemetryFirestore,
  type TelemetryFirestoreTransaction,
  type TelemetryEventQuery,
} from "../src/metrics-firestore.js";
import { EventExplorer } from "../src/explorer.js";

/** SDK references need no network; every read/transaction is provided by this typed fake. */
class FakeFirestore implements TelemetryFirestore {
  private sdk = new Firestore({ projectId: "telemetry-test" });
  documents = new Map<string, Record<string, unknown>>();
  batches: number[] = [];
  attempts = 0;
  retryOnce = false;
  queryRows: Record<string, unknown>[] = [];
  queryCalls: unknown[][] = [];
  collection(path: string): TelemetryEventQuery {
    this.queryCalls.push(["collection", path]);
    const query: TelemetryEventQuery = {
      where: (field, operator, value) => {
        this.queryCalls.push(["where", field, operator, value]);
        return query;
      },
      orderBy: (field, direction) => {
        this.queryCalls.push(["orderBy", field, direction]);
        return query;
      },
      limit: (limit) => {
        this.queryCalls.push(["limit", limit]);
        return query;
      },
      startAfter: (...values) => {
        this.queryCalls.push(["startAfter", ...values]);
        return query;
      },
      get: async () => ({
        docs: this.queryRows.map((value) => ({ data: () => value })),
      }),
    };
    return query;
  }
  doc(path: string): DocumentReference {
    return this.sdk.doc(path);
  }
  async getAll(...refs: DocumentReference[]) {
    this.batches.push(refs.length);
    return refs.map((ref) => ({ data: () => this.documents.get(ref.path) }));
  }
  async runTransaction<T>(
    operation: (tx: TelemetryFirestoreTransaction) => Promise<T>,
    options: { maxAttempts: number },
  ): Promise<T> {
    assert.equal(options.maxAttempts, 5);
    const attempt = async () => {
      this.attempts++;
      const writes = new Map<string, Record<string, unknown>>();
      const result = await operation({
        getAll: (...refs) => this.getAll(...refs),
        set: (ref, data) => writes.set(ref.path, data),
      });
      return { result, writes };
    };
    if (this.retryOnce) {
      this.retryOnce = false;
      await attempt();
    }
    const { result, writes } = await attempt();
    for (const [key, value] of writes) this.documents.set(key, value);
    return result;
  }
}
test("Firestore explorer queries preserve verified names, bound reads and paginate by time/id", async () => {
  const firestore = new FakeFirestore(),
    db = new FirestoreTelemetryDatabase(firestore, "fuse-test");
  const now = Date.UTC(2026, 10, 17, 12),
    id = randomUUID();
  firestore.queryRows = [
    {
      v: 1,
      id,
      gameId: "dice",
      userId: randomUUID(),
      sessionId: randomUUID(),
      name: "fuse.App Opened",
      occurredAt: now - 1000,
      properties: {},
      account: { uid: "verified-player", name: "Server Username" },
      accountName: "Ignored top-level name",
      expiresAt: now + 1000,
    },
  ];
  const result = await new EventExplorer(
    db,
    new Set(["dice"]),
    () => now,
  ).query({
    from: "2026-11-17",
    to: "2026-11-17",
    gameId: "",
    filters: {
      groups: [
        [{ field: "accountId", operator: "eq", value: "verified-player" }],
      ],
    },
  });
  assert.equal(result.events[0]?.accountName, "Server Username");
  assert.equal(result.sessions[0]?.accountId, "verified-player");
  assert.deepEqual(firestore.queryCalls.slice(0, 3), [
    ["collection", "fuse-test-telemetry-events"],
    ["where", "occurredAt", ">=", Date.UTC(2026, 10, 17)],
    ["where", "occurredAt", "<", now + 1],
  ]);
  assert.deepEqual(firestore.queryCalls[3], ["orderBy", "occurredAt", "desc"]);
  const orderField = firestore.queryCalls[4]?.[1];
  assert.ok(orderField instanceof FieldPath);
  assert.ok(orderField.isEqual(FieldPath.documentId()));
  firestore.queryCalls.length = 0;
  await db.queryEvents({
    from: 0,
    to: now,
    limit: 9999,
    after: { time: now - 1000, id },
  });
  assert.ok(
    firestore.queryCalls.some(
      (call) => call[0] === "limit" && call[1] === 2001,
    ),
  );
  assert.deepEqual(firestore.queryCalls.at(-1), ["startAfter", now - 1000, id]);
  firestore.queryCalls.length = 0;
  await db.queryEvents({ from: 0, to: now, limit: -1 });
  assert.ok(
    firestore.queryCalls.some((call) => call[0] === "limit" && call[1] === 1),
  );
  const withoutQueries: TelemetryFirestore = {
    doc: firestore.doc.bind(firestore),
    getAll: firestore.getAll.bind(firestore),
    runTransaction: firestore.runTransaction.bind(firestore),
  };
  await assert.rejects(
    new FirestoreTelemetryDatabase(withoutQueries, "fuse-test").queryEvents({
      from: 0,
      to: now,
      limit: 1,
    }),
    /Event queries unavailable/,
  );
});
test("Firestore adapter namespaces documents, preserves result order, adds timestamp TTL and supports retries", async () => {
  const firestore = new FakeFirestore(),
    db = new FirestoreTelemetryDatabase(firestore, "fuse-test");
  firestore.retryOnce = true;
  const result = await db.transact(async (tx) => {
    assert.deepEqual(await tx.getMany([]), []);
    assert.deepEqual(await tx.getMany(["telemetry-events/one"]), [undefined]);
    tx.set("telemetry-events/one", { expiresAt: 1000, value: 1 });
    tx.set("telemetry-events/two", { value: 2 });
    return "stored";
  });
  assert.equal(result, "stored");
  assert.equal(firestore.attempts, 2);
  const values = await db.readMany([
    "telemetry-events/two",
    "telemetry-events/one",
    "telemetry-events/missing",
  ]);
  assert.deepEqual(values[0], { value: 2 });
  const one = values[1];
  assert.ok(
    one &&
      typeof one === "object" &&
      "cleanupAt" in one &&
      one.cleanupAt instanceof Timestamp,
  );
  assert.equal(one.cleanupAt.toMillis(), 1000);
  assert.equal(values[2], undefined);
  assert.equal(firestore.documents.has("fuse-test-telemetry-events/one"), true);
  assert.deepEqual(await db.readMany([]), []);
  firestore.batches.length = 0;
  await db.readMany(
    Array.from({ length: 501 }, (_, i) => `telemetry-events/key-${i}`),
  );
  assert.deepEqual(firestore.batches, [250, 250, 1]);
});
test("Firestore adapter rejects namespace escape and discards failed transaction writes", async () => {
  const firestore = new FakeFirestore(),
    db = new FirestoreTelemetryDatabase(firestore, "fuse-test");
  assert.throws(() => new FirestoreTelemetryDatabase(firestore, "bad/prefix"));
  for (const key of [
    "users/victim",
    "telemetry-events/a/b",
    "telemetry-events/../users",
    "telemetry-events/",
  ]) {
    await assert.rejects(db.readMany([key]), /Invalid telemetry document key/);
    await assert.rejects(
      db.transact(async (tx) => {
        tx.set(key, {});
      }),
      /Invalid telemetry document key/,
    );
  }
  await assert.rejects(
    db.transact(async (tx) => {
      tx.set("telemetry-events/failed", { value: 1 });
      throw new Error("rejected");
    }),
  );
  assert.deepEqual(await db.readMany(["telemetry-events/failed"]), [undefined]);
});
