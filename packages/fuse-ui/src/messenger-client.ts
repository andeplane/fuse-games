import {
  parseConversation,
  type FriendConversation,
} from "fuse-platform/messages-api";
import { validPublicId } from "fuse-platform/friends-api";

export interface MessengerClient {
  load(publicId: string, myPublicId: string): Promise<FriendConversation>;
  send(
    publicId: string,
    id: string,
    text: string,
    myPublicId: string,
  ): Promise<FriendConversation>;
}

export interface MessengerClientDependencies {
  fetch: typeof fetch;
  token(): Promise<string | undefined>;
  apiUrl(path: string): string;
}

export function createMessengerClient(
  deps: MessengerClientDependencies,
): MessengerClient {
  const request = async (
    publicId: string,
    myPublicId: string,
    body?: { id: string; text: string },
  ): Promise<FriendConversation> => {
    if (!validPublicId(publicId) || !validPublicId(myPublicId))
      throw new Error("Choose a friend first.");
    const token = await deps.token();
    if (!token) throw new Error("Sign in to Fuse world to chat.");
    let response: Response;
    try {
      response = await deps.fetch(
        deps.apiUrl(`/api/friends/${publicId}/messages`),
        {
          method: body ? "POST" : "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Fuse-Account": myPublicId,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          cache: "no-store",
        },
      );
    } catch {
      throw new Error("Could not reach your friend. Try again.");
    }
    if (!response.ok) {
      const message =
        response.status === 403
          ? "Only accepted friends can chat. Refresh your contacts."
          : response.status === 401
            ? "Sign in to Fuse world to chat."
            : response.status === 429
              ? "Too many messages. Wait a little, then try again."
              : "Could not load this conversation. Try again.";
      throw new Error(message);
    }
    return parseConversation(await response.json());
  };
  return {
    load: (publicId, myPublicId) => request(publicId, myPublicId),
    send: (publicId, id, text, myPublicId) =>
      request(publicId, myPublicId, { id, text }),
  };
}
