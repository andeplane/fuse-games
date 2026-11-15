/** Private, plain-text messages between accepted friends. No account ids or room credentials cross this boundary. */
export interface FriendMessage {
  id: string;
  from: string;
  text: string;
  at: number;
}

export interface FriendConversation {
  messages: FriendMessage[];
}

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_CONVERSATION_MESSAGES = 80;
/** Recent history is available for seven days; this is a messenger, not an archive. */
export const MESSAGE_HISTORY_MS = 7 * 24 * 60 * 60_000;
export const MESSAGES_POLL_MS = 10_000;

export const validMessageId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{32}$/.test(value);

export function validFriendMessage(value: unknown): value is FriendMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const message = value as Record<string, unknown>;
  return (
    validMessageId(message.id) &&
    typeof message.from === "string" &&
    /^[a-f0-9]{20}$/.test(message.from) &&
    typeof message.text === "string" &&
    message.text.length > 0 &&
    message.text.length <= MAX_MESSAGE_LENGTH &&
    Number.isSafeInteger(message.at) &&
    Number(message.at) >= 0
  );
}

export function parseConversation(value: unknown): FriendConversation {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Conversation unavailable. Try again.");
  const messages = (value as Record<string, unknown>).messages;
  if (
    !Array.isArray(messages) ||
    messages.length > MAX_CONVERSATION_MESSAGES ||
    !messages.every(validFriendMessage)
  )
    throw new Error("Conversation unavailable. Try again.");
  return { messages };
}
