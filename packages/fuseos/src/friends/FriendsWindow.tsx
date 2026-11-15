import { useContext, useState } from "react";

import { Win98Icon } from "../ui/icons";
import { ContextMenu } from "../windows/ContextMenu";
import type { MenuDef } from "../windows/MenuBar";
import { MenuBar } from "../windows/MenuBar";
import type { MenuPosition } from "../windows/menuPosition";
import { menuPositionAt } from "../windows/menuPosition";
import { useWindowCommands } from "../windows/useWindowCommands";

import { FriendsDepsContext } from "./friendsDepsContext";
import { MessengerConversation } from "./MessengerConversation";
import "./messenger.css";
import type { Buddy, BuddyStatus } from "./presenceService";
import { STATUS_LABEL } from "./presenceService";
import type { FriendsViewModel } from "./useFriendsViewModel";
import { useFriendsViewModel } from "./useFriendsViewModel";

export type FriendsWindowProps = { windowId: string };

/** The coloured dot ICQ put beside a name; a title says the state for a screen reader and a tooltip. */
export function StatusDot({ status }: { status: BuddyStatus }) {
  const colour: Record<BuddyStatus, string> = {
    online: "#19a319",
    away: "#e0b000",
    playing: "#1084d0",
    offline: "#8a8a8a",
  };
  return (
    <span
      role="img"
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
      data-status={status}
      className="inline-block h-2.5 w-2.5 shrink-0 border border-black"
      style={{
        backgroundColor: colour[status],
        borderRadius: status === "playing" ? 0 : "50%",
      }}
    />
  );
}

function BuddyRow({
  buddy,
  vm,
  onMenu,
  onChat,
}: {
  buddy: Buddy;
  vm: FriendsViewModel;
  onMenu: (buddy: Buddy, position: MenuPosition) => void;
  onChat: (buddy: Buddy) => void;
}) {
  const playing = buddy.status === "playing" && buddy.room;
  return (
    <li
      className="flex items-center gap-1.5 px-1 py-0.5 hover:bg-[navy] hover:text-white"
      data-testid={`buddy-${buddy.publicId}`}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(buddy, menuPositionAt(event));
      }}
      onDoubleClick={() => onChat(buddy)}
    >
      <StatusDot status={buddy.status} />
      <span className="min-w-0 flex-1 truncate">
        <span className={buddy.status === "offline" ? "text-gray-500" : ""}>
          {buddy.name}
        </span>
        {playing ? (
          <span className="block truncate text-[10px] opacity-80">
            Playing {vm.gameName(buddy.room!.gameId)} · room {buddy.room!.code}
          </span>
        ) : buddy.statusLine ? (
          <span className="block truncate text-[10px] opacity-80">
            {buddy.statusLine}
          </span>
        ) : buddy.lastSeen !== undefined ? (
          <span className="block truncate text-[10px] text-gray-500">
            Last seen {vm.lastSeen(buddy.lastSeen)}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        className="msn-chat-button"
        onClick={() => onChat(buddy)}
        aria-label={`Chat with ${buddy.name}`}
      >
        Chat
      </button>
      {playing ? (
        <button
          type="button"
          className="h-5 shrink-0 px-1 text-[10px]"
          style={{ minWidth: 0 }}
          onClick={() => vm.joinRoom(buddy.room!.gameId, buddy.room!.code)}
        >
          Join game
        </button>
      ) : null}
    </li>
  );
}

function SignedOut({ vm }: { vm: FriendsViewModel }) {
  const restoring = vm.snapshot.account.kind === "restoring";
  return (
    <div className="msn-signed-out">
      <Win98Icon name="messenger" size={32} />
      <p className="msn-signin-title">MSN Messenger</p>
      <p>
        Talk to friends, see what they are playing, and invite them to a game.
        One sign-in connects you to Fuse world across this desktop and every
        game.
      </p>
      <button
        type="button"
        className="default"
        disabled={vm.busy || restoring}
        onClick={vm.signIn}
      >
        {restoring ? "Signing in..." : "Sign in to Fuse world"}
      </button>
      <p className="msn-signin-note">Uses your Google account.</p>
      {vm.capabilities.demo ? (
        <button
          type="button"
          className="flat text-[10px] underline"
          style={{ minWidth: 0 }}
          onClick={() => vm.setDemo(true)}
        >
          No account? Try the demo buddy list
        </button>
      ) : null}
    </div>
  );
}

function AddFriendForm({ vm }: { vm: FriendsViewModel }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex items-center gap-1 px-1 py-1"
      aria-label="Add a friend"
      onSubmit={(event) => {
        event.preventDefault();
        if (vm.addFriend(value)) setValue("");
      }}
    >
      <label htmlFor="friends-add-id" className="shrink-0">
        Add:
      </label>
      <input
        id="friends-add-id"
        type="text"
        className="min-w-0 flex-1"
        placeholder="friend's player id"
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        type="submit"
        className="h-5 px-2"
        style={{ minWidth: 0 }}
        disabled={vm.busy || value.trim().length === 0}
      >
        Add
      </button>
    </form>
  );
}

/** MSN Messenger: the buddy list, requests, invites and the player's own id, ICQ/MSN style. */
export function FriendsWindow({ windowId }: FriendsWindowProps) {
  const vm = useFriendsViewModel();
  const commands = useWindowCommands();
  const deps = useContext(FriendsDepsContext);
  const [menu, setMenu] = useState<{ buddy: Buddy; position: MenuPosition }>();
  const [conversationId, setConversationId] = useState<string>();
  const { snapshot } = vm;
  const signedIn = snapshot.account.kind === "signed-in";
  const accountName =
    snapshot.account.kind === "signed-in" ? snapshot.account.name : "";
  const demo = snapshot.mode === "demo";
  const conversation = snapshot.buddies.find(
    (buddy) => buddy.publicId === conversationId,
  );
  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        signedIn
          ? { label: "Sign out", onSelect: vm.signOut, disabled: vm.busy }
          : { label: "Sign in...", onSelect: vm.signIn, disabled: vm.busy },
        { label: "Refresh", onSelect: vm.refresh, disabled: !signedIn },
        { separator: true },
        {
          label: "Demo buddies",
          checked: demo,
          disabled: !vm.capabilities.demo,
          onSelect: () => vm.setDemo(!demo),
        },
        { separator: true },
        { label: "Close", onSelect: () => commands.close(windowId) },
      ],
    },
    {
      label: "Help",
      items: [
        {
          label: "About MSN Messenger",
          onSelect: () =>
            commands.showInfo(
              "About MSN Messenger",
              "Friends from every Fuse game, in one list. Add a contact with their player id, accept the request, and double-click their name to chat. Join a game room to invite them.\n\nYour Fuse world account is shared with the games. Contacts refresh every 20 seconds; an open conversation checks for messages every 10 seconds. Messages are plain text; the view shows up to 80 messages from the last seven days. Removing a friend clears that conversation.",
            ),
        },
      ],
    },
  ];
  const copyId = () => {
    const id = snapshot.me?.publicId;
    if (id) void deps.copyText(id);
  };
  return (
    <div
      className="msn-root flex h-full min-h-0 flex-col"
      data-testid="friends-window"
    >
      <MenuBar menus={menus} />
      {signedIn && conversation && snapshot.me && !demo ? (
        <MessengerConversation
          key={`${snapshot.me.publicId}:${conversation.publicId}`}
          buddy={conversation}
          me={snapshot.me}
          back={() => setConversationId(undefined)}
        />
      ) : signedIn ? (
        <>
          <div className="msn-my-status flex items-center gap-2 border-b border-gray-500 px-2 py-1">
            <Win98Icon name="messenger" size={32} />
            <div className="min-w-0 flex-1">
              <p className="msn-my-status-label">My Status:</p>
              <div className="truncate font-bold">
                {snapshot.me?.name ?? accountName}
              </div>
              <div className="flex items-center gap-1 text-[10px]">
                <StatusDot status={snapshot.suspended ? "playing" : "online"} />
                {`${snapshot.suspended ? "In a game" : "Online"}${demo ? " · demo" : ""}`}
              </div>
              {snapshot.me ? (
                <div className="flex items-center gap-1 text-[10px]">
                  <span
                    className="truncate"
                    title="Your player id: friends add you with it"
                  >
                    id{" "}
                    <code data-testid="my-public-id">
                      {snapshot.me.publicId}
                    </code>
                  </span>
                  <button
                    type="button"
                    className="h-4 px-1 text-[10px]"
                    style={{ minWidth: 0 }}
                    onClick={copyId}
                    aria-label="Copy your player id"
                  >
                    Copy
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          {snapshot.suspended ? (
            <p className="bg-[#ffffe1] px-2 py-1 text-[10px]" role="status">
              A game window is open: it reports where you are, and the list
              updates again when it closes.
            </p>
          ) : null}
          {snapshot.invites.length > 0 ? (
            <ul
              className="border-b border-gray-500 bg-[#ffffe1] px-1 py-1"
              aria-label="Invites"
            >
              {snapshot.invites.map((invite) => (
                <li key={invite.id} className="flex items-center gap-1 py-0.5">
                  <span className="min-w-0 flex-1 truncate">
                    <b>{invite.from.name}</b> invited you to{" "}
                    {vm.gameName(invite.gameId)} ({invite.code})
                  </span>
                  <button
                    type="button"
                    className="h-5 px-1 text-[10px]"
                    style={{ minWidth: 0 }}
                    onClick={() => vm.joinRoom(invite.gameId, invite.code)}
                  >
                    Join
                  </button>
                  <button
                    type="button"
                    className="h-5 px-1 text-[10px]"
                    style={{ minWidth: 0 }}
                    aria-label={`Dismiss invite from ${invite.from.name}`}
                    onClick={() => vm.dismissInvite(invite.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="msn-contact-list sunken-panel m-1 flex min-h-0 flex-1 flex-col overflow-auto bg-white">
            {snapshot.incoming.length > 0 || snapshot.outgoing.length > 0 ? (
              <section
                aria-label="Requests"
                className="border-b border-gray-300"
              >
                <h3 className="bg-silver px-1 py-0.5 text-[10px] font-bold uppercase">
                  Requests
                </h3>
                <ul>
                  {snapshot.incoming.map((card) => (
                    <li
                      key={card.publicId}
                      className="flex items-center gap-1 px-1 py-0.5"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <b>{card.name}</b> wants to be your friend
                      </span>
                      <button
                        type="button"
                        className="h-5 px-1 text-[10px]"
                        style={{ minWidth: 0 }}
                        aria-label={`Accept ${card.name}`}
                        onClick={() => vm.addFriend(card.publicId)}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="h-5 px-1 text-[10px]"
                        style={{ minWidth: 0 }}
                        aria-label={`Decline ${card.name}`}
                        onClick={() => vm.removeFriend(card.publicId)}
                      >
                        Decline
                      </button>
                    </li>
                  ))}
                  {snapshot.outgoing.map((card) => (
                    <li
                      key={card.publicId}
                      className="flex items-center gap-1 px-1 py-0.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-gray-600">
                        Waiting for <b>{card.name}</b>
                      </span>
                      <button
                        type="button"
                        className="h-5 px-1 text-[10px]"
                        style={{ minWidth: 0 }}
                        aria-label={`Cancel request to ${card.name}`}
                        onClick={() => vm.removeFriend(card.publicId)}
                      >
                        Cancel
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {snapshot.loaded && snapshot.buddies.length === 0 ? (
              <p className="px-2 py-3 text-center text-gray-600">
                No buddies yet. Add one with their player id below, or send
                yours to a friend.
              </p>
            ) : null}
            {!snapshot.loaded ? (
              <p className="px-2 py-3 text-center text-gray-600" role="status">
                {snapshot.error
                  ? "Could not load your buddies."
                  : "Loading your buddies..."}
              </p>
            ) : null}
            {vm.groups.map((group) =>
              group.buddies.length === 0 && group.status !== "online" ? null : (
                <details key={group.status} open={group.status !== "offline"}>
                  <summary className="cursor-default px-1 py-0.5 font-bold">
                    {STATUS_LABEL[group.status]} ({group.buddies.length})
                  </summary>
                  <ul aria-label={STATUS_LABEL[group.status]}>
                    {group.buddies.map((buddy) => (
                      <BuddyRow
                        key={buddy.publicId}
                        buddy={buddy}
                        vm={vm}
                        onChat={(buddy) => {
                          if (demo)
                            commands.showInfo(
                              "Demo contacts",
                              "Switch off File > Demo buddies and sign in to chat with your real friends.",
                            );
                          else setConversationId(buddy.publicId);
                        }}
                        onMenu={(target, position) =>
                          setMenu({ buddy: target, position })
                        }
                      />
                    ))}
                  </ul>
                </details>
              ),
            )}
          </div>
          <div className="msn-want-to">I want to...</div>
          <AddFriendForm vm={vm} />
        </>
      ) : (
        <SignedOut vm={vm} />
      )}
      <div className="msn-brand">
        <span>msn</span>
        <Win98Icon name="messenger" size={32} />
        <b>Messenger</b>
      </div>
      {vm.actionError || snapshot.error ? (
        <p className="px-2 py-0.5 text-[10px] text-[#a00]" role="alert">
          {vm.actionError ?? snapshot.error}
        </p>
      ) : null}
      <div className="status-bar">
        <p className="status-bar-field">
          {signedIn
            ? `${vm.onlineCount} of ${snapshot.buddies.length} buddies online${snapshot.loading ? " · refreshing" : ""}`
            : "Signed out"}
        </p>
      </div>
      {menu ? (
        <ContextMenu
          label={`${menu.buddy.name} menu`}
          position={menu.position}
          items={[
            {
              label: "Send an Instant Message",
              bold: true,
              disabled: demo,
              onSelect: () => setConversationId(menu.buddy.publicId),
            },
            {
              label: "Join game",
              bold: menu.buddy.status === "playing",
              disabled: !menu.buddy.room,
              onSelect: () =>
                menu.buddy.room
                  ? vm.joinRoom(menu.buddy.room.gameId, menu.buddy.room.code)
                  : undefined,
            },
            { separator: true },
            {
              label: "Remove friend",
              onSelect: () => vm.removeFriend(menu.buddy.publicId),
            },
          ]}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}
