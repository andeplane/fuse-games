# Account attribution for product events

Signed-in play should identify the account in the private developer workspace.
Keep the random browser and session IDs for existing aggregate metrics. Add an
enqueue-time account UID to each event; it is a claim, never authentication.
The browser sends its current Firebase token in `X-Fuse-Identity`, separately
from the telemetry admission credential. No credential enters the outbox.

The server verifies the token using the ordinary player identity verifier and
reads the shared account profile for its username. Only events whose captured
UID matches that verified account receive stored account attribution. Guests,
old events, invalid credentials, and events queued under another account remain
anonymous. Retries keep their original event IDs and attribution is immutable
after first acceptance. We never relabel historical browser activity.

The explorer exposes account ID and username as filter dimensions. Raw events,
reported participants and player sessions show the verified username. Sessions
split on account changes, and account filters follow the player across browsers.
Browser aggregate counts retain their existing meaning. Opt-out and Do Not
Track still suppress collection, and arbitrary event properties still reject
names, emails and credentials. Attribution records expire with their raw events.

This identifies the authenticated sender, not authoritative gameplay: product
events remain client observations and cannot prove another player's actions.
