import {
  DESKTOP_CHANNEL,
  type MessagePeer,
  type BridgeRoom,
} from "fuse-ui/desktop-bridge";
import { ManualScheduler } from "../__mocks__/dialUpDeps";
import { DesktopBridge } from "./desktopBridge";
const origin = "https://fuse.test";
const publicId = "a".repeat(20);
function fixture() {
  const scheduler = new ManualScheduler();
  const sent: Record<string, unknown>[] = [];
  const rooms: (BridgeRoom | undefined)[] = [];
  const peer: MessagePeer = {
    postMessage(message, target) {
      expect(target).toBe(origin);
      sent.push(message as Record<string, unknown>);
    },
  };
  let opened = 0;
  const bridge = new DesktopBridge({
    origin,
    schedule: scheduler.schedule.bind(scheduler),
    changed: (room) => rooms.push(room),
    openFriends: () => {
      opened++;
    },
  });
  const registration = bridge.register(peer, "fuseball");
  const receive = (
    message: Record<string, unknown>,
    source: unknown = peer,
    from = origin,
  ) =>
    bridge.receive({
      origin: from,
      source,
      data: { channel: DESKTOP_CHANNEL, session: sent[0]?.session, ...message },
    });
  return {
    bridge,
    scheduler,
    sent,
    rooms,
    peer,
    receive,
    registration,
    opened: () => opened,
  };
}
describe("desktop bridge", () => {
  it("only accepts the registered origin, source, game and session; routes friends to Messenger", () => {
    const f = fixture();
    const status = { type: "status", gameId: "fuseball", room: "AB42AA" };
    f.receive(status, {}, origin);
    f.receive(status, f.peer, "https://evil.test");
    f.receive({ ...status, gameId: "other" });
    f.receive({ ...status, session: "old" });
    expect(f.rooms.at(-1)).toBeUndefined();
    f.receive(status);
    expect(f.rooms.at(-1)).toEqual({ gameId: "fuseball", code: "AB42AA" });
    f.receive({ type: "friends" });
    expect(f.opened()).toBe(1);
    f.registration.dispose();
    f.receive(status);
    expect(f.rooms.at(-1)).toBeUndefined();
  });
  it("waits for an applied invite result, ignores unrelated replies and cancels on room changes", async () => {
    const f = fixture();
    f.receive({ type: "status", gameId: "fuseball", room: "AB42AA" });
    let completed = false;
    const promise = f.bridge.invite(publicId, publicId).then(() => {
      completed = true;
    });
    const request = f.sent.at(-1)!;
    expect(request).toMatchObject({ type: "invite", publicId, room: "AB42AA" });
    f.receive({ type: "invited", requestId: request.requestId, ok: true }, {});
    await Promise.resolve();
    expect(completed).toBe(false);
    f.receive({ type: "invited", requestId: request.requestId, ok: true });
    await promise;
    expect(completed).toBe(true);
    const stale = f.bridge.invite(publicId, publicId);
    f.receive({ type: "status", gameId: "fuseball", room: "CD43AA" });
    await expect(stale).rejects.toThrow("changed rooms");
    expect(f.scheduler.pending).toBe(0);
  });
  it("fails visibly on timeout and navigation and never accepts an old session", async () => {
    const f = fixture();
    await expect(f.bridge.invite(publicId, publicId)).rejects.toThrow(
      "join a room",
    );
    f.receive({ type: "status", gameId: "fuseball", room: "AB42AA" });
    const timeout = f.bridge.invite(publicId, publicId);
    f.scheduler.advance(10_000);
    await expect(timeout).rejects.toThrow("did not answer");
    const navigated = f.bridge.invite(publicId, publicId);
    f.registration.reconnect();
    await expect(navigated).rejects.toThrow("changed rooms");
    f.receive({ type: "status", gameId: "fuseball", room: "AB42AA" });
    expect(f.rooms.at(-1)).toBeUndefined();
    f.bridge.dispose();
    expect(f.scheduler.pending).toBe(0);
  });
  it("connects late game panels and uses the room that asked to open Messenger", async () => {
    const f = fixture();
    f.receive({ type: "ready", session: "ready", gameId: "fuseball" });
    expect(f.sent.at(-1)).toMatchObject({
      type: "connect",
      session: f.sent[0]?.session,
    });
    f.receive({ type: "status", gameId: "fuseball", room: "AB42AA" });
    const otherSent: Record<string, unknown>[] = [];
    const other: MessagePeer = {
      postMessage: (message) =>
        otherSent.push(message as Record<string, unknown>),
    };
    const registration = f.bridge.register(other, "fuse-craft");
    f.bridge.receive({
      origin,
      source: other,
      data: {
        channel: DESKTOP_CHANNEL,
        type: "status",
        session: otherSent[0]?.session,
        gameId: "fuse-craft",
        room: "CD43AA",
      },
    });
    expect(f.rooms.at(-1)?.gameId).toBe("fuse-craft");
    f.receive({ type: "friends" });
    expect(f.rooms.at(-1)).toEqual({ gameId: "fuseball", code: "AB42AA" });
    const invited = f.bridge.invite(publicId, "b".repeat(20));
    expect(f.sent.at(-1)).toMatchObject({
      type: "invite",
      room: "AB42AA",
      accountId: "b".repeat(20),
    });
    f.receive({
      type: "invited",
      requestId: f.sent.at(-1)?.requestId,
      ok: true,
    });
    await invited;
    f.receive({ type: "status", gameId: "fuseball", room: null });
    f.receive({ type: "friends" });
    await expect(f.bridge.invite(publicId, publicId)).rejects.toThrow(
      "join a room",
    );
    registration.dispose();
    f.bridge.dispose();
  });
});
