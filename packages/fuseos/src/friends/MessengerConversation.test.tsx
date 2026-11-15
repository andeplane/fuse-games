import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FriendConversation } from "fuse-platform/messages-api";
import {
  createManualTimers,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { DEFAULT_STATE } from "../state/appState";
import {
  createDemoPresenceService,
  DEMO_BUDDIES,
  DEMO_ME,
} from "./demoPresenceService";
import { MessengerChatContext } from "./MessengerChatContext";
import { MessengerGameContext } from "./MessengerGameContext";

describe("MSN Messenger conversation", () => {
  it("opens a real contact conversation, sends plain text, invites through the game bridge and ignores an older poll", async () => {
    const timers = createManualTimers();
    const demo = createDemoPresenceService({
      schedule: timers.schedule,
      signedIn: true,
    });
    const snapshot = { ...demo.snapshot(), mode: "live" as const };
    const buddy = DEMO_BUDDIES[1]!;
    let finishLoad: ((value: FriendConversation) => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<FriendConversation>((resolve) => {
          finishLoad = resolve;
        }),
    );
    const send = vi.fn(async () => ({
      messages: [
        {
          id: "1".repeat(32),
          from: DEMO_ME.publicId,
          text: "Hi <b>friend</b>",
          at: 1,
        },
      ],
    }));
    const invite = vi.fn(async () => undefined);
    renderWithProviders(
      <MessengerGameContext.Provider
        value={{ currentGame: { gameId: "fuseball", code: "AB42" }, invite }}
      >
        <MessengerChatContext.Provider
          value={{ client: { load, send }, messageId: () => "1".repeat(32) }}
        >
          <Desktop />
        </MessengerChatContext.Provider>
      </MessengerGameContext.Provider>,
      {
        initialState: {
          ...DEFAULT_STATE,
          windows: [
            {
              kind: "friends",
              id: "friends",
              minimized: false,
              maximized: false,
            },
          ],
        },
        presence: { ...demo, snapshot: () => snapshot },
        friendsDeps: { schedule: timers.schedule },
      },
    );
    const user = userEvent.setup();
    const messenger = await screen.findByRole("dialog", {
      name: "MSN Messenger",
    });
    await user.click(
      within(messenger).getByRole("button", {
        name: `Chat with ${buddy.name}`,
      }),
    );
    const conversation = within(messenger).getByRole("region", {
      name: `Conversation with ${buddy.name}`,
    });
    expect(load).toHaveBeenCalledWith(buddy.publicId, DEMO_ME.publicId);
    await user.type(
      within(conversation).getByLabelText(`Message to ${buddy.name}`),
      "Hi <b>friend</b>",
    );
    await user.click(
      within(conversation).getByRole("button", { name: "Send" }),
    );
    expect(send).toHaveBeenCalledWith(
      buddy.publicId,
      "1".repeat(32),
      "Hi <b>friend</b>",
      DEMO_ME.publicId,
    );
    expect(
      within(conversation).getByText("Hi <b>friend</b>"),
    ).toBeInTheDocument();
    await act(async () => finishLoad!({ messages: [] }));
    expect(
      within(conversation).getByText("Hi <b>friend</b>"),
    ).toBeInTheDocument();
    await user.click(
      within(conversation).getByRole("button", { name: "Invite to game" }),
    );
    expect(invite).toHaveBeenCalledWith(buddy.publicId);
    expect(
      within(conversation).getByText("Game invitation sent."),
    ).toBeInTheDocument();
    await user.click(
      within(conversation).getByRole("button", { name: "Back to contacts" }),
    );
    expect(
      within(messenger).getByTestId(`buddy-${buddy.publicId}`),
    ).toBeInTheDocument();
  });

  it("keeps a failed draft and retries with the same send id", async () => {
    const timers = createManualTimers();
    const demo = createDemoPresenceService({
      schedule: timers.schedule,
      signedIn: true,
    });
    const snapshot = { ...demo.snapshot(), mode: "live" as const };
    const buddy = DEMO_BUDDIES[1]!;
    let attempts = 0;
    const send = vi.fn(async () => {
      if (++attempts === 1) throw new Error("Message not sent. Try again.");
      return { messages: [] };
    });
    const messageId = vi.fn(() => "2".repeat(32));
    renderWithProviders(
      <MessengerChatContext.Provider
        value={{
          client: { load: async () => ({ messages: [] }), send },
          messageId,
        }}
      >
        <Desktop />
      </MessengerChatContext.Provider>,
      {
        initialState: {
          ...DEFAULT_STATE,
          windows: [
            {
              kind: "friends",
              id: "friends",
              minimized: false,
              maximized: false,
            },
          ],
        },
        presence: { ...demo, snapshot: () => snapshot },
        friendsDeps: { schedule: timers.schedule },
      },
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: `Chat with ${buddy.name}` }),
    );
    const input = screen.getByLabelText(`Message to ${buddy.name}`);
    await user.type(input, "hello{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Message not sent",
    );
    expect(input).toHaveValue("hello");
    await user.click(
      within(
        screen.getByRole("region", { name: `Conversation with ${buddy.name}` }),
      ).getByRole("button", { name: "Send" }),
    );
    expect(messageId).toHaveBeenCalledTimes(1);
    expect(send.mock.calls).toHaveLength(2);
    expect(input).toHaveValue("");
  });
});
