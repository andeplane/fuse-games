import { useContext, useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH } from "fuse-platform/messages-api";

import type { MenuDef } from "../windows/MenuBar";
import { MenuBar } from "../windows/MenuBar";
import { useWindowCommands } from "../windows/useWindowCommands";

import { ToolbarIcon } from "./messengerArt";
import "./messenger.css";
import { STATUS_LABEL } from "./presenceService";
import { useConversation } from "./useConversation";
import { useFriendsViewModel } from "./useFriendsViewModel";
import { MessengerReadContext } from "./messengerRead";

export type InstantMessageWindowProps = {
  windowId: string;
  buddyId: string;
  /** The name the window opened with, shown until the buddy list says otherwise. */
  name: string;
};

/** "12:04" and "15.11.2026", in the player's locale. */
function when(at: number): { time: string; date: string } {
  const date = new Date(at);
  return {
    time: date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
    date: date.toLocaleDateString(),
  };
}

/** One buddy's Instant Message window: the To: line, "X says:" transcript, compose box and Send, like 1999. */
export function InstantMessageWindow({
  windowId,
  buddyId,
  name,
}: InstantMessageWindowProps) {
  const vm = useFriendsViewModel();
  const commands = useWindowCommands();
  const read = useContext(MessengerReadContext);
  const { snapshot } = vm;
  const buddy = snapshot.buddies.find((entry) => entry.publicId === buddyId);
  const me = snapshot.me;
  const signedIn = snapshot.account.kind === "signed-in";
  const demo = snapshot.mode === "demo";
  const live = signedIn && !demo && me !== undefined && buddy !== undefined;
  const conversation = useConversation(
    buddyId,
    live ? me : undefined,
    buddy?.lastMessage?.at,
  );
  const [draft, setDraft] = useState("");
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const shownName = buddy?.name ?? name;
  const { messages } = conversation;

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);
  // What this window has shown counts as read: the incoming-message pop-up will not open it again for these.
  const newestAt = messages.at(-1)?.at;
  useEffect(() => {
    if (me && newestAt !== undefined)
      read.markRead(me.publicId, buddyId, newestAt);
  }, [read, me, buddyId, newestAt]);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  const lastReceived = [...messages]
    .reverse()
    .find((message) => message.from === buddyId);
  const status = buddy?.status ?? "offline";
  const statusText = !signedIn
    ? "Sign in to Fuse Messenger to chat."
    : demo
      ? "Demo buddies cannot receive messages."
      : !buddy
        ? `${shownName} is no longer on your buddy list.`
        : lastReceived
          ? (() => {
              const at = when(lastReceived.at);
              return `Last message received at ${at.time} on ${at.date}.`;
            })()
          : status === "offline"
            ? `${shownName} is offline; they see your messages when they sign in (kept 7 days).`
            : messages.length === 0 && !conversation.loading
              ? `Say hello to ${shownName}.`
              : "";

  const submit = async () => {
    if (!draft.trim()) return;
    if (await conversation.send(draft)) setDraft("");
    input.current?.focus({ preventScroll: true });
  };
  const playing = buddy?.status === "playing" ? buddy.room : undefined;

  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        {
          label: "Invite to game",
          disabled: !live || !conversation.currentGame || conversation.inviting,
          onSelect: () => void conversation.invite(),
        },
        {
          label: "Join game",
          disabled: !playing,
          onSelect: () =>
            playing ? vm.joinRoom(playing.gameId, playing.code) : undefined,
        },
        { separator: true },
        { label: "Close", onSelect: () => commands.close(windowId) },
      ],
    },
    {
      label: "Help",
      items: [
        {
          label: "About Instant Messages",
          onSelect: () =>
            commands.showInfo(
              "Instant Messages",
              "Type below and press Enter or Send. Messages are plain text between accepted friends, kept for 7 days (the last 80). A friend who is offline sees them next time they open Fuse Messenger.",
            ),
        },
      ],
    },
  ];

  return (
    <div
      className="msn-root msn-im flex h-full min-h-0 flex-col"
      data-testid="im-window"
      aria-label={`Conversation with ${shownName}`}
    >
      <MenuBar menus={menus} />
      <div className="msn-bigbar" role="toolbar" aria-label="Conversation">
        <button
          type="button"
          className="flat msn-bigbutton"
          disabled={!live || !conversation.currentGame || conversation.inviting}
          title={
            conversation.currentGame
              ? `Invite ${shownName} to your game room`
              : "Join a game room first, then invite"
          }
          onClick={() => void conversation.invite()}
        >
          <ToolbarIcon art="invite" />
          <span>Invite</span>
        </button>
        <button
          type="button"
          className="flat msn-bigbutton"
          disabled={!playing}
          title={
            playing
              ? `Join ${shownName} in ${vm.gameName(playing.gameId)}`
              : `${shownName} is not in a game`
          }
          onClick={() =>
            playing ? vm.joinRoom(playing.gameId, playing.code) : undefined
          }
        >
          <ToolbarIcon art="join" />
          <span>Join</span>
        </button>
      </div>
      <p className="msn-to" data-testid="im-to">
        To: <b>{shownName}</b>{" "}
        <span className="msn-to-id">&lt;{buddyId}&gt;</span>
        <span className="msn-to-status"> ({STATUS_LABEL[status]})</span>
      </p>
      <div
        className="msn-transcript"
        ref={transcript}
        role="log"
        aria-label="Messages"
        aria-live="polite"
      >
        {live && conversation.loading ? (
          <p role="status" className="msn-transcript-note">
            Loading conversation...
          </p>
        ) : null}
        {messages.map((message) => {
          const mine = message.from === me?.publicId;
          return (
            <div className="msn-message" key={`${message.from}:${message.id}`}>
              <p
                className={`msn-message-author${mine ? " msn-message-mine" : ""}`}
              >
                {mine ? me?.name : shownName} says:
              </p>
              <p className="msn-message-text">{message.text}</p>
            </div>
          );
        })}
      </div>
      {conversation.sendError || conversation.error ? (
        <div className="msn-chat-error" role="alert">
          {conversation.sendError ?? conversation.error}{" "}
          <button
            type="button"
            disabled={conversation.sending}
            onClick={() => {
              if (conversation.sendError) void submit();
              else conversation.retry();
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      {conversation.notice ? (
        <p className="msn-chat-notice" role="status">
          {conversation.notice}
        </p>
      ) : null}
      <form
        className="msn-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={input}
          aria-label={`Message to ${shownName}`}
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={!live}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="submit"
          className="msn-send"
          disabled={!live || conversation.sending || !draft.trim()}
        >
          {conversation.sending ? "Sending" : "Send"}
        </button>
      </form>
      <div className="status-bar">
        <p className="status-bar-field" data-testid="im-status">
          {statusText || " "}
        </p>
      </div>
    </div>
  );
}
