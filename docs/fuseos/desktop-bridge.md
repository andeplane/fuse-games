# Desktop and embedded games

FuseOS embeds same-origin game pages. `fuse-ui/desktop-bridge` connects their
existing friends panels to the desktop through versioned `fuse.desktop.v1`
messages. `DesktopBridgeProvider` registers the actual frame's `contentWindow`
and checks message origin, source, game id and session. Reloading/navigating a
frame establishes a new session and rejects outstanding invitations.

The game publishes its admitted room code and opens MSN Messenger when its
Friends button is pressed. Messenger invites a selected friend through the
most recently reporting open room. The game sends the invitation using its
existing authenticated friends client and replies only after that API completes.
Room tokens and account tokens remain inside the game; neither is sent through
postMessage. Standalone games keep their ordinary friends panel. Transport
failure, a room change, a closed frame or a ten-second timeout produces a
retryable error rather than success. Pending desktop requests and duplicate
request history are bounded.

Sign-in uses the existing origin-wide Firebase account persistence. A game that
booted as a guest listens for the remembered-account storage change, loads the
auth SDK, and then receives Firebase's account updates. The desktop does not
transmit credentials or reload a running game to sign it in. Sign-out uses the
same Firebase state synchronization. The cosmetic dial-up flag is independent
of authentication.

Verification: `pnpm exec tsx scripts/fuseos-social-smoke.ts` checks first boot,
remembered dial-up, and each real portal game's Friends menu inside an iframe.
`pnpm exec tsx scripts/messenger-smoke.ts` checks chat through the local HTTP API
with injected identities. These checks do not prove a real Google popup or a
physical phone works; those need an interactive playtest.
