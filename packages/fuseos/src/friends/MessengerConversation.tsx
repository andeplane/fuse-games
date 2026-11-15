import { useContext, useEffect, useRef, useState } from "react";
import {
  MAX_MESSAGE_LENGTH,
  MESSAGES_POLL_MS,
  type FriendMessage,
} from "fuse-platform/messages-api";
import { Win98Icon } from "../ui/icons";
import { FriendsDepsContext } from "./friendsDepsContext";
import { MessengerChatContext } from "./MessengerChatContext";
import { MessengerGameContext } from "./MessengerGameContext";
import type { Buddy, PlayerCard } from "./presenceService";

export function MessengerConversation({
  buddy,
  me,
  back,
}: {
  buddy: Buddy;
  me: PlayerCard;
  back(): void;
}) {
  const { client, messageId } = useContext(MessengerChatContext);
  const game = useContext(MessengerGameContext);
  const { schedule } = useContext(FriendsDepsContext);
  const [messages, setMessages] = useState<FriendMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [retry, setRetry] = useState(0);
  const pending = useRef<{ id: string; text: string }>();
  const revision = useRef(0);
  const alive = useRef(true);
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    let cancel: (() => void) | undefined;
    const poll = async () => {
      const version = revision.current;
      try {
        const conversation = await client.load(buddy.publicId, me.publicId);
        if (current && version === revision.current) {
          setMessages(conversation.messages);
          setError(undefined);
        }
      } catch (failure) {
        if (current && version === revision.current)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not load messages. Try again.",
          );
      } finally {
        if (current) {
          setLoading(false);
          cancel = schedule(() => {
            void poll();
          }, MESSAGES_POLL_MS);
        }
      }
    };
    void poll();
    return () => {
      current = false;
      cancel?.();
    };
  }, [client, buddy.publicId, me.publicId, schedule, retry]);
  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);
  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const message =
      pending.current?.text === text
        ? pending.current
        : { id: messageId(), text };
    pending.current = message;
    revision.current++;
    setSending(true);
    setError(undefined);
    try {
      const conversation = await client.send(
        buddy.publicId,
        message.id,
        message.text,
        me.publicId,
      );
      if (!alive.current) return;
      revision.current++;
      setMessages(conversation.messages);
      setDraft("");
      pending.current = undefined;
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Message not sent. Try again.",
        );
    } finally {
      if (alive.current) setSending(false);
    }
  };
  const invite = async () => {
    setInviting(true);
    setNotice(undefined);
    try {
      await game.invite(buddy.publicId);
      if (alive.current) setNotice("Game invitation sent.");
    } catch (failure) {
      if (alive.current)
        setNotice(
          failure instanceof Error
            ? failure.message
            : "Invitation not sent. Try again.",
        );
    } finally {
      if (alive.current) setInviting(false);
    }
  };
  return (
    <section
      className="msn-conversation"
      aria-label={`Conversation with ${buddy.name}`}
    >
      <div className="msn-toolbar">
        <button type="button" onClick={back}>
          Back to contacts
        </button>
        <button
          type="button"
          disabled={!game.currentGame || inviting}
          onClick={() => {
            void invite();
          }}
          title={
            game.currentGame
              ? `Invite to ${game.currentGame.gameId}`
              : "Join a game room first"
          }
        >
          <Win98Icon name="messenger" size={16} /> Invite to game
        </button>
      </div>
      <p className="msn-to">
        To: <b>{buddy.name}</b> ({buddy.status})
      </p>
      <div
        className="msn-transcript sunken-panel"
        ref={transcript}
        role="log"
        aria-label="Messages"
        aria-live="polite"
      >
        {loading ? (
          <p role="status">Loading conversation...</p>
        ) : messages.length === 0 ? (
          <p className="msn-conversation-hint">Say hello to {buddy.name}.</p>
        ) : null}
        {messages.map((message) => (
          <div className="msn-message" key={`${message.from}:${message.id}`}>
            <p className="msn-message-author">
              {message.from === me.publicId ? me.name : buddy.name} says:
            </p>
            <p className="msn-message-text">{message.text}</p>
          </div>
        ))}
      </div>
      {error ? (
        <div className="msn-chat-error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="msn-chat-notice" role="status">
          {notice}
        </p>
      ) : null}
      <form
        className="msn-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="msn-compose-label" htmlFor="msn-message">
          Message to {buddy.name}
        </label>
        <textarea
          id="msn-message"
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" disabled={sending || !draft.trim()}>
          {sending ? "Sending..." : "Send"}
        </button>
      </form>
      <p className="msn-conversation-hint">
        Enter to send · Shift+Enter for a new line. Shows up to 80 messages from
        the last 7 days.
      </p>
    </section>
  );
}
