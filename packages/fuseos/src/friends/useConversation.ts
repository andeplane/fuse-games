import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  MESSAGES_POLL_MS,
  type FriendMessage,
} from "fuse-platform/messages-api";

import { FriendsDepsContext } from "./friendsDepsContext";
import { MessengerChatContext } from "./MessengerChatContext";
import { MessengerGameContext } from "./MessengerGameContext";
import type { PlayerCard } from "./presenceService";

/** While a conversation is lively (a message went either way this recently) it is checked this often. */
export const LIVELY_POLL_MS = 3_000;
/** How long a conversation stays lively after its last message. */
export const LIVELY_FOR_MS = 90_000;

export interface Conversation {
  messages: FriendMessage[];
  loading: boolean;
  /** Loading failed; `retry` asks again. */
  error?: string;
  /** The last send failed; `send` with the same draft reuses its id, so a retry never duplicates it. */
  sendError?: string;
  sending: boolean;
  inviting: boolean;
  /** The result of the last invite, said once. */
  notice?: string;
  /** The game room this desktop is in, which `invite` invites to. */
  currentGame?: { gameId: string };
  /** Resolves true once the message is stored. */
  send(text: string): Promise<boolean>;
  invite(): Promise<void>;
  retry(): void;
}

/**
 * One conversation with an accepted friend: loads it, polls it (quickly while messages are flowing, slowly when
 * quiet), sends with retry-safe ids and invites the friend to the game room this desktop is in. A newer
 * `signal` (the time of the friend's last message, from the buddy list's poll) loads at once.
 */
export function useConversation(
  buddyId: string,
  me: PlayerCard | undefined,
  signal?: number,
): Conversation {
  const { client, messageId } = useContext(MessengerChatContext);
  const game = useContext(MessengerGameContext);
  const { schedule, now } = useContext(FriendsDepsContext);
  const [messages, setMessages] = useState<FriendMessage[]>([]);
  const [error, setError] = useState<string>();
  const [sendError, setSendError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [retry, setRetry] = useState(0);
  const pending = useRef<{ id: string; text: string }>();
  const revision = useRef(0);
  const alive = useRef(true);
  const lastActivity = useRef(0);
  const myId = me?.publicId;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  /** Brings the next check forward to the lively interval; set by the polling effect. */
  const hurry = useRef<() => void>(() => undefined);
  const newestSeen = useRef<string>();
  const accept = useCallback(
    (next: FriendMessage[]) => {
      const newest = next.at(-1);
      const key = newest ? `${newest.from}:${newest.id}` : undefined;
      // A message the window had not shown yet makes the chat lively (timed by this page's clock).
      if (key !== undefined && key !== newestSeen.current) {
        if (newestSeen.current !== undefined) lastActivity.current = now();
        newestSeen.current = key;
      }
      setMessages(next);
    },
    [now],
  );
  useEffect(() => {
    if (!myId) return;
    let current = true;
    let cancel: (() => void) | undefined;
    let quiet = false;
    const later = (delay: number) => {
      cancel?.();
      quiet = delay > LIVELY_POLL_MS;
      cancel = schedule(() => {
        cancel = undefined;
        void poll();
      }, delay);
    };
    hurry.current = () => {
      if (current && cancel && quiet) later(LIVELY_POLL_MS);
    };
    const poll = async () => {
      const version = revision.current;
      try {
        const conversation = await client.load(buddyId, myId);
        if (current && version === revision.current) {
          accept(conversation.messages);
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
          const lively = now() - lastActivity.current < LIVELY_FOR_MS;
          later(lively ? LIVELY_POLL_MS : MESSAGES_POLL_MS);
        }
      }
    };
    void poll();
    return () => {
      current = false;
      cancel?.();
      hurry.current = () => undefined;
    };
  }, [client, buddyId, myId, schedule, now, accept, retry, signal]);

  const send = async (raw: string): Promise<boolean> => {
    const text = raw.trim();
    if (!text || sending || !myId) return false;
    const message =
      pending.current?.text === text
        ? pending.current
        : { id: messageId(), text };
    pending.current = message;
    revision.current++;
    setSending(true);
    setError(undefined);
    setSendError(undefined);
    try {
      const conversation = await client.send(
        buddyId,
        message.id,
        message.text,
        myId,
      );
      if (!alive.current) return true;
      revision.current++;
      accept(conversation.messages);
      lastActivity.current = now();
      hurry.current();
      pending.current = undefined;
      return true;
    } catch (failure) {
      if (alive.current)
        setSendError(
          failure instanceof Error
            ? failure.message
            : "Message not sent. Try again.",
        );
      return false;
    } finally {
      if (alive.current) setSending(false);
    }
  };
  const invite = async () => {
    if (!myId) return;
    setInviting(true);
    setNotice(undefined);
    try {
      await game.invite(buddyId, myId);
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
  return {
    messages,
    loading,
    ...(error === undefined ? {} : { error }),
    ...(sendError === undefined ? {} : { sendError }),
    sending,
    inviting,
    ...(notice === undefined ? {} : { notice }),
    ...(game.currentGame ? { currentGame: game.currentGame } : {}),
    send,
    invite,
    retry: () => setRetry((n) => n + 1),
  };
}
