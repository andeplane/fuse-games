import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createTelemetryServices } from "../service/telemetry.js";
import { MemoryTelemetryDatabase } from "fuse-telemetry/metrics-memory";
import {
  MemoryDebugDatabase,
  MemoryPrivateObjectStorage,
} from "fuse-telemetry/debug-memory";
import { MemoryActionDatabase } from "fuse-telemetry/action-adapters";
import { MemoryDeveloperSecurityStore } from "fuse-telemetry/developer-security";
import type { ActionItem } from "fuse-telemetry/contracts";
test("actual HTTP protects new routes and publishes a current proposal through the real action lookup", async (t) => {
  const now = Date.UTC(2026, 10, 15, 12),
    security = new MemoryDeveloperSecurityStore(() => now - 5000),
    actions = new MemoryActionDatabase(),
    recordingId = randomUUID(),
    actionId = `${recordingId}_1234567890abcdef`;
  await security.setPolicy("admin", ["read", "token"]);
  const item: ActionItem = {
    id: actionId,
    recordingId,
    gameId: "dice",
    title: "Fix round menu",
    detail: "Minimal reproduction",
    evidence: [
      {
        sequence: 0,
        startMs: 0,
        endMs: 1000,
        quote: "Fix the round menu.",
        reportIds: [],
      },
    ],
    status: "proposed",
    createdAt: now,
    updatedAt: now,
    revision: 1,
    lease: null,
    resolution: null,
    retraction: null,
    correction: null,
  };
  await actions.transact(recordingId, () => ({
    state: {
      recordingId,
      gameId: "dice",
      items: [item],
      processed: {},
      leaseSecrets: {},
      extractionLease: null,
      expiresAt: now + 86400000,
    },
    result: undefined,
  }));
  let posts = 0;
  const services = createTelemetryServices({
    gameIds: ["dice"],
    now: () => now,
    developer: async (token) =>
      token === "admin"
        ? { uid: "admin", email: "andersullnass@gmail.com", authTime: now }
        : undefined,
    metricsDatabase: new MemoryTelemetryDatabase(),
    debugDatabase: new MemoryDebugDatabase(),
    actionDatabase: actions,
    objects: new MemoryPrivateObjectStorage(),
    security,
    rateLimitKey: "test-http-only-rate-key-at-least-32-bytes",
    extractor: {
      async extract() {
        return [];
      },
    },
    request: async (url, init) => {
      if (new URL(String(url)).pathname === "/user")
        return Response.json({ login: "developer" });
      if (init?.method === "POST") {
        posts++;
        return Response.json({
          html_url: "https://github.com/andeplane/fuse-games/issues/123",
        });
      }
      return Response.json([]);
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
      .catch((error: { status?: number }) => {
        res.writeHead(error.status ?? 500);
        res.end();
      });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const request = (path: string, body?: object, token = "admin") =>
    fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal(
    (await request("/api/dev/catalog", undefined, "fa1.fake")).status,
    403,
  );
  assert.equal((await request("/api/dev/catalog")).status, 200);
  assert.equal(
    (
      await request("/api/dev/events", {
        from: "2026-11-01",
        to: "2026-11-15",
        gameId: "",
        filters: { groups: [] },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/dev/github", {
        token: "gho_testcredential000000000000000",
      })
    ).status,
    200,
  );
  const draft = {
    recordingId,
    actionId,
    revision: 1,
    title: item.title,
    body: "Steps to reproduce without private evidence.",
  };
  assert.equal((await request("/api/dev/github/issues", draft)).status, 200);
  assert.equal(posts, 1);
  assert.equal(
    (await request("/api/dev/github/issues", { ...draft, revision: 0 })).status,
    409,
  );
  assert.equal(posts, 1);
  await security.setPolicy("admin", []);
  assert.equal((await request("/api/dev/catalog")).status, 403);
});
