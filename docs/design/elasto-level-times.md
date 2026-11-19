# Elasto Fuse level leaderboards

The landing menu opens a public board for each level. Only signed-in solo finishes from the current rules version can earn a row. Room standings and offline personal bests use their existing records.

The solo runtime sends the held-input changes and the step where the race ended. The gateway replays the run through the same engine, requires a finish at that step, and derives the finishing run time. Replay proves a finish under the game's physics. It also accepts a valid input sequence generated with tools.

The gateway limits request size, replay length, concurrent requests and submit quotas before replaying. Each level and rules version has a bounded top-100 document. A transaction checks and updates the fastest time for each account in that document. Reads use direct document lookups and require no new indexes. A rules bump starts a fresh board.
