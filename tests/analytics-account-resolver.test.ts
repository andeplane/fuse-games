import assert from "node:assert/strict";
import test from "node:test";
import {
  createAnalyticsAccountResolver,
  createLocalTelemetry,
} from "../service/telemetry.js";
import { FileDeveloperSecurityStore } from "fuse-telemetry/developer-security";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { RoomError } from "fuse-network-be";
import type { ExplorerResult } from "fuse-telemetry/explorer-contracts";

test("analytics resolves the verified UID's username, never a browser-supplied name", async () => {
  const reads: string[] = [];
  let profile: Record<string, unknown> | undefined = {
    username: "Actual Username",
    name: "Display Name",
  };
  let failed = false;
  const resolve = createAnalyticsAccountResolver(
    async (token) =>
      token === "valid-player-token" ? "verified-uid" : undefined,
    {
      doc(uid) {
        reads.push(uid);
        return {
          async get() {
            if (failed) throw new Error("Profile unavailable");
            return { data: () => profile };
          },
        };
      },
    },
  );
  assert.equal(await resolve("forged-token"), undefined);
  assert.deepEqual(reads, []);
  assert.deepEqual(await resolve("valid-player-token"), {
    uid: "verified-uid",
    name: "Actual Username",
  });
  profile = { username: 123, name: "Display Name" };
  assert.deepEqual(await resolve("valid-player-token"), {
    uid: "verified-uid",
    name: "Display Name",
  });
  profile = { username: "bad\nname", name: "also\nbad" };
  assert.deepEqual(await resolve("valid-player-token"), {
    uid: "verified-uid",
    name: "Signed-in player",
  });
  profile = undefined;
  assert.deepEqual(await resolve("valid-player-token"), {
    uid: "verified-uid",
    name: "Signed-in player",
  });
  assert.ok(reads.every((uid) => uid === "verified-uid"));
  failed = true;
  await assert.rejects(resolve("valid-player-token"), /Profile unavailable/);
});
test("local service without account verification keeps a claimed account anonymous in the actual workspace API", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fuse-account-local-"));
  const now = Date.UTC(2026, 10, 17, 12);
  const security = await FileDeveloperSecurityStore.open(
    join(directory, "security"),
  );
  await security.setPolicy("local-admin", ["read"]);
  const policy = await security.policy("local-admin");
  const services = await createLocalTelemetry({
    directory,
    gameIds: ["dice"],
    now: () => now,
    developer: async (token) =>
      token === "local-admin-token"
        ? {
            uid: "local-admin",
            email: "local-admin@example.test",
            authTime: policy.notBefore,
          }
        : undefined,
  });
  const server = createServer((req, res) => {
    void services.http.handle(req, res, "127.0.0.1").catch((error: unknown) => {
      res.writeHead(error instanceof RoomError ? error.status : 500);
      res.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const admission = (await (
    await fetch(`${origin}/api/telemetry/session`, { method: "POST" })
  ).json()) as { token: string };
  const value = {
    v: 1,
    id: randomUUID(),
    userId: randomUUID(),
    sessionId: randomUUID(),
    accountUid: "claimed-player",
    gameId: "dice",
    name: "fuse.App Opened",
    occurredAt: now,
    properties: {},
  };
  const posted = await fetch(`${origin}/api/telemetry/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${admission.token}`,
      "X-Fuse-Identity": "unverified-player-token",
    },
    body: JSON.stringify({ events: [value] }),
  });
  assert.equal(posted.status, 200);
  const response = await fetch(`${origin}/api/dev/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer local-admin-token",
    },
    body: JSON.stringify({
      from: "2026-11-17",
      to: "2026-11-17",
      gameId: "",
      filters: { groups: [] },
    }),
  });
  assert.equal(response.status, 200);
  const result = (await response.json()) as ExplorerResult;
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.accountId, undefined);
  assert.equal(result.events[0]?.accountName, undefined);
  assert.equal(result.events[0]?.userId, value.userId);
});
