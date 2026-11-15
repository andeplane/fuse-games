import { createContext } from "react";
import { identityToken } from "fuse-ui/browser-account";
import {
  createMessengerClient,
  type MessengerClient,
} from "fuse-ui/messenger-client";
import { apiUrlFor } from "./realPresenceService";

export interface MessengerChat {
  client: MessengerClient;
  messageId(): string;
}

export const MessengerChatContext = createContext<MessengerChat>({
  client: createMessengerClient({
    fetch: (...args) => fetch(...args),
    token: identityToken,
    apiUrl: (path) =>
      apiUrlFor(import.meta.env.VITE_API_ORIGIN, location.origin)(path),
  }),
  messageId: () => crypto.randomUUID().replaceAll("-", ""),
});
