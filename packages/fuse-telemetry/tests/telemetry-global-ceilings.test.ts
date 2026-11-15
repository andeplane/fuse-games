import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DebugService } from "../src/debug-service.js";
import {
  MemoryDebugDatabase,
  MemoryPrivateObjectStorage,
} from "../src/debug-memory.js";
import { DEBUG_LIMITS } from "../src/debug-contracts.js";
import { reportKey } from "../src/debug-store.js";
import { SharedTelemetryQuota } from "../src/limits.js";
import { MemoryTelemetryDatabase } from "../src/metrics-memory.js";
import { MetricsStore } from "../src/metrics.js";
import { MetricsSessions } from "../src/metrics-session.js";

const now = 1_800_000_000_000;
const secret = "test-only-key-longer-than-32-bytes";
test("F-08 session verification tolerates bounded clock skew across instances", async () => {
  const db = new MemoryTelemetryDatabase();
  const quota = new SharedTelemetryQuota(db, secret, () => now);
  const verifier = new MetricsSessions(secret, quota, () => now);
  for (const skew of [1, 5000]) {
    const token = await new MetricsSessions(
      secret,
      quota,
      () => now + skew,
    ).issue("127.0.0.1");
    verifier.verify(`Bearer ${token}`);
    const [expiry, nonce, signature] = token.split(".");
    const forged = `${expiry}.${nonce}.${signature![0] === "A" ? "B" : "A"}${signature!.slice(1)}`;
    assert.throws(() => verifier.verify(`Bearer ${forged}`));
    assert.throws(() =>
      new MetricsSessions(secret, quota, () => now + skew + 3600_000).verify(
        `Bearer ${token}`,
      ),
    );
  }
  const tooFar = await new MetricsSessions(
    secret,
    quota,
    () => now + 5001,
  ).issue("127.0.0.1");
  assert.throws(() => verifier.verify(`Bearer ${tooFar}`));
});
test("F-08 global event ceiling applies across addresses and session capabilities expire", async () => {
  const db = new MemoryTelemetryDatabase();
  const quota = new SharedTelemetryQuota(db, secret, () => now);
  const sessions = new MetricsSessions(secret, quota, () => now);
  const token = await sessions.issue("127.0.0.1");
  sessions.verify(`Bearer ${token}`);
  assert.throws(() => sessions.verify(`Bearer ${token}x`));
  assert.throws(() =>
    new MetricsSessions(secret, quota, () => now + 3600_001).verify(
      `Bearer ${token}`,
    ),
  );
  await quota.consume([
    {
      dimension: "events-global-day",
      identity: "global",
      cost: 99_999,
      limit: 100_000,
      windowMs: 86400_000,
    },
  ]);
  const store = new MetricsStore(db, ["dice"], quota, () => now);
  const event = () => ({
    v: 1,
    id: randomUUID(),
    gameId: "dice",
    userId: randomUUID(),
    sessionId: randomUUID(),
    name: "fuse.App Opened",
    occurredAt: now,
    properties: {},
  });
  await store.ingest({ events: [event()] }, "127.0.0.1");
  await assert.rejects(
    store.ingest({ events: [event()] }, "127.0.0.2"),
    /limit/,
  );
});
test("F-08 anonymous reports have a small budget, short retention, and a shared global ceiling", async () => {
  const database = new MemoryDebugDatabase(),
    objects = new MemoryPrivateObjectStorage();
  const service = new DebugService({
    database,
    objects,
    gameIds: new Set(["dice"]),
    now: () => now,
  });
  const report = () => ({
    id: randomUUID(),
    gameId: "dice",
    category: "bug",
    text: "Broken",
    createdAt: now,
    screenshot: {
      mime: "image/jpeg",
      base64: Buffer.from([255, 216, 0, 0, 0, 0, 0, 255, 217]).toString(
        "base64",
      ),
    },
  });
  const first = report();
  await service.submitReport("one", undefined, first);
  const stored = await database.read(reportKey(first.id));
  assert.ok(stored?.kind === "report");
  assert.equal(stored.expiresAt, now + DEBUG_LIMITS.anonymousRetentionMs);
  assert.equal(stored.mediaExpiresAt, stored.expiresAt);
  assert.equal(stored.screenshotKey, `anonymous-screenshots/${first.id}`);
  for (let i = 1; i < DEBUG_LIMITS.dailyAnonymousReports; i++)
    await service.submitReport("one", undefined, report());
  await assert.rejects(
    service.submitReport("one", undefined, report()),
    /Daily report limit/,
  );
  const globalKey = `limit:report-global:${Math.floor(now / 86400_000)}`;
  await database.transact([globalKey], (records) => {
    const current = records.get(globalKey);
    assert.ok(current?.kind === "limit");
    return {
      writes: new Map([
        [globalKey, { ...current, reports: DEBUG_LIMITS.dailyGlobalReports }],
      ]),
      result: undefined,
    };
  });
  await assert.rejects(
    service.submitReport("different", undefined, report()),
    /budget/,
  );
  await database.transact([globalKey], (records) => {
    const current = records.get(globalKey);
    assert.ok(current?.kind === "limit");
    return {
      writes: new Map([
        [
          globalKey,
          {
            ...current,
            reports: 0,
            durationMs: DEBUG_LIMITS.dailyGlobalReportBytes,
          },
        ],
      ]),
      result: undefined,
    };
  });
  await assert.rejects(
    service.submitReport("another", undefined, report()),
    /budget/,
  );
});
