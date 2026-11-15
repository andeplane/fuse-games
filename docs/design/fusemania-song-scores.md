# Fusemania song scores

Song highscores use the existing first-party event database and its memory/Firestore
adapters. They are gameplay records, separate from anonymous, optional analytics.
Public reads expose names, score percentages and dates, never account IDs or input logs.

The server issues a random, account-bound ticket before play. The browser records
every local press/release with its stamped song time and applying tick, then submits
only after the result is confirmed. The server replays its own shipped chart through
the normal engine in Score mode, computes the score and checks it agrees with the
reported result. Battle, custom files, bots, spectators, late joins and recovered or
overflowing input logs cannot contribute. Device scroll/timing preferences continue
to work; no engine rules or simulation timing change.

An accepted `fuse.Song Completed` event in `${prefix}-telemetry-song-runs` contains
song ID, difficulty, SHA-256 of song ID/source/scoring rules, verified rating and
percentage, completion time, account ownership and input evidence. Evidence expires
after 90 days, using the existing `cleanupAt` TTL adapter. The same transaction stores
the durable account/chart best in `telemetry-song-bests` and a top-100 projection in
`telemetry-song-boards`. These projections have no expiry. All collections are
server-only under the existing Firestore deny-all browser rules. The read API uses
only bounded known-chart document reads; it does not scan raw events. Ties retain the
earlier result, then sort by stable account ID internally. New chart versions have
new boards; old numeric bests cannot be safely migrated without replay evidence.

Tickets expire after an hour. Each account has one active ticket; a newer start
replaces the previous attempt across service instances. Submission checks ownership,
elapsed song duration and bounded, ordered input data, with account/address quotas
and bounded concurrent admission. A completed ticket is immutable and retries return
its original result. Ticket, completion event and both projections settle atomically.
The existing `TELEMETRY_RATE_LIMIT_KEY` supplies cross-instance quota hashing; without
it score routes return 503 while other game APIs remain available.

This proves that a score follows from a valid input sequence on the canonical chart.
It cannot prove a human pressed the keys: modified browsers and bots can fabricate
plausible inputs or wait out a song. Live server receipt checkpoints or anomaly
review could raise that cost later; neither should be described as proof of humanity.
No always-running simulation or gameplay relay is introduced.

Every displayed song score is a percentage, with two decimals truncated so a
non-perfect score never rounds to 100%. Internal integer millionths and ranking
rules stay unchanged. A session's percentage divides summed song ratings by the
selected song count, so 100% means a perfect complete playlist, including for late
arrivals. Differences between percentages are shown on the same scale.

The main menu's **Song highscores** page lists every bundled song and its Easy,
Medium, Hard and Challenge leader. Empty charts have blank cells with accessible
links to their empty leaderboard. Search filters titles; each chart opens up to 100
ranked players. Loading, unavailable service and failed leaderboard requests have
visible states and retry controls. Local browser bests remain available offline and
are versioned separately; they are never uploaded as verified records.

Songs are grouped by pack. Title and all four difficulty-score columns sort within
each pack; unplayed charts stay last in either score direction. Player names open
the shared activity view. A playlist has a stable parent match and one numbered
round per completed song; its summary appears only when all selected songs finish.
The activity percentage divides the aggregate by the selected playlist length.
Ordinary reported results do not update the replay-verified song leaderboard.
