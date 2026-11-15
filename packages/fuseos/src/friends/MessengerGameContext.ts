import { createContext } from "react";

/** The desktop forwards the invite to the game that owns the room; room credentials stay inside that game. */
export interface MessengerGame {
  currentGame?: { gameId: string; code: string };
  invite(publicId: string, expectedAccount: string): Promise<void>;
}

export const MessengerGameContext = createContext<MessengerGame>({
  invite: async () => {
    throw new Error("Open a game and join a room before inviting a friend.");
  },
});
