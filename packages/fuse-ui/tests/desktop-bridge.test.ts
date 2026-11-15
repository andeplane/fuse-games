import assert from "node:assert/strict";
import test from "node:test";
import {
  createGameDesktopBridge,
  DESKTOP_CHANNEL,
  desktopMessage,
  type BridgeEvent,
  type MessagePeer,
} from "../src/desktop-bridge.js";
const origin = "https://fuse.test";
const publicId = "a".repeat(20);
test("embedded game bridge validates origin, source, session and room; duplicate invites send once", async () => {
  const sent: unknown[] = [];
  const invited: string[] = [];
  const parent: MessagePeer = {
    postMessage(message, target) {
      assert.equal(target, origin);
      sent.push(message);
    },
  };
  let listener: ((event: BridgeEvent) => void) | undefined;
  const bridge = createGameDesktopBridge({
    origin,
    parent,
    gameId: "fuseball",
    subscribe(onMessage) {
      listener = onMessage;
      return () => {
        listener = undefined;
      };
    },
    invite: async (id) => {
      invited.push(id);
    },
  });
  const receive = (data: unknown, source: unknown = parent, from = origin) =>
    listener?.({ data, source, origin: from });
  const connect = { channel: DESKTOP_CHANNEL, type: "connect", session: "one" };
  receive(connect, {}, origin);
  receive(connect, parent, "https://evil.test");
  assert.equal(bridge.openFriends(), false);
  bridge.setRoom("AB42AA");
  receive(connect);
  assert.deepEqual(sent.pop(), {
    channel: DESKTOP_CHANNEL,
    type: "status",
    session: "one",
    gameId: "fuseball",
    room: "AB42AA",
  });
  assert.equal(bridge.openFriends(), true);
  const invite = {
    channel: DESKTOP_CHANNEL,
    type: "invite",
    session: "one",
    requestId: "invite-1",
    publicId,
    accountId: publicId,
    room: "AB42AA",
  };
  receive({ ...invite, session: "old" });
  receive({ ...invite, publicId: "bad" });
  receive({ ...invite, room: "CD43AA" });
  assert.equal(invited.length, 0);
  receive(invite);
  receive(invite);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(invited, [publicId]);
  assert.ok(
    sent.some((message) => desktopMessage(message)?.type === "invited"),
  );
  receive({ ...connect, session: "two" });
  receive(invite);
  assert.equal(invited.length, 1);
  bridge.dispose();
  assert.equal(listener, undefined);
  assert.equal(bridge.openFriends(), false);
});
test("game bridge rejects malformed envelopes and standalone games keep their own friends panel", () => {
  for (const bad of [
    null,
    {},
    {
      channel: DESKTOP_CHANNEL,
      type: "status",
      session: "a",
      gameId: "x",
      room: "<script>",
    },
    {
      channel: DESKTOP_CHANNEL,
      type: "invited",
      session: "a",
      requestId: "b",
      ok: "yes",
    },
  ])
    assert.equal(desktopMessage(bad), undefined);
  const bridge = createGameDesktopBridge({
    origin,
    gameId: "fuseball",
    subscribe() {
      throw new Error("no subscription needed");
    },
    invite: async () => undefined,
  });
  assert.equal(bridge.openFriends(), false);
  bridge.dispose();
});
