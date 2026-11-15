# Room tokens travel in headers and frames, never in URLs

Design note for issue #256, finding S3 (first flagged in
[online-security-operations-review.md](../reviews/online-security-operations-review.md), P2). Status: implemented.

## Problem

A room token is a bearer capability. A member token names a seat; the creator's token also authorizes
`POST /api/rooms/{code}/end`. Two requests carried it in the query string: `GET /api/rooms/{code}/ice?token=` and the
room WebSocket, `GET /api/rooms/{code}/ws?token=`. Cloud Run's request log records the full request URL, as do most
proxies, so every admission wrote a live capability into the project's logs, readable by anyone with log access and
kept for the log retention period rather than the room's lifetime.

## Decision

| Request                      | Token travels as                                                   |
| ---------------------------- | ------------------------------------------------------------------ |
| `GET /api/rooms/{code}/ice`  | `Authorization: Bearer <token>`                                    |
| `POST /api/rooms/{code}/end` | `Authorization: Bearer <token>` (unchanged)                        |
| `GET /api/rooms/{code}/ws`   | the socket's **first frame**, `{"type":"auth","token":"<64 hex>"}` |
| `POST …/results`, `/api/me…` | `Authorization` / `X-Fuse-Identity` (unchanged)                    |

No room service URL has a query string any more, and the service never reads one for a credential.

### HTTP: `Authorization`

The CORS policy already allowed it: the preflight answers `Access-Control-Allow-Headers: Content-Type, Authorization`
and echoes the exact allowed Origin with `Vary: Origin`; a foreign Origin gets `403` on the preflight too. A
cross-origin `GET /ice` now preflights where the query form did not, so the preflight also answers
`Access-Control-Max-Age: 600`. The ICE fetch keeps its 3-second bound and its fallback to the default STUN list.

### WebSocket: first frame, not `Sec-WebSocket-Protocol`

A browser cannot set headers on `new WebSocket`. The two options were the token as a subprotocol value, or an
authenticating first frame.

- **Subprotocol.** Authenticates before the upgrade, so no unauthenticated socket ever exists and the admission path is
  untouched. But the token stays in request metadata: `Sec-WebSocket-Protocol` is a header that proxies, load balancers
  and debugging middleware routinely record, which is the same class of leak one hop along. It also abuses a
  negotiation field: the server has to be offered a real protocol name beside the token and echo only that one, because
  a browser fails the handshake when the echo is missing or wrong — a failure the page cannot tell from a network drop.
- **First frame.** The token is only ever inside the (TLS-protected) message stream, like every other frame, and is
  absent from everything a request log, access log or handshake trace can see. The cost is that the service accepts an
  upgrade from a caller it has not authenticated yet, which has to be bounded.

We chose the first frame, and bound the unauthenticated socket with the S2 admission limits merged in #265 rather than
a second mechanism. What those limits do and do not bound is spelled out under [Slot holding](#slot-holding).

- The upgrade still requires an allowed Origin and a well-formed room code, and is refused with `429` before the
  upgrade when the address's hourly failure budget is spent.
- The whole handshake — upgrade, waiting for the `auth` frame, and `RoomGateway.connect` — runs inside one
  `AdmissionGate` slot. Unauthenticated sockets are therefore bounded exactly like pending admissions: 4 per address and
  128 per gateway instance; the next one gets `429` before the upgrade. The slot is released when the socket
  authenticates and is admitted, is refused, or leaves.
- The first frame must arrive within `AUTH_DEADLINE_MS` (2 s; an injected scheduler in tests). It must be a text frame
  of at most `AUTH_FRAME_MAX_BYTES` (256; the real frame is under 100) that parses to `{type:"auth", token}` with a
  64-hex token. The socket's 32 kB `maxPayload` still bounds what is buffered before that check.
- Nothing else is read first. Whatever arrives first _is_ the authentication attempt: a `time` or `signal` frame is
  never handed to the gateway, and a valid `auth` frame arriving second does not rescue the socket. After a refusal no
  further frame is read.
- Missing (deadline), late, garbage, binary, oversized or malformed auth — including a first frame `ws` itself refuses
  to parse, such as one past `maxPayload` — are all a `401` inside the gate, so each spends the address's hourly
  failure budget (30) exactly as a wrong room code does. The socket closes with `4401` (`CLOSE_UNAUTHENTICATED`).
- Leaving before authenticating frees the slot and is **not** charged and not logged. Charging it would stop nobody
  (see Slot holding) and would land on honest pages: one closed or navigated away within a round trip of the upgrade,
  a mobile tab frozen mid-connect, a network drop right after the 101.
- A refused socket is given `REFUSED_CLOSE_GRACE_MS` (3 s) to answer the close frame and is then terminated. `ws` would
  otherwise keep it for 30 s: outside the gate's count by then, but still one of Cloud Run's concurrent requests. Only
  refused sockets are cut off; an admitted socket's close handshake runs to its end, so its close code is never lost.
- A well-formed token then goes through `RoomGateway.connect` unchanged: per-room admission serialization,
  incarnation/revision fencing, membership and capacity are as before. `validSignal`, exact-origin CORS and the
  DNS-rebinding guard are untouched. Gateways stay stateless: the handshake is local to one socket.

### The deadline: 2 seconds

The client sends `auth` synchronously from the socket's `open` handler (`openRoomSocket`), so an honest frame is one
round trip behind the 101 plus however long the page's main thread takes to run that handler. 2 s covers a 1.5 s round
trip — worse than an EDGE link — with half a second of main-thread stall to spare, and a link slower than that cannot
play a 20 Hz peer-to-peer game anyway. Missing the deadline is cheap for an honest page: one charged failure and a
backed-off retry, not a lockout. The first version of this change used 5 s; every extra second is a second a slot can
be held for free, and nothing honest needs it.

### Slot holding

**The hourly failure budget does not bound how long handshake slots can be held.** Any well-formed 64-hex token is
admitted to a live room as a guest, and a successful admission is never charged. So a caller can create a room, open
its 4 sockets, stay silent until just under the deadline, send a valid `auth`, be welcomed, and repeat — indefinitely
and for free. (`socket-auth.test.ts` pins this: 32 rounds of 4 held-then-authenticated sockets, nothing charged.)
Charging sockets that leave early would not change that, which is why they are not charged.

What does bound it:

- **4 pending admissions per address, 128 per gateway instance**, `429` before the upgrade beyond that. An "address"
  is an IPv4 address or an IPv6 **/64** (`rateLimitAddress`): one IPv6 host owns a whole /64, so a per-address limit
  on full IPv6 addresses would be no limit. A v4-mapped IPv6 address counts as the IPv4 address it wraps, and input
  that is not an address shares one key. So filling one instance's 128 slots takes about 32 IPv4 addresses or 32
  IPv6 /64s (one /56), held continuously — at which point every admission on that instance gets `429` until they
  stop. That is a small number, and the design does not claim otherwise.
- **In production the platform binds first.** Cloud Run runs this service with `--concurrency=80 --max-instances=2`
  (`scripts/deploy-cloud.sh`), and every open WebSocket — players in rooms included — is one concurrent request. 160
  sockets across both instances is the real ceiling, reached before 128 pending admissions on either.
- The failure budget still bounds what it always did: wrong room codes (`404`) and bad first frames (`401`), 30 an
  hour per address, shared across instances.

**What this change adds over `main`.** `main` authenticated before the upgrade, so a slot was held only for the room
store transaction (milliseconds). A slot is now held for up to the 2 s deadline as well. The per-address and
per-instance counts are the same as on `main`; the time each can be held is what grew, and the deadline is kept as
short as an honest client allows for that reason. Pending-slot exhaustion is a denial of new admissions on one
instance, not of rooms already running: admitted sockets hold no slot, and gameplay is peer to peer.

### What is charged

| Outcome inside the gate                                    | Close  | Charged |
| ---------------------------------------------------------- | ------ | ------- |
| Deadline passed; garbage, binary, oversized, malformed     | `4401` | yes     |
| Wrong or ended room code                                   | `4004` | yes     |
| Left before authenticating                                 | —      | no      |
| Room full (`RoomFullError`)                                | `4029` | no      |
| Operational failure (store or bus unavailable, restarting) | `4000` | no      |
| Admitted                                                   | —      | no      |

A full room is not charged. The S2 budget (#265) prices _wrong guesses_: enumeration costs a charged `404` per miss.
A full room is a _right_ guess, and right guesses were never charged — an admission that succeeds confirms that a
code is live just as well, for free — so charging the full case alone protected nothing and only punished a sixth
player behind a shared address. It gets its own close code, `4029` (`CLOSE_ROOM_FULL`), which is terminal for the
page (below).

## Client behaviour

- `4401` and every other non-terminal close is retried with **exponential backoff and jitter**
  (`ReconnectBackoff`): 1.5 s doubling to a 30 s cap, each wait shortened by up to a quarter at random so pages a
  restart dropped together do not return together. A `welcome` resets it. A `429` before the upgrade is
  indistinguishable from a network drop in a browser and backs off the same way. `main` retried every 1.5 s forever.
- While the service keeps answering `4401` — the one retried close that is charged — the ladder continues to a
  5 min cap instead. A page behind a middlebox that passes the 101 but eats frames then makes about 21 attempts in
  its first hour (at most 24 with the unluckiest jitter) and about 14 an hour after, so it cannot spend its
  address's 30 failures by itself and lock out everyone else behind that NAT. With a flat 1.5 s retry and a 5 s deadline that took about three minutes.
- `4029` (room full) is **terminal**: the transport stops, reports the service's wording ("Room full (five players,
  five spectators and TV)", `ROOM_LIMITS.fullMessage`) through `terminated`, and the header shows RETRY. Retrying
  cannot free a seat.
- The player's RETRY is a page reload — a new transport with a fresh ladder — so a manual retry never waits out a
  backoff.
- A refused `/ice` request (any non-2xx) is reported in LINK DIAGNOSTICS as
  `default (service refused: status N)`, distinct from `default (service list invalid)` and
  `default (ice fetch failed)`; the fallback to the default STUN list is unchanged.

`welcome.protocol` stays `2`: every frame after `auth` is unchanged.

## Logging

The service logs `{kind, errorType, code}` for failures and nothing else: no request URL, no query string, no frame and
no token. A refused `auth` frame is not echoed in the close reason or the log. The client's error paths embed no
request URL. Invite links are built by `appUrl("?room=…")` and carry no capability, as before.

## Legacy transport removal (#763 / F-10)

The temporary acceptance window for pages predating first-frame authentication is removed from source on
2026-11-15. Production and local entry points now use the same handshake: a query parameter authenticates nothing,
and every socket starts in the `auth` phase with the usual deadline and admission limits. The legacy option,
counter, bypass and acceptance tests are deleted. This is a source change; its merge and deployment must be verified
separately before claiming the production window is closed.

### Production observation before removal

A read-only Cloud Logging query against project `andershaf-87`, service `fuse-riders-gateway`, returned **zero**
`deprecated-query-token` entries in **2026-11-07 00:00:00 UTC ≤ timestamp < 2026-11-15 11:33:40 UTC**
(8 days, 11 hours, 33 minutes, 40 seconds). Both structured JSON and text forms were checked across all revisions.
Only timestamps, revision names, event kinds and counts were requested; no request URLs or credentials were read
or copied.

```sh
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="fuse-riders-gateway" AND timestamp>="2026-11-07T00:00:00Z" AND timestamp<"2026-11-15T11:33:40Z" AND (jsonPayload.kind="deprecated-query-token" OR textPayload:"deprecated-query-token")' \
  --project=andershaf-87 --freshness=30d --limit=1000 \
  --format='json(timestamp,resource.labels.revision_name,jsonPayload.kind,jsonPayload.uses)'
```

Run the query with an account authorized to read this project's logs.

The accessible `_Default` log bucket had 30-day retention, an active lifecycle and no exclusions on its default sink.
The service was created on 2026-09-14, and a wider bounds query found an ordinary service entry on
2026-11-04T23:13:45.918731Z, before the observation interval.
An ordinary service-log bounds query over the same interval found entries from **2026-11-09T19:41:48.498535Z**
through **2026-11-15T11:33:39.010238Z**. No service entries were observed in the earlier portion; the query establishes
absence in retained logs, not uninterrupted traffic or perfect historical log delivery. The query covers more than
seven days, while ordinary service entries span only about 5 days and 16 hours; it cannot establish continuous
seven-day activity.

### Compatibility and rollback

Current clients already send their token in the first frame, so they need no page release for this removal.
A page predating that handshake must reload: a query token alone receives no welcome, and a missing or wrong first
frame closes with `4401` under the existing failure budget. Do not roll the page back before first-frame auth or
restore query-token acceptance as a compatibility workaround. The signalling frames after authentication and
`welcome.protocol` remain unchanged.
