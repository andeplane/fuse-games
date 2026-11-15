import { useContext, useEffect, useRef, useState } from "react";

import { Win98Icon } from "../ui/icons";

import { useAppState } from "../state/useAppState";
import type { WindowKind } from "../state/appState";
import { useWindowCommands } from "../windows/useWindowCommands";

import { FriendsDepsContext } from "./friendsDepsContext";
import { MessengerReadContext } from "./messengerRead";
import type { PresenceEvent } from "./presenceEvents";
import { presenceEvents } from "./presenceEvents";
import type { PresenceSnapshot } from "./presenceService";
import { PresenceServiceContext } from "./presenceService";
import {
  useGameName,
  useJoinRoom,
  useOpenFriends,
  usePresenceSnapshot,
} from "./useFriendsViewModel";

/** How long a toast stays up. */
export const TOAST_MS = 7_000;
/** At most this many toasts on screen; older ones go first. */
const MAX_TOASTS = 3;
/**
 * A message this browser never showed still pops its chat open when it is at most this old at page load; older
 * unread ones wait in the conversation for the player to open it.
 */
export const INCOMING_GRACE_MS = 15 * 60_000;
/** The windows a pop-up chat must not cover: a toast asks instead. */
const PLAYING_KINDS: ReadonlySet<WindowKind> = new Set([
  "fusegame",
  "roomgame",
  "retro",
]);

type Toast = { id: number; event: PresenceEvent; owner: string };

/** The toast's line, with the game named as the desktop knows it. */
export function toastText(
  event: PresenceEvent,
  gameName: (gameId: string) => string,
): string {
  switch (event.type) {
    case "signed-in":
      return `${event.buddy.name} has just signed in.`;
    case "playing":
      return `${event.buddy.name} is playing ${gameName(event.buddy.room?.gameId ?? "")}.`;
    case "invite":
      return `${event.invite.from.name} invited you to ${gameName(event.invite.gameId)} (room ${event.invite.code}).`;
    case "request":
      return `${event.from.name} wants to be your friend.`;
    case "message":
      return `${event.buddy.name} sent you an instant message.`;
  }
}

/** The room a toast can join, when it names one. */
function toastRoom(
  event: PresenceEvent,
): { gameId: string; code: string } | undefined {
  if (event.type === "playing" && event.buddy.room) return event.buddy.room;
  if (event.type === "invite")
    return { gameId: event.invite.gameId, code: event.invite.code };
  return undefined;
}

/**
 * The tray icon beside the clock and the "uh-oh" toasts above it: a buddy signing in, starting a game, an invite,
 * a friend request. The toasts come from diffing snapshots, so the live and the demo service announce alike.
 */
export function FriendsTray() {
  const presence = useContext(PresenceServiceContext);
  const deps = useContext(FriendsDepsContext);
  const snapshot = usePresenceSnapshot(presence);
  const gameName = useGameName();
  const openFriends = useOpenFriends();
  const joinRoom = useJoinRoom();

  const read = useContext(MessengerReadContext);
  const { state } = useAppState();
  const commands = useWindowCommands();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const previous = useRef<PresenceSnapshot>(snapshot);
  const nextId = useRef(0);
  const mountedAt = useRef(deps.now());
  /** The newest message per buddy this page already acted on, so one message opens its chat once. */
  const announced = useRef(new Map<string, number>());
  const owner =
    snapshot.mode === "demo" ? "demo" : (snapshot.me?.publicId ?? "signed-out");
  const windows = useRef(state.windows);
  windows.current = state.windows;
  useEffect(() => {
    const events =
      previous.current.me?.publicId === snapshot.me?.publicId
        ? presenceEvents(previous.current, snapshot)
        : [];
    previous.current = snapshot;
    const me = snapshot.me?.publicId;
    const contacts = new Set(
      snapshot.buddies.map((buddy) => `${me}:${buddy.publicId}`),
    );
    for (const key of announced.current.keys())
      if (!contacts.has(key)) announced.current.delete(key);
    if (
      me &&
      snapshot.mode === "live" &&
      snapshot.account.kind === "signed-in"
    ) {
      for (const buddy of snapshot.buddies) {
        const key = `${me}:${buddy.publicId}`;
        const last = buddy.lastMessage;
        if (!last || last.from !== buddy.publicId) continue;
        const seen = Math.max(
          read.lastRead(me, buddy.publicId) ??
            mountedAt.current - INCOMING_GRACE_MS,
          announced.current.get(key) ?? -1,
        );
        if (last.at <= seen) continue;
        announced.current.set(key, last.at);
        const open = windows.current;
        // An open chat loads the new message itself (the buddy's marker changed).
        if (
          open.some(
            (w) =>
              w.kind === "im" &&
              !w.minimized &&
              w.accountId === me &&
              w.buddyId === buddy.publicId,
          )
        )
          continue;
        const front = open.filter((window) => !window.minimized).at(-1);
        if (front && !front.minimized && PLAYING_KINDS.has(front.kind))
          events.push({ type: "message", buddy });
        else {
          commands.open({
            kind: "im",
            accountId: me,
            buddyId: buddy.publicId,
            name: buddy.name,
          });
          deps.playAlert();
        }
      }
    }
    if (events.length === 0) return;
    const fresh = events.map((event) => ({
      id: nextId.current++,
      event,
      owner,
    }));
    setToasts((current) => [...current, ...fresh].slice(-MAX_TOASTS));
    deps.playAlert();
  }, [snapshot, deps, read, commands, owner]);
  useEffect(() => {
    if (toasts.length === 0) return undefined;
    const oldest = toasts[0]!;
    return deps.schedule(
      () => setToasts((current) => current.filter((t) => t.id !== oldest.id)),
      TOAST_MS,
    );
  }, [toasts, deps]);
  const dismiss = (id: number) =>
    setToasts((current) => current.filter((t) => t.id !== id));

  const signedIn = snapshot.account.kind === "signed-in";
  const online = snapshot.buddies.filter((b) => b.status !== "offline").length;
  const label = signedIn
    ? `Fuse Messenger: ${online} ${online === 1 ? "buddy" : "buddies"} online`
    : "Fuse Messenger: signed out";
  const visibleToasts = toasts.filter((toast) => toast.owner === owner);
  return (
    <>
      <button
        type="button"
        className="flat flex h-4 items-center gap-0.5 px-0.5"
        style={{ minWidth: 0, boxShadow: "none" }}
        aria-label={label}
        title={label}
        data-testid="friends-tray"
        onClick={openFriends}
      >
        <Win98Icon
          name="messenger"
          className={signedIn ? "" : "opacity-50 grayscale"}
        />
        {signedIn && online > 0 ? (
          <span className="text-[10px] font-bold">{online}</span>
        ) : null}
      </button>
      {visibleToasts.length > 0 ? (
        <div
          className="absolute bottom-full right-1 mb-1 flex w-64 flex-col gap-1"
          role="region"
          aria-label="Fuse Messenger notifications"
        >
          {visibleToasts.map(({ id, event }) => {
            const room = toastRoom(event);
            return (
              <div
                key={id}
                role="status"
                className="window flex items-start gap-1.5 p-1 text-left shadow-md"
                data-testid={`friends-toast-${event.type}`}
              >
                <Win98Icon name="messenger" />
                <button
                  type="button"
                  className="flat min-w-0 flex-1 text-left"
                  style={{ minWidth: 0, boxShadow: "none", padding: 0 }}
                  onClick={() => {
                    dismiss(id);
                    if (
                      event.type === "message" &&
                      snapshot.me &&
                      snapshot.account.kind === "signed-in"
                    )
                      commands.open({
                        kind: "im",
                        accountId: snapshot.me.publicId,
                        buddyId: event.buddy.publicId,
                        name: event.buddy.name,
                      });
                    else openFriends();
                  }}
                >
                  {toastText(event, gameName)}
                </button>
                {room ? (
                  <button
                    type="button"
                    className="h-5 shrink-0 px-1 text-[10px]"
                    style={{ minWidth: 0 }}
                    onClick={() => {
                      dismiss(id);
                      joinRoom(room.gameId, room.code);
                    }}
                  >
                    Join
                  </button>
                ) : null}
                <button
                  type="button"
                  className="h-4 shrink-0 px-1 text-[10px]"
                  style={{ minWidth: 0 }}
                  aria-label="Dismiss notification"
                  onClick={() => dismiss(id)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
