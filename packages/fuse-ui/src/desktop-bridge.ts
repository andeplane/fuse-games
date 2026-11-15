/** Same-origin, versioned desktop protocol. Room/account credentials never cross it. */
export const DESKTOP_CHANNEL = "fuse.desktop.v1";
export interface MessagePeer {
  postMessage(message: unknown, targetOrigin: string): void;
}
export interface BridgeEvent {
  origin: string;
  source: unknown;
  data: unknown;
}
export interface BridgeRoom {
  gameId: string;
  code: string;
}
export type DesktopMessage =
  | {
      channel: typeof DESKTOP_CHANNEL;
      type: "ready";
      session: string;
      gameId: string;
    }
  | { channel: typeof DESKTOP_CHANNEL; type: "connect"; session: string }
  | {
      channel: typeof DESKTOP_CHANNEL;
      type: "status";
      session: string;
      gameId: string;
      room: string | null;
    }
  | { channel: typeof DESKTOP_CHANNEL; type: "friends"; session: string }
  | {
      channel: typeof DESKTOP_CHANNEL;
      type: "invite";
      session: string;
      requestId: string;
      publicId: string;
      accountId: string;
      room: string;
    }
  | {
      channel: typeof DESKTOP_CHANNEL;
      type: "invited";
      session: string;
      requestId: string;
      ok: boolean;
    };
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(value);
export const bridgeRoomCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z0-9]{6}$/.test(value);
export function desktopMessage(value: unknown): DesktopMessage | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (v.channel !== DESKTOP_CHANNEL || !id(v.session)) return;
  switch (v.type) {
    case "connect":
    case "friends":
      break;
    case "ready":
      if (!id(v.gameId)) return;
      break;
    case "status":
      if (!id(v.gameId) || (v.room !== null && !bridgeRoomCode(v.room))) return;
      break;
    case "invite":
      if (
        !id(v.requestId) ||
        typeof v.publicId !== "string" ||
        !/^[0-9a-f]{20}$/.test(v.publicId) ||
        typeof v.accountId !== "string" ||
        !/^[0-9a-f]{20}$/.test(v.accountId) ||
        !bridgeRoomCode(v.room)
      )
        return;
      break;
    case "invited":
      if (!id(v.requestId) || typeof v.ok !== "boolean") return;
      break;
    default:
      return;
  }
  return v as unknown as DesktopMessage;
}
export interface GameBridgeDeps {
  origin: string;
  parent?: MessagePeer;
  subscribe(listener: (event: BridgeEvent) => void): () => void;
  gameId: string;
  invite(publicId: string, accountId: string): Promise<unknown>;
}
export interface GameDesktopBridge {
  setRoom(code: string | undefined): void;
  /** False while standalone or the desktop has not completed its handshake. */
  openFriends(): boolean;
  dispose(): void;
}
export function createGameDesktopBridge(
  deps: GameBridgeDeps,
): GameDesktopBridge {
  let session: string | undefined;
  let room: string | undefined;
  let disposed = false;
  const requests = new Map<string, Promise<boolean>>();
  const post = (message: DesktopMessage) =>
    deps.parent?.postMessage(message, deps.origin);
  const status = () => {
    if (session)
      post({
        channel: DESKTOP_CHANNEL,
        type: "status",
        session,
        gameId: deps.gameId,
        room: room ?? null,
      });
  };
  const stop = deps.parent
    ? deps.subscribe((event) => {
        if (
          disposed ||
          event.origin !== deps.origin ||
          event.source !== deps.parent
        )
          return;
        const message = desktopMessage(event.data);
        if (!message) return;
        if (message.type === "connect") {
          if (session !== message.session) requests.clear();
          session = message.session;
          status();
        } else if (message.type === "invite" && message.session === session) {
          const generation = session;
          let result = requests.get(message.requestId);
          if (!result) {
            if (!room || message.room !== room) {
              post({
                channel: DESKTOP_CHANNEL,
                type: "invited",
                session,
                requestId: message.requestId,
                ok: false,
              });
              return;
            }
            if (requests.size >= 32)
              requests.delete(requests.keys().next().value!);
            result = (async () => {
              try {
                await deps.invite(message.publicId, message.accountId);
                return true;
              } catch {
                return false;
              }
            })();
            requests.set(message.requestId, result);
          }
          void result.then((ok) => {
            if (!disposed && session === generation)
              post({
                channel: DESKTOP_CHANNEL,
                type: "invited",
                session: generation,
                requestId: message.requestId,
                ok,
              });
          });
        }
      })
    : () => undefined;
  if (deps.parent)
    post({
      channel: DESKTOP_CHANNEL,
      type: "ready",
      session: "ready",
      gameId: deps.gameId,
    });
  return {
    setRoom(code) {
      const next = bridgeRoomCode(code) ? code : undefined;
      if (room !== next) requests.clear();
      room = next;
      status();
    },
    openFriends() {
      if (!session || disposed) return false;
      post({ channel: DESKTOP_CHANNEL, type: "friends", session });
      return true;
    },
    dispose() {
      if (disposed) return;
      room = undefined;
      status();
      disposed = true;
      stop();
      requests.clear();
    },
  };
}
/** Production adapter; tests supply the same small message surface directly. */
export function browserGameBridge(
  win: Window | null,
  gameId: string,
  invite: (publicId: string, accountId: string) => Promise<unknown>,
): GameDesktopBridge {
  return createGameDesktopBridge({
    origin: win?.location?.origin ?? "",
    ...(win && win.parent !== win ? { parent: win.parent } : {}),
    gameId,
    invite,
    subscribe(listener) {
      if (!win) return () => undefined;
      win.addEventListener("message", listener);
      return () => win.removeEventListener("message", listener);
    },
  });
}
