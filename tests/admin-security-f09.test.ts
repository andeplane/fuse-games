import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RoomError } from "fuse-network-be";
import { MemoryActionDatabase } from "fuse-telemetry/action-adapters";
import {
  MemoryDebugDatabase,
  MemoryPrivateObjectStorage,
} from "fuse-telemetry/debug-memory";
import { MemoryTelemetryDatabase } from "fuse-telemetry/metrics-memory";
import { TelemetryAdmission } from "fuse-telemetry/limits";
import {
  finishOwnedRecordings,
  authorizeDeveloper,
  FileDeveloperSecurityStore,
  MemoryDeveloperSecurityStore,
  STEP_UP_MS,
} from "fuse-telemetry/developer-security";
import { createTelemetryServices } from "../service/telemetry.js";
import { pcmWav } from "../packages/fuse-ui/src/playtest-audio.js";

test("F-09: private reads are audited; step-up and per-person policy fence recording and agent access", async (t) => {
  const now = Date.UTC(2026, 10, 14, 12);
  let authTime = now;
  let emailAllowed = true;
  class AuditStore extends MemoryDeveloperSecurityStore {
    fail = false;
    override async append(
      event: Parameters<MemoryDeveloperSecurityStore["append"]>[0],
    ) {
      if (this.fail) throw new Error("storage unavailable");
      await super.append(event);
    }
  }
  const security = new AuditStore(() => now);
  const debugDatabase = new MemoryDebugDatabase();
  const services = createTelemetryServices({
    gameIds: ["dice"],
    now: () => now,
    security,
    agentEmailAllowed: () => emailAllowed,
    developer: async (token) =>
      token === "fresh" || token === "old"
        ? {
            uid: "admin",
            email: "admin@example.test",
            authTime: token === "fresh" ? authTime : now - STEP_UP_MS - 1,
          }
        : undefined,
    metricsDatabase: new MemoryTelemetryDatabase(),
    debugDatabase,
    actionDatabase: new MemoryActionDatabase(),
    objects: new MemoryPrivateObjectStorage(),
    recordingEnabled: true,
    rateLimitKey: "admin-security-test-rate-key-32-bytes",
    extractor: {
      async extract() {
        return [];
      },
    },
  });
  const server = createServer((req, res) => {
    void services.http
      .handle(req, res, "127.0.0.1")
      .then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      })
      .catch((error: unknown) => {
        res.writeHead(error instanceof RoomError ? error.status : 500);
        res.end();
      });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const request = (
    path: string,
    token: string,
    method = "GET",
    body?: string,
  ) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body }),
    });
  assert.equal((await request("/api/dev/reports", "old")).status, 200);
  assert.deepEqual(security.events.at(-1), {
    uid: "admin",
    email: "admin@example.test",
    at: now,
    operation: "GET read",
    resource: "/api/dev/reports",
  });
  // The rejected request contains invalid JSON: authorization must precede body parsing.
  assert.equal(
    (await request("/api/telemetry/recordings", "old", "POST", "{")).status,
    401,
  );
  assert.equal(
    (await request("/api/dev/agent-tokens", "old", "POST", "{")).status,
    401,
  );
  const id = randomUUID();
  assert.equal(
    (
      await request(
        "/api/telemetry/recordings",
        "fresh",
        "POST",
        JSON.stringify({ id, gameId: "dice", startedAt: now }),
      )
    ).status,
    200,
  );
  assert.equal((await request(`/api/dev/recordings/${id}`, "old")).status, 200);
  assert.ok(
    security.events.some(
      (event) =>
        event.uid === "admin" && event.resource === `/api/dev/recordings/${id}`,
    ),
  );
  const minted = await request(
    "/api/dev/agent-tokens",
    "fresh",
    "POST",
    JSON.stringify({ gameId: "dice" }),
  );
  assert.equal(minted.status, 201);
  const credential = (await minted.json()) as { id: string; token: string };
  assert.ok(
    security.events.some(
      (event) =>
        event.operation === "agent-token.minted" &&
        event.resource === credential.id,
    ),
  );
  assert.ok(await services.actions.verifyAgentToken(credential.token));
  emailAllowed = false;
  assert.equal(
    await services.actions.verifyAgentToken(credential.token),
    undefined,
  );
  emailAllowed = true;
  assert.ok(await services.actions.verifyAgentToken(credential.token));
  const stillRecording = await security.setPolicy("admin", ["read", "record"]);
  assert.equal(stillRecording.recordingGeneration, 0);
  const upload = await fetch(
    `http://127.0.0.1:${address.port}/api/telemetry/recordings/${id}/segments/0`,
    {
      method: "PUT",
      headers: {
        authorization: "Bearer fresh",
        "content-type": "audio/wav",
        "x-recording-start-ms": "0",
      },
      body: pcmWav(new Float32Array(8000), 8000),
    },
  );
  assert.equal(upload.status, 200);
  assert.equal((await services.debug.detail(id)).recording.status, "recording");
  await security.setPolicy("admin", ["read", "record", "token"]);
  assert.equal(
    (await request("/api/dev/agent-tokens", "fresh", "POST", "{")).status,
    401,
  );
  await security.setPolicy("admin", ["read"]);
  authTime = now + 1000;
  assert.equal(
    await services.actions.verifyAgentToken(credential.token),
    undefined,
  );
  assert.equal(
    (await request("/api/telemetry/recordings", "fresh", "POST", "{")).status,
    403,
  );
  assert.equal(
    (await request("/api/dev/agent-tokens", "fresh", "POST", "{")).status,
    403,
  );
  assert.equal((await request("/api/dev/reports", "old")).status, 200);
  assert.equal((await request("/api/dev/reports", "fresh")).status, 200);
  await security.setPolicy("admin", ["read", "record", "token"]);
  assert.equal(
    await services.actions.verifyAgentToken(credential.token),
    undefined,
  );
  const revoked = await security.setPolicy("admin", []);
  const other = randomUUID();
  await services.debug.createRecording("other", {
    id: other,
    gameId: "dice",
    startedAt: now,
  });
  assert.equal(
    await finishOwnedRecordings(
      debugDatabase,
      "admin",
      revoked.recordingGeneration,
    ),
    1,
  );
  assert.equal((await services.debug.detail(id)).recording.status, "finished");
  assert.equal(
    (await services.debug.detail(other)).recording.status,
    "recording",
  );
  assert.equal(
    await finishOwnedRecordings(
      debugDatabase,
      "admin",
      revoked.recordingGeneration,
    ),
    0,
  );
  // An already-authorized create may commit after the scan. Regrant cannot revive it,
  // and a repeated old scan cannot finish the new generation's recording.
  const staleId = randomUUID(),
    freshId = randomUUID();
  await services.debug.createRecording(
    "admin",
    { id: staleId, gameId: "dice", startedAt: now },
    revoked.recordingGeneration - 1,
  );
  const restored = await security.setPolicy("admin", [
    "read",
    "record",
    "token",
  ]);
  await services.debug.createRecording(
    "admin",
    { id: freshId, gameId: "dice", startedAt: now },
    restored.recordingGeneration,
  );
  await assert.rejects(
    services.debug.finish("admin", staleId, restored.recordingGeneration),
    RoomError,
  );
  const audio = new Uint8Array(
    await pcmWav(new Float32Array(8000), 8000).arrayBuffer(),
  );
  await assert.rejects(
    services.debug.upload(
      "admin",
      staleId,
      0,
      0,
      audio,
      undefined,
      restored.recordingGeneration,
    ),
    RoomError,
  );
  await assert.rejects(
    services.debug.submitReport(
      "identity",
      "admin",
      {
        id: randomUUID(),
        gameId: "dice",
        category: "bug",
        text: "issue",
        createdAt: now,
        recordingId: staleId,
        offsetMs: 0,
      },
      restored.recordingGeneration,
    ),
    RoomError,
  );
  assert.equal(
    await finishOwnedRecordings(
      debugDatabase,
      "admin",
      revoked.recordingGeneration,
    ),
    1,
  );
  assert.equal(
    (await services.debug.detail(freshId)).recording.status,
    "recording",
  );
  await security.setPolicy("admin", []);
  assert.equal((await request("/api/dev/reports", "fresh")).status, 403);
  assert.equal((await request("/api/dev/me", "fresh")).status, 403);
  await security.setPolicy("admin", ["read"]);
  security.fail = true;
  assert.equal((await request("/api/dev/reports", "fresh")).status, 500);
});

test("F-09: local audit and revoked policy survive reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "f09-security-"));
  try {
    const store = await FileDeveloperSecurityStore.open(directory);
    await store.setPolicy("admin", []);
    await store.append({
      uid: "admin",
      email: "admin@example.test",
      at: 42,
      operation: "read",
      resource: "recording-id",
    });
    const reopened = await FileDeveloperSecurityStore.open(directory);
    assert.deepEqual((await reopened.policy("admin")).capabilities, []);
    assert.equal((await reopened.policy("admin")).generation, 1);
    const event = JSON.parse(
      await readFile(join(directory, "audit.jsonl"), "utf8"),
    );
    assert.equal(event.email, "admin@example.test");
    assert.equal(event.resource, "recording-id");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("F-09: restoring read access requires a newer Google authentication", async () => {
  const now = Date.UTC(2026, 10, 14, 12);
  const store = new MemoryDeveloperSecurityStore(() => now);
  const principal = {
    uid: "admin",
    email: "admin@example.test",
    authTime: now,
  };
  await store.setPolicy("admin", ["record", "token"]);
  await store.setPolicy("admin", ["read", "record", "token"]);
  await assert.rejects(
    authorizeDeveloper(store, principal, "read", now),
    (error: unknown) => error instanceof RoomError && error.status === 401,
  );
  await authorizeDeveloper(
    store,
    { ...principal, authTime: now + 1000 },
    "read",
    now + 1000,
  );
  await authorizeDeveloper(store, principal, "record", now);
});

test("F-09: exhausted admission refuses before verifier, policy reads or audit writes", async (t) => {
  let verifies = 0,
    reads = 0,
    writes = 0;
  class Counted extends MemoryDeveloperSecurityStore {
    override async policy(uid: string) {
      reads++;
      return super.policy(uid);
    }
    override async append(
      event: Parameters<MemoryDeveloperSecurityStore["append"]>[0],
    ) {
      writes++;
      await super.append(event);
    }
  }
  const services = createTelemetryServices({
    gameIds: ["dice"],
    developer: async () => {
      verifies++;
      return {
        uid: "admin",
        email: "admin@example.test",
        authTime: Date.now(),
      };
    },
    security: new Counted(),
    privateAdmission: new TelemetryAdmission(Date.now, 0, 0),
    uploadAdmission: new TelemetryAdmission(Date.now, 0, 0),
    metricsDatabase: new MemoryTelemetryDatabase(),
    debugDatabase: new MemoryDebugDatabase(),
    actionDatabase: new MemoryActionDatabase(),
    objects: new MemoryPrivateObjectStorage(),
    rateLimitKey: "admin-security-test-rate-key-32-bytes",
    extractor: {
      async extract() {
        return [];
      },
    },
  });
  const server = createServer((req, res) => {
    void services.http
      .handle(req, res, "127.0.0.1")
      .then(() => res.end())
      .catch((error: unknown) => {
        res.writeHead(error instanceof RoomError ? error.status : 500);
        res.end();
      });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  for (const [path, method] of [
    ["/api/dev/me", "GET"],
    ["/api/dev/recordings", "GET"],
    ["/api/telemetry/recordings", "POST"],
    ["/api/telemetry/recordings/id/segments/0", "PUT"],
  ]) {
    const response: Response = await fetch(
      `http://127.0.0.1:${address.port}${path}`,
      {
        method,
        headers: { authorization: "Bearer example" },
      },
    );
    assert.equal(response.status, 429);
  }
  assert.deepEqual(
    { verifies, reads, writes },
    { verifies: 0, reads: 0, writes: 0 },
  );
});
