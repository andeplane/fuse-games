import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { TelemetryEvent } from "fuse-telemetry/contracts";
import { createMemoryStorage } from "../src/safe-storage.js";
import {
  ANALYTICS_QUEUE_KEY,
  createAnalyticsDelivery,
} from "../src/analytics-client.js";
import {
  ANALYTICS_ADMISSION_KEY,
  createTelemetrySender,
  type TelemetryTransport,
} from "../src/analytics-transport.js";

const settle = async () => {
  for (let index = 0; index < 1000; index++) await Promise.resolve();
};
const event = (): TelemetryEvent => ({
  v: 1,
  id: randomUUID(),
  gameId: "dice",
  userId: randomUUID(),
  sessionId: randomUUID(),
  accountUid: "enqueue-player",
  name: "fuse.App Opened",
  occurredAt: 100000,
  properties: {},
});
function fixture() {
  const storage = createMemoryStorage();
  const requests: { path: string; init: RequestInit }[] = [];
  let identity: { token: string } | undefined = {
    token: "current-player-token",
  };
  let tokenFailed = false;
  let identityCalls = 0;
  let admission: Response = Response.json({ token: "200000.admission" });
  let response: Response | undefined;
  const transport: TelemetryTransport = {
    storage,
    now: () => 100000,
    origin: "https://app.example",
    apiOrigin: "https://service.example",
    async identity() {
      identityCalls++;
      if (tokenFailed) throw new Error("Token refresh unavailable");
      return identity;
    },
    async request(path, init) {
      requests.push({ path, init });
      if (path.endsWith("/session")) return admission.clone();
      const body = JSON.parse(String(init.body)) as {
        events: TelemetryEvent[];
      };
      return (
        response?.clone() ??
        Response.json({ acknowledgedIds: body.events.map((value) => value.id) })
      );
    },
  };
  return {
    transport,
    storage,
    requests,
    send: createTelemetrySender(transport),
    guest: () => {
      identity = undefined;
    },
    failIdentity: (failed: boolean) => {
      tokenFailed = failed;
    },
    identityCalls: () => identityCalls,
    admission: (value: Response) => {
      admission = value;
    },
    response: (value: Response) => {
      response = value;
    },
  };
}

test("production sender separates account and admission credentials from the durable event claim", async () => {
  const f = fixture(),
    value = event();
  assert.deepEqual(await f.send([value], () => true), [value.id]);
  assert.equal(f.requests.length, 2);
  assert.equal(
    f.requests[0]?.path,
    "https://service.example/api/telemetry/session",
  );
  const request = f.requests[1]!;
  const headers = new Headers(request.init.headers);
  assert.equal(headers.get("Authorization"), "Bearer 200000.admission");
  assert.equal(headers.get("X-Fuse-Identity"), "current-player-token");
  assert.equal(request.init.keepalive, true);
  assert.deepEqual(JSON.parse(String(request.init.body)), { events: [value] });
  assert.ok(!String(request.init.body).includes("current-player-token"));
  assert.ok(
    !f.storage
      .getItem(ANALYTICS_ADMISSION_KEY)
      ?.includes("current-player-token"),
  );
  f.guest();
  await f.send([value], () => true);
  assert.equal(f.requests.length, 3, "valid admission is reused");
  assert.equal(
    new Headers(f.requests[2]!.init.headers).has("X-Fuse-Identity"),
    false,
  );
  assert.equal(
    JSON.parse(String(f.requests[2]!.init.body)).events[0].accountUid,
    "enqueue-player",
    "delivery never rewrites the captured account on sign-out",
  );
});

test("invalid telemetry configuration cannot throw during game startup", async () => {
  const f = fixture();
  f.transport.apiOrigin = "https://service.example/invalid-path";
  const send = createTelemetrySender(f.transport);
  await assert.rejects(
    send([event()], () => true),
    /Invalid API origin/,
  );
  assert.deepEqual(f.requests, []);
});

test("token refresh failures retain the original queued event for authenticated retry", async () => {
  const f = fixture(),
    storage = createMemoryStorage();
  f.failIdentity(true);
  const delivery = createAnalyticsDelivery(
    {
      storage,
      now: () => 100000,
      uuid: randomUUID,
      accountUid: async () => "enqueue-player",
      schedule: () => () => {},
      exclusive: async (operation) => operation(),
      send: f.send,
    },
    () => true,
  );
  delivery.enqueue("dice", "fuse.App Opened", {});
  await settle();
  const queued = JSON.parse(
    storage.getItem(ANALYTICS_QUEUE_KEY)!,
  ) as TelemetryEvent[];
  delivery.flush();
  await settle();
  assert.equal(
    f.requests.filter((request) => request.path.endsWith("/events")).length,
    0,
  );
  assert.deepEqual(JSON.parse(storage.getItem(ANALYTICS_QUEUE_KEY)!), queued);
  f.failIdentity(false);
  delivery.flush();
  await settle();
  assert.deepEqual(JSON.parse(storage.getItem(ANALYTICS_QUEUE_KEY)!), []);
  const sent = JSON.parse(String(f.requests.at(-1)!.init.body))
    .events as TelemetryEvent[];
  assert.equal(sent[0]?.id, queued[0]?.id);
  assert.equal(sent[0]?.accountUid, "enqueue-player");
});

test("privacy changes during credential resolution prevent delivery", async () => {
  const f = fixture();
  let enabled = true;
  f.transport.identity = async () => {
    enabled = false;
    return { token: "never-delivered" };
  };
  assert.deepEqual(await f.send([event()], () => enabled), []);
  assert.equal(f.requests.length, 1, "only anonymous admission was requested");
  assert.equal(f.requests[0]?.init.headers, undefined);
  assert.deepEqual(await f.send([event()], () => false), []);
  assert.equal(f.requests.length, 1);
});

test("expired or implausible admission is renewed and 401 evicts a rejected credential", async () => {
  for (const token of ["broken", "100000.old", "999999999.future"]) {
    const f = fixture();
    f.storage.setItem(ANALYTICS_ADMISSION_KEY, token);
    await f.send([event()], () => true);
    assert.equal(f.requests.length, 2);
  }
  const f = fixture();
  f.response(new Response(null, { status: 401 }));
  await assert.rejects(
    f.send([event()], () => true),
    /Metrics session expired/,
  );
  assert.equal(f.storage.getItem(ANALYTICS_ADMISSION_KEY), null);
  f.response(Response.json({ acknowledgedIds: [] }));
  await f.send([event()], () => true);
  assert.equal(
    f.requests.filter((request) => request.path.endsWith("/session")).length,
    2,
  );
});

test("admission refusal and invalid acknowledgements have explicit retry semantics", async () => {
  const value = event();
  const unavailable = fixture();
  unavailable.admission(new Response(null, { status: 404 }));
  assert.deepEqual(await unavailable.send([value], () => true), [value.id]);
  assert.equal(unavailable.identityCalls(), 0);
  for (const body of [null, {}, { token: 42 }]) {
    const f = fixture();
    f.admission(Response.json(body));
    await assert.rejects(
      f.send([value], () => true),
      /Invalid metrics admission/,
    );
  }
  const admissionFailure = fixture();
  admissionFailure.admission(new Response(null, { status: 503 }));
  await assert.rejects(
    admissionFailure.send([value], () => true),
    /Metrics admission unavailable/,
  );
  for (const status of [408, 429, 500]) {
    const f = fixture();
    f.response(new Response(null, { status }));
    await assert.rejects(
      f.send([value], () => true),
      /Metrics unavailable/,
    );
  }
  for (const status of [400, 403, 409, 422]) {
    const f = fixture();
    f.response(new Response(null, { status }));
    assert.deepEqual(await f.send([value], () => true), [value.id]);
  }
  for (const body of [null, {}, { acknowledgedIds: "invalid" }]) {
    const f = fixture();
    f.response(Response.json(body));
    await assert.rejects(
      f.send([value], () => true),
      /Invalid metrics acknowledgement/,
    );
  }
  const f = fixture();
  f.response(Response.json({ acknowledgedIds: [value.id, 42, null] }));
  assert.deepEqual(await f.send([value], () => true), [value.id]);
});
