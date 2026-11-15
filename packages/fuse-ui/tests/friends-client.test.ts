import test from "node:test";
import assert from "node:assert/strict";
import { createFriendsClient } from "../src/friends-client.js";

test("an old account's in-flight sync cannot restore its friend list after switching accounts", async () => {
  const pending: (() => void)[] = [];
  let resolve: ((response: Response) => void) | undefined;
  const client = createFriendsClient({
    token: async () => "token",
    apiUrl: (path) => path,
    identity: () => ({}),
    clock: {
      now: () => 100_000,
      schedule(run) {
        pending.push(run);
        return () => {};
      },
    },
    fetch: async () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  });
  client.setSignedIn(true);
  pending.shift()!();
  await new Promise((done) => setImmediate(done));
  client.setSignedIn(false);
  client.setSignedIn(true);
  resolve!(
    Response.json({
      me: { publicId: "old-account", name: "Old" },
      friends: [],
      incoming: [],
      outgoing: [],
      invites: [],
      roomPlayers: [],
    }),
  );
  await new Promise((done) => setImmediate(done));
  assert.equal(client.state().view, undefined);
  assert.equal(
    pending.length,
    1,
    "old poll does not schedule another timer for the new account",
  );
  client.dispose();
});

/** A client whose every poll is captured: the bodies it sent, and a way to run the next scheduled poll. */
function recorded(
  options: Pick<
    Parameters<typeof createFriendsClient>[0],
    "passive" | "presence"
  >,
) {
  const pending: (() => void)[] = [],
    bodies: unknown[] = [];
  const client = createFriendsClient({
    ...options,
    token: async () => "token",
    apiUrl: (path) => path,
    identity: () => ({ name: "Bob" }),
    clock: {
      now: () => 100_000,
      schedule(run) {
        pending.push(run);
        return () => {};
      },
    },
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        me: { publicId: "me", name: "Bob" },
        friends: [],
        incoming: [],
        outgoing: [],
        invites: [],
        roomPlayers: [],
      });
    },
  });
  client.setSignedIn(true);
  return {
    client,
    bodies,
    async poll() {
      pending.shift()!();
      await new Promise((done) => setImmediate(done));
    },
  };
}
const ROOM = {
  code: "AB12",
  memberId: "a".repeat(24),
  gameId: "fuse-riders",
  token: "secret",
};

test("a game's client sends what it always sent: no passive, away or status unless it is given them", async () => {
  const { client, bodies, poll } = recorded({});
  client.setRoom(ROOM);
  await poll();
  assert.deepEqual(bodies, [
    {
      name: "Bob",
      room: { code: "AB12", memberId: "a".repeat(24), gameId: "fuse-riders" },
    },
  ]);
  client.dispose();
});

test("a passive client reports away and status as they are at each poll and never a room", async () => {
  let presence: { away?: boolean; status?: string } = {};
  const { client, bodies, poll } = recorded({
    passive: true,
    presence: () => presence,
  });
  // Even handed a room, a passive page does not claim it: the page in the room does.
  client.setRoom(ROOM);
  await poll();
  presence = { away: true, status: "brb" };
  await poll();
  presence = { away: false, status: "" };
  await poll();
  assert.deepEqual(bodies, [
    { name: "Bob", passive: true },
    { name: "Bob", passive: true, away: true, status: "brb" },
    { name: "Bob", passive: true, away: false, status: "" },
  ]);
  client.dispose();
});

test("an active client may report away and status beside its room", async () => {
  const { client, bodies, poll } = recorded({
    presence: () => ({ away: true }),
  });
  await poll();
  assert.deepEqual(bodies, [{ name: "Bob", away: true }]);
  client.dispose();
});

test("Messenger invites send a validated expected account while legacy invites omit the header", async () => {
  const requests: RequestInit[] = [];
  const client = createFriendsClient({
    token: async () => "signed-in-account-token",
    apiUrl: (path) => path,
    identity: () => ({}),
    clock: { now: () => 100_000, schedule: () => () => {} },
    fetch: async (_url, init) => {
      requests.push(init ?? {});
      return Response.json({ sent: 1 });
    },
  });
  client.setRoom(ROOM);
  const expected = "a".repeat(20),
    friend = "b".repeat(20);
  await assert.rejects(
    client.invite([friend], "invalid"),
    /Invalid expected account/,
  );
  assert.equal(
    requests.length,
    0,
    "an invalid expected account sends no request",
  );
  assert.equal(await client.invite([friend], expected), 1);
  const bound = new Headers(requests[0]!.headers);
  assert.equal(bound.get("X-Fuse-Account"), expected);
  assert.equal(bound.get("X-Fuse-Identity"), "signed-in-account-token");
  assert.equal(bound.get("Authorization"), "Bearer secret");
  assert.deepEqual(JSON.parse(String(requests[0]!.body)), { to: [friend] });
  assert.equal(await client.invite([friend]), 1);
  assert.equal(new Headers(requests[1]!.headers).has("X-Fuse-Account"), false);
  client.dispose();
});
