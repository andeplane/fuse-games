import {
  DESKTOP_CHANNEL,
  desktopMessage,
  type BridgeEvent,
  type BridgeRoom,
  type MessagePeer,
} from "fuse-ui/desktop-bridge";

export interface DesktopBridgeDeps {
  origin: string;
  schedule(callback: () => void, ms: number): () => void;
  openFriends(): void;
  changed(room: BridgeRoom | undefined): void;
}
interface Frame {
  peer: MessagePeer;
  gameId: string;
  session: string;
  room?: string;
}
interface Pending {
  frame: Frame;
  room: string;
  resolve(): void;
  reject(error: Error): void;
  cancel(): void;
}
/** Only registered game frames on this origin can publish presence or answer an invitation. */
export class DesktopBridge {
  private sequence = 0;
  private frames = new Set<Frame>();
  private pending = new Map<string, Pending>();
  private current?: Frame;
  constructor(private readonly deps: DesktopBridgeDeps) {}
  private publish() {
    if (!this.current || !this.frames.has(this.current))
      this.current = [...this.frames].reverse().find((frame) => frame.room);
    this.deps.changed(
      this.current?.room
        ? { gameId: this.current.gameId, code: this.current.room }
        : undefined,
    );
  }
  private rejectFrame(frame: Frame) {
    for (const [id, pending] of this.pending)
      if (pending.frame === frame) {
        this.pending.delete(id);
        pending.cancel();
        pending.reject(
          new Error(
            "The game changed rooms or closed. Try again in its current room.",
          ),
        );
      }
  }
  register(peer: MessagePeer, gameId: string) {
    const frame: Frame = { peer, gameId, session: "" };
    this.frames.add(frame);
    const reconnect = () => {
      this.rejectFrame(frame);
      frame.session = `frame-${++this.sequence}`;
      frame.room = undefined;
      this.publish();
      peer.postMessage(
        { channel: DESKTOP_CHANNEL, type: "connect", session: frame.session },
        this.deps.origin,
      );
    };
    reconnect();
    return {
      reconnect,
      dispose: () => {
        this.rejectFrame(frame);
        this.frames.delete(frame);
        this.publish();
      },
    };
  }
  receive(event: BridgeEvent) {
    if (event.origin !== this.deps.origin) return;
    const message = desktopMessage(event.data);
    if (!message) return;
    if (message.type === "ready") {
      const ready = [...this.frames].find(
        (candidate) =>
          candidate.peer === event.source &&
          candidate.gameId === message.gameId,
      );
      if (ready)
        ready.peer.postMessage(
          { channel: DESKTOP_CHANNEL, type: "connect", session: ready.session },
          this.deps.origin,
        );
      return;
    }
    const frame = [...this.frames].find(
      (candidate) =>
        candidate.peer === event.source &&
        candidate.session === message.session,
    );
    if (!frame) return;
    if (message.type === "status" && message.gameId === frame.gameId) {
      if (frame.room !== (message.room ?? undefined)) this.rejectFrame(frame);
      frame.room = message.room ?? undefined;
      if (frame.room) this.current = frame;
      this.publish();
    } else if (message.type === "friends") {
      this.current = frame;
      this.publish();
      this.deps.openFriends();
    } else if (message.type === "invited") {
      const pending = this.pending.get(message.requestId);
      if (!pending || pending.frame !== frame || pending.room !== frame.room)
        return;
      this.pending.delete(message.requestId);
      pending.cancel();
      if (message.ok) pending.resolve();
      else
        pending.reject(
          new Error(
            "The invitation could not be sent. Check your sign-in and room, then try again.",
          ),
        );
    }
  }
  invite(publicId: string, accountId: string): Promise<void> {
    const frame = this.current;
    if (!/^[0-9a-f]{20}$/.test(publicId))
      return Promise.reject(new Error("Invalid player id."));
    if (!/^[0-9a-f]{20}$/.test(accountId))
      return Promise.reject(
        new Error("Sign in again before inviting a friend."),
      );
    if (!frame?.room)
      return Promise.reject(
        new Error("Open a game and join a room before inviting a friend."),
      );
    if (this.pending.size >= 16)
      return Promise.reject(
        new Error("Wait for the current invitations, then try again."),
      );
    const room = frame.room;
    const requestId = `invite-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const cancel = this.deps.schedule(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            "The game did not answer. Return to the game, then try the invite again.",
          ),
        );
      }, 10_000);
      this.pending.set(requestId, { frame, room, resolve, reject, cancel });
      frame.peer.postMessage(
        {
          channel: DESKTOP_CHANNEL,
          type: "invite",
          session: frame.session,
          requestId,
          publicId,
          accountId,
          room,
        },
        this.deps.origin,
      );
    });
  }
  dispose() {
    for (const frame of this.frames) this.rejectFrame(frame);
    this.frames.clear();
    this.current = undefined;
  }
}
