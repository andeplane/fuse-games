import test from "node:test";
import assert from "node:assert/strict";
import { createMessengerClient } from "../src/messenger-client.js";

const me = "a".repeat(20),
  friend = "b".repeat(20),
  id = "c".repeat(32);

test("Messenger sends credentials only in headers and preserves message ids for a retry", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const client = createMessengerClient({
    token: async () => "secret-token",
    apiUrl: (path) => `https://example.test${path}`,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({
        messages: [{ id, from: me, text: "hello", at: 10 }],
      });
    },
  });
  assert.equal((await client.load(friend, me)).messages.length, 1);
  await client.send(friend, id, "hello", me);
  await client.send(friend, id, "hello", me);
  assert.equal(
    requests[0]!.url,
    `https://example.test/api/friends/${friend}/messages`,
  );
  assert.equal(
    new Headers(requests[0]!.init!.headers).get("Authorization"),
    "Bearer secret-token",
  );
  assert.equal(
    new Headers(requests[0]!.init!.headers).get("X-Fuse-Account"),
    me,
  );
  assert.deepEqual(JSON.parse(String(requests[1]!.init!.body)), {
    id,
    text: "hello",
  });
  assert.equal(requests[1]!.init!.body, requests[2]!.init!.body);
  assert.equal(
    requests.some(
      (request) =>
        request.url.includes("secret-token") ||
        String(request.init!.body).includes("secret-token"),
    ),
    false,
  );
});

test("Messenger refuses unsigned or malformed responses and presents retryable network failures", async () => {
  let token: string | undefined;
  let response: unknown = { messages: [] };
  let calls = 0;
  const client = createMessengerClient({
    token: async () => token,
    apiUrl: (path) => path,
    fetch: async () => {
      calls++;
      return Response.json(response);
    },
  });
  await assert.rejects(client.load(friend, me), /Sign in/);
  assert.equal(calls, 0);
  token = "token";
  response = {
    messages: [{ id: "bad", text: "spoofed", from: friend, at: 1 }],
  };
  await assert.rejects(client.load(friend, me), /Conversation unavailable/);
  await assert.rejects(client.load("bad", me), /Choose a friend/);
  const broken = createMessengerClient({
    token: async () => "token",
    apiUrl: (path) => path,
    fetch: async () => {
      throw new Error("network");
    },
  });
  await assert.rejects(broken.load(friend, me), /Try again/);
});
