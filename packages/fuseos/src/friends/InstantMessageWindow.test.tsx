import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  FriendConversation,
  FriendMessage,
} from "fuse-platform/messages-api";
import {
  createManualTimers,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import type { AppState, WindowState } from "../state/appState";
import { DEFAULT_STATE, isWindowState } from "../state/appState";
import {
  createDemoPresenceService,
  DEMO_BUDDIES,
  DEMO_ME,
} from "./demoPresenceService";
import { MessengerChatContext } from "./MessengerChatContext";
import type { MessengerClient } from "fuse-ui/messenger-client";
import { MessengerGameContext } from "./MessengerGameContext";
import { createMessengerReadStore } from "./messengerRead";
import type { Buddy, PresenceService } from "./presenceService";
import { SnapshotStore } from "./presenceService";
import { LIVELY_POLL_MS } from "./useConversation";

const BUDDY = DEMO_BUDDIES[1]!; // sk8rgrl99, online
const NOW = Date.UTC(1998, 5, 25, 12, 34);

const friendsWindow: WindowState = {
  kind: "friends",
  id: "friends",
  minimized: false,
  maximized: false,
};
const imWindow = (buddy: Buddy = BUDDY): WindowState => ({
  kind: "im",
  id: "w9",
  minimized: false,
  maximized: false,
  buddyId: buddy.publicId,
  accountId: DEMO_ME.publicId,
  name: buddy.name,
});

const message = (
  id: string,
  from: string,
  text: string,
  at = NOW,
): FriendMessage => ({ id: id.repeat(32), from, text, at });

/** A live (not demo) signed-in snapshot the test can change, like the real service between polls. */
function livePresence() {
  const timers = createManualTimers();
  const demo = createDemoPresenceService({
    schedule: timers.schedule,
    signedIn: true,
  });
  const store = new SnapshotStore({
    ...demo.snapshot(),
    mode: "live",
  });
  const presence: PresenceService = {
    ...demo,
    snapshot: () => store.get(),
    subscribe: (listener) => store.subscribe(listener),
  };
  const setBuddy = (publicId: string, patch: Partial<Buddy>) =>
    act(() =>
      store.set({
        ...store.get(),
        buddies: store
          .get()
          .buddies.map((buddy) =>
            buddy.publicId === publicId ? { ...buddy, ...patch } : buddy,
          ),
      }),
    );
  return { presence, setBuddy, timers, snapshots: store };
}

function renderMessenger(options: {
  windows: WindowState[];
  client: MessengerClient;
  messageId?: () => string;
  invite?: (publicId: string, me: string) => Promise<void>;
  read?: ReturnType<typeof createMessengerReadStore>;
}) {
  const live = livePresence();
  const timers = createManualTimers();
  const initialState: AppState = { ...DEFAULT_STATE, windows: options.windows };
  const result = renderWithProviders(
    <MessengerGameContext.Provider
      value={{
        currentGame: { gameId: "fuseball", code: "AB42AA" },
        invite: options.invite ?? (async () => undefined),
      }}
    >
      <MessengerChatContext.Provider
        value={{
          client: options.client,
          messageId: options.messageId ?? (() => "1".repeat(32)),
        }}
      >
        <Desktop />
      </MessengerChatContext.Provider>
    </MessengerGameContext.Provider>,
    {
      initialState,
      presence: live.presence,
      friendsDeps: { schedule: timers.schedule, now: () => NOW },
      messengerRead: options.read ?? createMessengerReadStore(undefined),
    },
  );
  return { ...result, ...live, timers, user: userEvent.setup() };
}

describe("Instant Message window", () => {
  for (const change of [
    "sign-out",
    "account-switch",
    "unfriend",
    "demo",
  ] as const) {
    for (const pending of ["load", "send"] as const) {
      it(`closes private content on ${change} and ignores a late ${pending} result`, async () => {
        let finish: ((value: FriendConversation) => void) | undefined;
        const deferred = () =>
          new Promise<FriendConversation>((resolve) => {
            finish = resolve;
          });
        const load = vi.fn(
          pending === "load" ? deferred : async () => ({ messages: [] }),
        );
        const send = vi.fn(deferred);
        const { user, snapshots, timers } = renderMessenger({
          windows: [friendsWindow, imWindow()],
          client: { load, send },
        });
        const im = await screen.findByRole("dialog", {
          name: `${BUDDY.name} - Instant Message`,
        });
        const input = within(im).getByLabelText(`Message to ${BUDDY.name}`);
        await user.type(
          input,
          pending === "send"
            ? "Old account draft{Enter}"
            : "Private unsent draft",
        );
        expect(load).toHaveBeenCalledWith(BUDDY.publicId, DEMO_ME.publicId);
        if (pending === "send") expect(send).toHaveBeenCalledTimes(1);
        await act(async () => {
          if (change === "sign-out")
            snapshots.patch({
              account: { kind: "signed-out" },
              me: undefined,
              buddies: [],
            });
          else if (change === "account-switch")
            snapshots.patch({ me: { ...DEMO_ME, publicId: "f".repeat(20) } });
          else if (change === "unfriend") snapshots.patch({ buddies: [] });
          else snapshots.patch({ mode: "demo" });
        });
        expect(
          screen.queryByRole("dialog", {
            name: `${BUDDY.name} - Instant Message`,
          }),
        ).toBeNull();
        expect(
          screen.getByRole("dialog", { name: "Fuse Messenger" }),
        ).toBeInTheDocument();
        await act(async () => {
          finish!({
            messages: [message("9", BUDDY.publicId, "Private late response")],
          });
          timers.fire(10_000);
        });
        expect(screen.queryByText("Private late response")).toBeNull();
        expect(
          screen.queryByDisplayValue(/Private unsent draft|Old account draft/),
        ).toBeNull();
        expect(load).toHaveBeenCalledTimes(1);
      });
    }
  }

  it("keeps a minimized draft and prevents a pending send from erasing a newer draft", async () => {
    let finish: ((value: FriendConversation) => void) | undefined;
    const send = vi.fn(
      () =>
        new Promise<FriendConversation>((resolve) => {
          finish = resolve;
        }),
    );
    const { user } = renderMessenger({
      windows: [friendsWindow, imWindow()],
      client: { load: async () => ({ messages: [] }), send },
    });
    const title = `${BUDDY.name} - Instant Message`;
    const im = await screen.findByRole("dialog", { name: title });
    const input = within(im).getByLabelText(`Message to ${BUDDY.name}`);
    await user.type(input, "Unsent draft");
    await user.click(within(im).getByRole("button", { name: "Minimize" }));
    expect(im).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: title }));
    expect(im).toBeVisible();
    expect(input).toHaveValue("Unsent draft");
    await user.click(within(im).getByRole("button", { name: "Send" }));
    expect(input).toBeDisabled();
    await user.type(input, "Cannot overwrite pending message");
    expect(input).toHaveValue("Unsent draft");
    await act(async () =>
      finish!({ messages: [message("1", DEMO_ME.publicId, "Unsent draft")] }),
    );
    expect(input).toBeEnabled();
    expect(input).toHaveValue("");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not mark a newly received message as read while minimized", async () => {
    let messages: FriendMessage[] = [];
    const read = createMessengerReadStore(undefined);
    const { user, timers } = renderMessenger({
      windows: [friendsWindow, imWindow()],
      read,
      client: { load: async () => ({ messages }), send: vi.fn() },
    });
    const title = `${BUDDY.name} - Instant Message`;
    const im = await screen.findByRole("dialog", { name: title });
    await user.click(within(im).getByRole("button", { name: "Minimize" }));
    messages = [message("7", BUDDY.publicId, "Hidden incoming", NOW)];
    await act(async () => timers.fire(10_000));
    expect(read.lastRead(DEMO_ME.publicId, BUDDY.publicId)).toBeUndefined();
    await user.click(screen.getByRole("button", { name: title }));
    expect(await within(im).findByText("Hidden incoming")).toBeInTheDocument();
    expect(read.lastRead(DEMO_ME.publicId, BUDDY.publicId)).toBe(NOW);
  });
  it("opens from a double-click on a buddy, sends plain text, invites and ignores an older poll", async () => {
    let finishLoad: ((value: FriendConversation) => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<FriendConversation>((resolve) => {
          finishLoad = resolve;
        }),
    );
    const send = vi.fn(async () => ({
      messages: [message("1", DEMO_ME.publicId, "Hi <b>friend</b>")],
    }));
    const invite = vi.fn(async () => undefined);
    const { user } = renderMessenger({
      windows: [friendsWindow],
      client: { load, send },
      invite,
    });
    const messenger = await screen.findByRole("dialog", {
      name: "Fuse Messenger",
    });
    await user.dblClick(
      within(messenger).getByTestId(`buddy-${BUDDY.publicId}`),
    );
    const im = await screen.findByRole("dialog", {
      name: `${BUDDY.name} - Instant Message`,
    });
    expect(within(im).getByTestId("im-to")).toHaveTextContent(
      `To: ${BUDDY.name} <${BUDDY.publicId}> (Online)`,
    );
    expect(load).toHaveBeenCalledWith(BUDDY.publicId, DEMO_ME.publicId);
    const input = within(im).getByLabelText(`Message to ${BUDDY.name}`);
    expect(input).toHaveFocus();
    await user.type(input, "Hi <b>friend</b>{Enter}");
    expect(send).toHaveBeenCalledWith(
      BUDDY.publicId,
      "1".repeat(32),
      "Hi <b>friend</b>",
      DEMO_ME.publicId,
    );
    // Plain text, under "<me> says:".
    expect(within(im).getByText("Hi <b>friend</b>")).toBeInTheDocument();
    expect(within(im).getByText(`${DEMO_ME.name} says:`)).toBeInTheDocument();
    expect(input).toHaveValue("");
    // The first load answers after the send with an older view; the newer one stays.
    await act(async () => finishLoad!({ messages: [] }));
    expect(within(im).getByText("Hi <b>friend</b>")).toBeInTheDocument();

    await user.click(within(im).getByRole("button", { name: "Invite" }));
    expect(invite).toHaveBeenCalledWith(BUDDY.publicId, DEMO_ME.publicId);
    expect(within(im).getByText("Game invitation sent.")).toBeInTheDocument();

    // Double-clicking the same buddy again brings that window forward instead of a second one.
    await user.dblClick(
      within(messenger).getByTestId(`buddy-${BUDDY.publicId}`),
    );
    expect(
      screen.getAllByRole("dialog", {
        name: `${BUDDY.name} - Instant Message`,
      }),
    ).toHaveLength(1);
  });

  it("shows the friend's reply on the next poll, polls quickly while the chat is lively, and says when it arrived", async () => {
    let messages: FriendMessage[] = [];
    const load = vi.fn(async () => ({ messages }));
    const send = vi.fn(async () => {
      messages = [message("1", DEMO_ME.publicId, "u there?", NOW - 1_000)];
      return { messages };
    });
    const { user, timers } = renderMessenger({
      windows: [imWindow()],
      client: { load, send },
    });
    const im = await screen.findByRole("dialog", {
      name: `${BUDDY.name} - Instant Message`,
    });
    await user.type(
      within(im).getByLabelText(`Message to ${BUDDY.name}`),
      "u there?",
    );
    await user.click(within(im).getByRole("button", { name: "Send" }));
    messages = [
      ...messages,
      message("2", BUDDY.publicId, "yes! wanna play?", NOW),
    ];
    // Lively: the next check is due in a few seconds, not the quiet interval.
    await act(async () => timers.fire(LIVELY_POLL_MS));
    expect(await within(im).findByText("yes! wanna play?")).toBeInTheDocument();
    expect(within(im).getByText(`${BUDDY.name} says:`)).toBeInTheDocument();
    expect(within(im).getByTestId("im-status")).toHaveTextContent(
      /^Last message received at .+ on .+\.$/,
    );
  });

  it("keeps a failed draft and retries with the same send id", async () => {
    let attempts = 0;
    const send = vi.fn(async () => {
      if (++attempts === 1) throw new Error("Message not sent. Try again.");
      return { messages: [] };
    });
    const messageId = vi.fn(() => "2".repeat(32));
    const load = vi.fn(async () => ({ messages: [] }));
    const { user } = renderMessenger({
      windows: [imWindow()],
      client: { load, send },
      messageId,
    });
    const input = await screen.findByLabelText(`Message to ${BUDDY.name}`);
    await user.type(input, "hello{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Message not sent",
    );
    expect(input).toHaveValue("hello");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(messageId).toHaveBeenCalledTimes(1);
    expect(send.mock.calls).toHaveLength(2);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    expect(input).toHaveValue("");
  });

  it("pops a chat open when a friend writes, once, and asks with a toast while a game is in front", async () => {
    const load = vi.fn(async () => ({
      messages: [message("3", BUDDY.publicId, "hey", NOW)],
    }));
    const send = vi.fn();
    const read = createMessengerReadStore(undefined);
    const { setBuddy, user, friendsDeps } = renderMessenger({
      windows: [friendsWindow],
      client: { load, send },
      read,
    });
    await screen.findByRole("dialog", { name: "Fuse Messenger" });
    // A message from me does not pop anything up.
    setBuddy(BUDDY.publicId, {
      lastMessage: { from: DEMO_ME.publicId, at: NOW - 5_000 },
    });
    expect(
      screen.queryByRole("dialog", { name: `${BUDDY.name} - Instant Message` }),
    ).toBeNull();
    setBuddy(BUDDY.publicId, {
      lastMessage: { from: BUDDY.publicId, at: NOW },
    });
    const im = await screen.findByRole("dialog", {
      name: `${BUDDY.name} - Instant Message`,
    });
    expect(await within(im).findByText("hey")).toBeInTheDocument();
    expect(friendsDeps.playAlert).toHaveBeenCalled();
    expect(read.lastRead(DEMO_ME.publicId, BUDDY.publicId)).toBe(NOW);
    // Closed after reading, the same message does not open it again.
    await user.click(within(im).getByRole("button", { name: "Close" }));
    setBuddy(BUDDY.publicId, { statusLine: "poll" });
    expect(
      screen.queryByRole("dialog", { name: `${BUDDY.name} - Instant Message` }),
    ).toBeNull();

    // With a game in front, a toast asks instead of covering it.
    const other = DEMO_BUDDIES[2]!;
    await user.dblClick(screen.getByRole("button", { name: "Fuseball" }));
    await screen.findByRole("dialog", { name: "Fuseball" });
    setBuddy(other.publicId, {
      lastMessage: { from: other.publicId, at: NOW + 1 },
    });
    const toast = await screen.findByTestId("friends-toast-message");
    expect(toast).toHaveTextContent(
      `${other.name} sent you an instant message.`,
    );
    expect(
      screen.queryByRole("dialog", { name: `${other.name} - Instant Message` }),
    ).toBeNull();
    await user.click(
      within(toast).getByRole("button", {
        name: `${other.name} sent you an instant message.`,
      }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: `${other.name} - Instant Message`,
      }),
    ).toBeInTheDocument();
  });

  it("stores only a well-formed window", () => {
    const base = {
      id: "w1",
      minimized: false,
      maximized: false,
      kind: "im",
      accountId: DEMO_ME.publicId,
    };
    expect(
      isWindowState({ ...base, buddyId: BUDDY.publicId, name: BUDDY.name }),
    ).toBe(true);
    expect(isWindowState({ ...base, buddyId: "uid-1", name: "x" })).toBe(false);
    expect(isWindowState({ ...base, buddyId: BUDDY.publicId })).toBe(false);
  });
});
