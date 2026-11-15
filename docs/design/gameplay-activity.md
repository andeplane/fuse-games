# Shared gameplay activity

Gameplay history is a platform capability for every game, distinct from optional,
anonymous product analytics. Existing match/round reports remain the canonical
peer-agreed source. Fusemania's canonical input replay remains the source for
verified song scores. Accepted history reports publish a common public activity
contract. A game may also keep specialized projections such as per-song/difficulty
highscores without owning a separate player-history UI. Fusemania's replay evidence
is private and its leaderboard is independent of ordinary reported history.

## Records and hierarchy

A public activity is one **match** summary or one **round** result, keyed by an
idempotent server-selected ID. It contains the stable game ID, an opaque parent
group ID, kind, round number when applicable, server completion time, trusted
solo/multiplayer classification, public participant IDs/names and bounded result
details. A match with three rounds yields three round activities and one match
summary. Round results remain visible before a longer match finishes. An unfinished
match does not invent a completed summary.

New history reports get their group scope from the admitted room incarnation and
match ID; solo admission scopes it to the verified account. Never join records by
raw match ID or room code alone. Legacy records with no trustworthy mode or group
retain **unknown** classification; migration must not guess. Public responses omit
account UIDs, room codes, capabilities and input evidence.

## Storage and queries

A separate, bounded activity projection is written in the same transaction as the
accepted source record. Existing round receipts do not become career matches and
do not alter Elo settlement, totals or the old match feed's meaning. Late account
links refresh the projection atomically. Duplicate submissions update the same
event; they do not add activity entries. Retention follows the owning source.

The shared store supports everyone, the authenticated account, or any public player;
all games or a selected game; matches, rounds or both; and solo/multiplayer filters.
Pagination orders on completion time plus event ID to retain ties. Group/detail
reads are bounded and use opaque IDs. Queries use explicit projections/indexes,
never scans over raw telemetry or browser-local storage.

## Trust and game ownership

Peer agreement, signed-in solo reports and server replay are different evidence
levels. The UI must preserve that distinction. Ordinary reported stats must never
update Fusemania's verified song highscores. Game registrations own their result
schemas and optional context (song/chart, map/level, lap, etc.); the platform owns
identity, grouping, validation, access, pagination, retention and presentation.
The browser cannot manufacture an authoritative activity by posting an analytics
event. Server replay proves consistency with a chart, not human input.

## Shared UI and adoption

Use the existing shared account/history surfaces for global, own and player feeds,
with mode and match/round filters and linked result details. Player names in
leaderboards open this same activity view. Fusemania retains a song-pack-grouped
table with sortable title/difficulty-score columns; selecting a player opens shared
activity, while selecting a chart score opens its specialized leaderboard.

Existing reporting games gain activity through the common settlement adapter.
Games without outcome reporting need explicit adapters; an empty feed is not proof
that those games report. Track actual reporting coverage and test solo/multiplayer
adoption rather than claiming universal coverage from a shared API alone.

The current 20 registered games report completed outcomes through this shared
projection. Riders, Pig, Drivers, Birds, Fuseball, Volley, Killer, Elasto, Lane,
Surge and Fusemania keep their existing game-specific statistics and rating rules.
Ball Bros, Hook Havok, Axe, Bombers, Choppers, Craft, Freight, Front and Graveyard
explicitly use history-only registrations: recording results does not enable Elo.
The new-game scaffold copies Pig and inherits its reporting integration.

Round units remain game-owned: a song in Fusemania, a stage in cooperative Axe, a
full battle in Birds, a race in Drivers and a configured run in Elasto. Fusemania
playlists retain one parent ID across song selection; three completed songs yield
three round records and one playlist summary. Axe's cooperative stages and run
summary do not invent an individual winner.

Lane's single-human local mode is supported; local pass-and-play with several
humans requires a separate admission contract and is not relabeled as solo.
Birds practice and Hook free play have no completed competitive outcome. Spectators
and Craft watch mode do not report. Front attributes each slot's result to its
controller at match end, labels that explicitly, and does not claim whole-match
participation for departed controllers.

Recently completed immutable receipts survive lobby/rematch transitions in bounded
checkpoint history until confirmation can reach them. The shared transport only
sends results from the rollback-closed prefix, retries temporary refusals and can
drain confirmation plus first HTTP attempts for up to three seconds on ordinary
Back navigation. Forced unload or losing the browser process still cannot guarantee
delivery; an acknowledged API response is the evidence of storage.

## Existing records and rollout

New accepted reports populate activity immediately. Existing stored history can be
projected with `scripts/backfill-activity.ts`: dry-run is the default; `--write`
creates missing projections only after re-reading the source in a transaction.
`--page-size` (maximum 400), `--after` and `--max-pages` bound and resume the work.
Use the existing `ROOM_COLLECTION_PREFIX`, `GOOGLE_CLOUD_PROJECT` and
`FIRESTORE_DATABASE_ID` settings. The utility changes no source matches, ratings
or career totals. It skips expired or invalid records and does not reconstruct
missing historical relationships or guess solo status. It has not been run against
production as part of implementation.

Deploy the activity indexes before enabling Firestore reads. Frozen completion
metadata changes checkpoint compatibility for newly adapted games; their network
rules identifiers change so mixed versions refuse to share a simulation. Physics
and scoring rules remain unchanged. The older whole-match UI stays available for
its richer game-specific recaps and existing history while activity supplies the
shared cross-game navigation.
