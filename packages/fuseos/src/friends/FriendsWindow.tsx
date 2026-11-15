import { useContext, useRef, useState } from "react";

import { ContextMenu } from "../windows/ContextMenu";
import type { ContextMenuItem } from "../windows/ContextMenu";
import type { MenuDef } from "../windows/MenuBar";
import { MenuBar } from "../windows/MenuBar";
import type { MenuPosition } from "../windows/menuPosition";
import { menuPositionAt } from "../windows/menuPosition";
import { useWindowCommands } from "../windows/useWindowCommands";

import { FriendsDepsContext } from "./friendsDepsContext";
import { BuddyIcon, FuseMessengerMark, ToolbarIcon } from "./messengerArt";
import "./messenger.css";
import { MessengerGameContext } from "./MessengerGameContext";
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

/** What follows a name in the list, in brackets the way 1999 did it: "(Away)", "(Playing Fuseball)". */
function nameSuffix(buddy: Buddy, vm: FriendsViewModel): string | undefined {
  if (buddy.status === "away") return "(Away)";
  if (buddy.status === "playing" && buddy.room)
    return `(Playing ${vm.gameName(buddy.room.gameId)})`;
  return undefined;
}

function BuddyRow({
  buddy,
  vm,
  selected,
  onSelect,
  onOpen,
  onMenu,
}: {
  buddy: Buddy;
  vm: FriendsViewModel;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onMenu: (position: MenuPosition) => void;
}) {
  const suffix = nameSuffix(buddy, vm);
  const detail =
    buddy.status === "playing" && buddy.room
      ? `Playing ${vm.gameName(buddy.room.gameId)} · room ${buddy.room.code}`
      : (buddy.statusLine ??
        (buddy.lastSeen !== undefined
          ? `Last seen ${vm.lastSeen(buddy.lastSeen)}`
          : undefined));
  return (
    <li>
      <button
        type="button"
        data-testid={`buddy-${buddy.publicId}`}
        className={`flat msn-buddy${selected ? " msn-buddy-selected" : ""}`}
        aria-pressed={selected}
        title={detail}
        onClick={onSelect}
        onDoubleClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onOpen();
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onSelect();
          onMenu(menuPositionAt(event));
        }}
      >
        <BuddyIcon status={buddy.status} />
        <span className="msn-buddy-name">
          <span className={buddy.status === "offline" ? "msn-offline" : ""}>
            {buddy.name}
          </span>
          {suffix ? <span className="msn-buddy-suffix"> {suffix}</span> : null}
          {detail ? <span className="msn-buddy-detail">{detail}</span> : null}
        </span>
      </button>
    </li>
  );
}

function GroupHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="flat msn-group"
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="msn-group-toggle" aria-hidden="true">
        {open ? "▲" : "▼"}
      </span>
      <span>
        {label} ({count})
      </span>
    </button>
  );
}

function SignedOut({ vm }: { vm: FriendsViewModel }) {
  const restoring = vm.snapshot.account.kind === "restoring";
  return (
    <div className="msn-signed-out">
      <FuseMessengerMark size={56} />
      <p className="msn-signin-title">Fuse Messenger</p>
      <p>
        Chat with friends, see what they are playing, and invite them to a game.
        One sign-in connects you across this desktop and every game.
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

function AddFriendForm({
  vm,
  onDone,
}: {
  vm: FriendsViewModel;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="msn-add"
      aria-label="Add a Contact"
      onSubmit={(event) => {
        event.preventDefault();
        if (vm.addFriend(value)) {
          setValue("");
          onDone();
        }
      }}
    >
      <label htmlFor="friends-add-id">Add a Contact by player id:</label>
      <div className="msn-add-row">
        <input
          id="friends-add-id"
          type="text"
          placeholder="friend's player id"
          value={value}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onDone();
            }
          }}
        />
        <button type="submit" disabled={vm.busy || value.trim().length === 0}>
          Add
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Fuse Messenger: a late-90s buddy list. Double-click a buddy for an Instant Message window. */
export function FriendsWindow({ windowId }: FriendsWindowProps) {
  const vm = useFriendsViewModel();
  const commands = useWindowCommands();
  const deps = useContext(FriendsDepsContext);
  const game = useContext(MessengerGameContext);
  const [menu, setMenu] = useState<{
    items: ContextMenuItem[];
    label: string;
    position: MenuPosition;
  }>();
  const [selectedId, setSelectedId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [closedGroups, setClosedGroups] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [wantToOpen, setWantToOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string>();
  const statusButton = useRef<HTMLButtonElement>(null);
  const { snapshot } = vm;
  const signedIn = snapshot.account.kind === "signed-in";
  const accountName =
    snapshot.account.kind === "signed-in" ? snapshot.account.name : "";
  const demo = snapshot.mode === "demo";
  const selected = snapshot.buddies.find(
    (buddy) => buddy.publicId === selectedId,
  );
  const online = snapshot.buddies
    .filter((buddy) => buddy.status !== "offline")
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.publicId.localeCompare(b.publicId),
    );
  const offline = vm.groups.find(
    (group) => group.status === "offline",
  )!.buddies;
  const myState = snapshot.suspended ? "In a game" : "Online";

  const openChat = (buddy: Buddy | undefined) => {
    if (!buddy) {
      commands.showInfo(
        "Send an Instant Message",
        "Click a contact in the list first, then press Send. Double-clicking a name opens a conversation too.",
      );
      return;
    }
    if (demo) {
      commands.showInfo(
        "Demo contacts",
        "Demo buddies cannot chat. Switch off File > Demo buddies and sign in to chat with your real friends.",
      );
      return;
    }
    commands.open({ kind: "im", buddyId: buddy.publicId, name: buddy.name });
  };
  const joinGame = (buddy: Buddy | undefined) => {
    if (buddy?.room) vm.joinRoom(buddy.room.gameId, buddy.room.code);
    else
      commands.showInfo(
        "Join a game",
        buddy
          ? `${buddy.name} is not in a game room right now.`
          : "Click a contact who is playing, then press Join.",
      );
  };
  const inviteToGame = async (buddy: Buddy | undefined) => {
    if (!buddy || !snapshot.me || demo) {
      commands.showInfo(
        "Invite to a game",
        "Click a contact in the list first, then press Invite.",
      );
      return;
    }
    if (!game.currentGame) {
      commands.showInfo(
        "Invite to a game",
        "Open a game and join a room first; then invite friends into it from here.",
      );
      return;
    }
    setNotice(undefined);
    try {
      await game.invite(buddy.publicId, snapshot.me.publicId);
      setNotice(`Invited ${buddy.name} to your game.`);
    } catch (failure) {
      setNotice(
        failure instanceof Error ? failure.message : "Invitation not sent.",
      );
    }
  };
  const copyId = () => {
    const id = snapshot.me?.publicId;
    if (!id) return;
    void deps.copyText(id).then(() => {
      setCopied(true);
      deps.schedule(() => setCopied(false), 2_000);
    });
  };
  const toggleGroup = (key: string) =>
    setClosedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
      label: "Actions",
      items: [
        {
          label: "Send an Instant Message",
          disabled: !signedIn,
          onSelect: () => openChat(selected),
        },
        {
          label: "Add a Contact...",
          disabled: !signedIn,
          onSelect: () => setAdding(true),
        },
        {
          label: "Invite to my game",
          disabled: !signedIn,
          onSelect: () => void inviteToGame(selected),
        },
        {
          label: "Join game",
          disabled: !selected?.room,
          onSelect: () => joinGame(selected),
        },
        { separator: true },
        {
          label: "Remove contact",
          disabled: !selected,
          onSelect: () => selected && vm.removeFriend(selected.publicId),
        },
      ],
    },
    {
      label: "Tools",
      items: [
        {
          label: "Copy my player id",
          disabled: !snapshot.me,
          onSelect: copyId,
        },
      ],
    },
    {
      label: "Help",
      items: [
        {
          label: "About Fuse Messenger",
          onSelect: () =>
            commands.showInfo(
              "About Fuse Messenger",
              "Friends from every Fuse game, in one list. Add a contact with their player id, accept the request, and double-click their name to chat. A message from a friend opens its own window.\n\nYour Fuse world account is shared with the games. Contacts refresh every 20 seconds and an open conversation every few seconds. Messages are plain text; a conversation keeps up to 80 messages from the last seven days. Removing a friend clears that conversation.",
            ),
        },
      ],
    },
  ];
  const buddyMenu = (buddy: Buddy, position: MenuPosition) =>
    setMenu({
      label: `${buddy.name} menu`,
      position,
      items: [
        {
          label: "Send an Instant Message",
          bold: true,
          disabled: demo,
          onSelect: () => openChat(buddy),
        },
        {
          label: "Invite to my game",
          disabled: demo || !game.currentGame,
          onSelect: () => void inviteToGame(buddy),
        },
        {
          label: "Join game",
          bold: false,
          disabled: !buddy.room,
          onSelect: () => joinGame(buddy),
        },
        { separator: true },
        {
          label: "Remove friend",
          onSelect: () => vm.removeFriend(buddy.publicId),
        },
      ],
    });
  const statusMenu = () => {
    const box = statusButton.current?.getBoundingClientRect();
    setMenu({
      label: "My status",
      position: { x: box?.left ?? 0, y: box?.bottom ?? 0 },
      items: [
        { label: myState, checked: true },
        { separator: true },
        {
          label: "Copy my player id",
          disabled: !snapshot.me,
          onSelect: copyId,
        },
        { label: "Sign out", disabled: vm.busy, onSelect: vm.signOut },
      ],
    });
  };
  const rows = (buddies: Buddy[]) =>
    buddies.map((buddy) => (
      <BuddyRow
        key={buddy.publicId}
        buddy={buddy}
        vm={vm}
        selected={buddy.publicId === selectedId}
        onSelect={() => setSelectedId(buddy.publicId)}
        onOpen={() => openChat(buddy)}
        onMenu={(position) => buddyMenu(buddy, position)}
      />
    ));

  return (
    <div
      className="msn-root flex h-full min-h-0 flex-col"
      data-testid="friends-window"
    >
      <MenuBar menus={menus} />
      {signedIn ? (
        <>
          <div className="msn-bigbar" role="toolbar" aria-label="Messenger">
            <button
              type="button"
              className="flat msn-bigbutton"
              onClick={() => setAdding(true)}
              title="Add a Contact"
            >
              <ToolbarIcon art="add" />
              <span>Add</span>
            </button>
            <button
              type="button"
              className="flat msn-bigbutton"
              onClick={() => openChat(selected)}
              title="Send an Instant Message"
            >
              <ToolbarIcon art="send" />
              <span>Send</span>
            </button>
            <button
              type="button"
              className="flat msn-bigbutton"
              onClick={() => void inviteToGame(selected)}
              title="Invite a contact to your game room"
            >
              <ToolbarIcon art="invite" />
              <span>Invite</span>
            </button>
            <button
              type="button"
              className="flat msn-bigbutton"
              onClick={() => joinGame(selected)}
              title="Join a contact's game"
            >
              <ToolbarIcon art="join" />
              <span>Join</span>
            </button>
          </div>
          <div className="msn-my-status">
            <BuddyIcon status={snapshot.suspended ? "playing" : "online"} />
            <div className="msn-my-status-text">
              <button
                ref={statusButton}
                type="button"
                className="flat msn-status-button"
                aria-haspopup="menu"
                aria-label={`My status: ${myState}`}
                onClick={statusMenu}
              >
                <b>{snapshot.me?.name ?? accountName}</b> ({myState}
                {demo ? ", demo" : ""}) <span aria-hidden="true">▾</span>
              </button>
              {snapshot.me ? (
                <button
                  type="button"
                  className="flat msn-link"
                  onClick={copyId}
                  aria-label="Copy your player id"
                  title="Friends add you with this id. Click to copy it."
                >
                  ✉ My player id:{" "}
                  <code data-testid="my-public-id">{snapshot.me.publicId}</code>
                  {copied ? " (copied)" : ""}
                </button>
              ) : null}
            </div>
          </div>
          {snapshot.suspended ? (
            <p className="msn-banner-note" role="status">
              A game window is open: it reports where you are, and the list
              updates again when it closes.
            </p>
          ) : null}
          {snapshot.invites.length > 0 ? (
            <ul className="msn-invites" aria-label="Invites">
              {snapshot.invites.map((invite) => (
                <li key={invite.id}>
                  <span className="min-w-0 flex-1 truncate">
                    <b>{invite.from.name}</b> invited you to{" "}
                    {vm.gameName(invite.gameId)} ({invite.code})
                  </span>
                  <button
                    type="button"
                    onClick={() => vm.joinRoom(invite.gameId, invite.code)}
                  >
                    Join
                  </button>
                  <button
                    type="button"
                    aria-label={`Dismiss invite from ${invite.from.name}`}
                    onClick={() => vm.dismissInvite(invite.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {adding ? (
            <AddFriendForm vm={vm} onDone={() => setAdding(false)} />
          ) : null}
          <div className="msn-contact-list">
            {snapshot.incoming.length > 0 || snapshot.outgoing.length > 0 ? (
              <section aria-label="Requests" className="msn-requests">
                <h3>Requests</h3>
                <ul>
                  {snapshot.incoming.map((card) => (
                    <li key={card.publicId}>
                      <span className="min-w-0 flex-1 truncate">
                        <b>{card.name}</b> wants to be your friend
                      </span>
                      <button
                        type="button"
                        aria-label={`Accept ${card.name}`}
                        onClick={() => vm.addFriend(card.publicId)}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        aria-label={`Decline ${card.name}`}
                        onClick={() => vm.removeFriend(card.publicId)}
                      >
                        Decline
                      </button>
                    </li>
                  ))}
                  {snapshot.outgoing.map((card) => (
                    <li key={card.publicId}>
                      <span className="min-w-0 flex-1 truncate text-gray-600">
                        Waiting for <b>{card.name}</b>
                      </span>
                      <button
                        type="button"
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
            {!snapshot.loaded ? (
              <p className="msn-list-note" role="status">
                {snapshot.error
                  ? "Could not load your contacts."
                  : "Loading your contacts..."}
              </p>
            ) : snapshot.buddies.length === 0 ? (
              <p className="msn-list-note">
                No contacts yet. Press Add and type a friend&apos;s player id,
                or send yours to a friend.
              </p>
            ) : null}
            {snapshot.loaded ? (
              <>
                <GroupHeader
                  label="Online"
                  count={online.length}
                  open={!closedGroups.has("online")}
                  onToggle={() => toggleGroup("online")}
                />
                {closedGroups.has("online") ? null : (
                  <ul aria-label="Online">{rows(online)}</ul>
                )}
                <GroupHeader
                  label="Not Online"
                  count={offline.length}
                  open={!closedGroups.has("offline")}
                  onToggle={() => toggleGroup("offline")}
                />
                {closedGroups.has("offline") ? null : (
                  <ul aria-label="Not Online">{rows(offline)}</ul>
                )}
              </>
            ) : null}
          </div>
          {notice ? (
            <p className="msn-chat-notice" role="status">
              {notice}
            </p>
          ) : null}
          <section className="msn-want-to" aria-label="I want to">
            <button
              type="button"
              className="flat msn-want-to-header"
              aria-expanded={wantToOpen}
              onClick={() => setWantToOpen((open) => !open)}
            >
              <span className="msn-group-toggle" aria-hidden="true">
                {wantToOpen ? "▼" : "▲"}
              </span>
              I want to...
            </button>
            {wantToOpen ? (
              <ul>
                <li>
                  <button
                    type="button"
                    className="flat"
                    onClick={() => setAdding(true)}
                  >
                    <span className="msn-want-icon" aria-hidden="true">
                      +
                    </span>
                    Add a Contact
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="flat"
                    onClick={() => openChat(selected)}
                  >
                    <span className="msn-want-icon" aria-hidden="true">
                      ✎
                    </span>
                    Send an Instant Message
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="flat"
                    onClick={() => void inviteToGame(selected)}
                  >
                    <span className="msn-want-icon" aria-hidden="true">
                      ►
                    </span>
                    Invite a Friend to my Game
                  </button>
                </li>
                <li>
                  <button type="button" className="flat" onClick={copyId}>
                    <span className="msn-want-icon" aria-hidden="true">
                      ✉
                    </span>
                    Give a Friend my Player Id
                  </button>
                </li>
              </ul>
            ) : null}
          </section>
        </>
      ) : (
        <SignedOut vm={vm} />
      )}
      <div className="msn-brand" aria-hidden="true">
        <FuseMessengerMark size={30} />
        <span className="msn-brand-fuse">fuse</span>
        <span className="msn-brand-word">Messenger</span>
      </div>
      {vm.actionError || snapshot.error ? (
        <p className="msn-error" role="alert">
          {vm.actionError ?? snapshot.error}
        </p>
      ) : null}
      <div className="status-bar">
        <p className="status-bar-field msn-statusbar">
          <BuddyIcon status={signedIn ? "online" : "offline"} />
          {signedIn
            ? `${myState} · ${vm.onlineCount} of ${snapshot.buddies.length} buddies online${snapshot.loading ? " · refreshing" : ""}`
            : "Signed out"}
        </p>
      </div>
      {menu ? (
        <ContextMenu
          label={menu.label}
          position={menu.position}
          items={menu.items}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}
