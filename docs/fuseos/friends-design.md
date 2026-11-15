# Fuse Messenger in FuseOS

Fuse Messenger is the desktop's account and friends app, under Start > Programs,
`?open=friends`, and every Fusteam Friends action. Its buddy list, white
separate Instant Message windows, menu strip and green/blue buddy art follow
the original late-1990s MSN Messenger layout and use the existing
Windows 98 chrome. The first-run desktop opens Winamp, Fusteam and Messenger.
The desktop's completed dial-up handshake is remembered separately from sign-in.

## One Fuse world account

The **Sign in to Fuse world** button uses the existing Google/Firebase account
adapter (`fuse-ui/browser-account`). The desktop and same-origin game frames
restore the same Firebase account. The FuseOS/game bridge coordinates desktop
actions; it never sends account tokens, room tokens or host capabilities through
`postMessage`. API credentials travel in request headers.

A direct account switch clears the old private friend list before the new poll
starts, even if the accounts have identical display names. An open conversation
is keyed to the account's public id and contact id; late responses cannot restore
a closed conversation or replace a newer send. Chat requests also carry the
expected public account id in `X-Fuse-Account`, checked against the authenticated
account, so a pending draft cannot be sent by a replacement account.

## Contacts, presence and game invitations

The existing platform friend graph supplies public player ids, requests,
acceptance, removal, online/away/playing states, last seen and incoming game
invites. Copy your id and give it to a friend, or add theirs. Both sides must
accept before they can chat.

The desktop polls presence every 20 seconds with `passive: true`: it refreshes
the account without replacing the room claim made by the game. Opening a game
does not suspend Messenger; friends and incoming invites remain available.
Switching to demo mode still suspends the live client until switching back.

Double-click a contact, press Enter on it, or select it and choose **Send** to
open its own Instant Message window. The buddy list stays open. Each chat has
its own taskbar entry; minimizing preserves its draft. Closing clears the draft.
Private chat titles and contact/account ids never enter saved window state.
Signing out, changing accounts, removing a friend or entering demo mode closes
the old account's chats. **Join game** remains an explicit
action for a contact currently playing. In a conversation, **Invite to game**
uses `MessengerGameContext`: FuseOS forwards the request to the embedded game
that owns the selected active room. That game uses the existing invitation API
with its own room token. The button is disabled until a room is available;
failed invitations remain visible and retryable. Incoming invites open the
corresponding game and room on the desktop.

## Private messages

The new account routes are:

- `GET /api/friends/:publicId/messages`: read the recent conversation.
- `POST /api/friends/:publicId/messages` with `{ id, text }`: send plain text.

Both require the existing bearer identity and the expected public account id.
The store checks the accepted friendship transactionally on every read and
write. Nonfriends, pending requests and other accounts cannot read or send.
Removing the friendship deletes its conversation in the same storage
transaction, so a later re-add starts empty.

The service accepts at most 1,000 UTF-16 units per message, rejects control
characters and extra request fields, trims surrounding whitespace, and renders
the result as text. Per-account budgets are 800 reads and 600 sends per hour.
A sender-generated 32-hex id is reused after a failed send, making retries
idempotent; reusing it with different text is rejected. Concurrent sends append
atomically, with server timestamps and public sender ids.

The view contains at most 80 messages from the previous seven days. A bounded
`chat/recent` child document under the existing friendship stores the
transcript. It is separate from the friendship document, so normal presence
polling does not download message histories. Expired entries are removed on the
next conversation read or write; this is a visibility limit, not a background
TTL deletion guarantee. Unfriending deletes the child document immediately.
Presence carries only the latest sender and timestamp, not message text. These
markers expire after seven days too. Retrying a stored message never changes
the newest-message marker.
There is no new service, collection query, composite index, persistent socket,
or gameplay relay.

Open conversations poll every 10 seconds, or every 3 seconds for 90 seconds
after recent activity, with the next poll scheduled after the previous request
finishes. A changed message marker refreshes the conversation immediately.
An unseen incoming message opens its conversation, or shows a clickable tray
notification while a game is in front. Minimized chats do not mark messages
read; new incoming messages restore them or show the same game-safe notification.
Read marks are bounded to 200 account/contact pairs and persist only timestamps.
Closing a chat stops its polling. Errors retain the draft and provide Retry; a successful send
updates the transcript without waiting for the next poll. Enter sends,
Shift+Enter inserts a newline, and composing an IME does not send prematurely.
Messages, contact ids and room details are never added to analytics.

## Implementation and verification

- `src/friends/FriendsWindow.tsx`: contacts, requests, invites and sign-in.
- `src/friends/InstantMessageWindow.tsx`: account-bound chat window, draft and menus.
- `src/friends/useConversation.ts`: polling, idempotent sending and game invites.
- `src/friends/FriendsTray.tsx` and `messengerRead.ts`: account-scoped incoming-message notifications/read marks.
- `src/friends/MessengerChatContext.ts`: injected chat client and message ids.
- `src/friends/MessengerGameContext.ts`: the desktop's active-room/invite capability.
- `src/friends/realPresenceService.ts`: the existing account and friend adapters.
- `packages/fuse-ui/src/messenger-client.ts`: authenticated HTTP client and response validation.
- `packages/fuse-platform/src/messages-api.ts`: browser-safe message contract and bounds.
- `FriendsStore.conversation`, `MemoryFriendsDatabase` and `FirestoreFriendsDatabase`:
  authorization, idempotency and atomic persistence.

`pnpm exec tsx scripts/messenger-smoke.ts` opens two isolated headless browser
accounts against the real local HTTP service, with explicitly injected
identities. It exercises adding/accepting contacts, bidirectional plain-text
chat, incoming-message popups, history after reopening, minimized drafts and
dragging real OS windows. It closes its
browsers and servers. This proves the local UI/API flow, not production
deployment, Google popup authentication or physical-phone behavior.
