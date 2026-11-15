# Native Classic bot controller

Fusero's previous bot policy chooses keyboard bits using Fuse-specific heuristics.
It does not reproduce the OpenLieroX Classic solo game. Replace it with the pinned
`CWormBotInputHandler` implementation at
`0a20c6d0a10ed63b28a15f05c771913c294efbf6`.

## Input and simulation

Human keyboard handling and native AI are separate producers of Classic controls.
Both feed the same carving, rope, motion, weapons and projectile kernels. The AI
may set the native input fields (angle, facing, selected weapon) and invoke ordinary
rope launch/clear actions, in source order. It may not alter position, velocity,
health, collisions or damage. In particular, bot jump does not clear the rope;
the human input handler deliberately does. Bot aim uses the source's 100 degrees
per second rather than keyboard aim acceleration.

Resolve AI when the 11 ms client physics pulse samples that worm, in stable seat
order. Preserve the 400 ms spawn delay, native difficulty, arsenal presets,
targeting, traces, navigation, shooting decisions and source quirks. The bot's
memory, timers, path and random decisions are authoritative checkpoint state.
Shared static aim/ballistic random samples become world state, rather than one
copy per bot or mutable module globals. Use the existing checkpointed match RNG;
the port already replaces platform-specific C `rand()` with that seeded stream.

## Path search scheduling

Port the original rectangle A* algorithm, seven-pixel passage checks, five-pixel
boundary sampling, float/integer arithmetic, path simplification and 50-pixel
segment splitting. Dirt is traversable for planning; rock is an obstacle.

The original worker sleeps 100 ms when idle and at least 1 ms per expanded area.
Its OS-dependent publication time and concurrent terrain reads cannot be replayed
by independent browsers. Use a documented deterministic worker schedule: begin
after the 100 ms idle interval and expand at most one area per simulated
millisecond, publishing at an outer-frame boundary. Checkpoint its frontier,
areas, parent links, timing and pending request. This changes scheduling, not the
search algorithm or tactical constants. Do not claim bit-identical native thread
timing. Bound recovery input and search storage, with explicit failed searches if
a supported resource limit is reached.

## Verification

Compare geometry/path and tactical decisions against independently compiled C++
source extracts, retaining source references. Exercise native preset selection,
spawn/respawn, jump with attached rope, aim, carving, shooting and navigation.
Replay and checkpoint/restore during both active searches and combat must converge.
Then play the actual original and Fusero, and run the multiplayer browser flow.
Passing unit tests alone does not establish that the complete game feels the same.
