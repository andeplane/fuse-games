# Native Classic bot controller

Fusero replaces its previous keyboard-bit heuristics with the Classic branches of
the pinned `CWormBotInputHandler` implementation at
`0a20c6d0a10ed63b28a15f05c771913c294efbf6`.

The live controller is split into state, targeting, combat and navigation modules.
It retains the Classic DeathMatch/local-listen profile; unrelated Gusanos,
Modern Warfare and CTF branches are outside this game.

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

Native `tLX->currentTime` is an absolute application clock after menus, whereas
default `AbsTime()` fields are zero. Fusero defines a prepared-match epoch of
1000 ms plus elapsed simulation time. Initial cooldown/noise sentinels therefore
expire, while the spawn timestamp retains the full 400 ms delay. Jump's separate
wall-clock read uses this same deterministic clock. This is a declared canonical
session, not every possible duration spent in native menus.

Preserve `SIGN(GetRandomNum())` macro evaluation: a nonpositive first sign draw
evaluates the RNG again. Native `AI_SimpleMove` places x/y RNG calls in C++
constructor arguments, whose order is unspecified; this port pins lexical x then
y order. These choices participate in checkpoints and replay.

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

Ordinary starts and forced restarts retain distinct pending-restart state, even
before initialization. An idle worker retains its scheduled wake on restart;
an active initialized worker restarts after one simulated millisecond. Active
checkpoint deadlines may be at most nine milliseconds behind the outer clock,
bounding catch-up after restoration. Search storage and complete paths are each
bounded to 8192 entries. Checkpoints encode graph points/areas compactly and
validate parent cycles, frontier order, clocks and bot-seat ownership before
installing a candidate. Presentation views exclude the graph and shared noise.

## Verification

Compare geometry/path and tactical decisions against independently compiled C++
source extracts, retaining source references. Exercise native preset selection,
spawn/respawn, jump with attached rope, aim, carving, shooting and navigation.
Replay and checkpoint/restore during both active searches and combat must converge.
Then play the actual original and Fusero, and run the multiplayer browser flow.
Passing unit tests alone does not establish that the complete game feels the same.

`classic-native-ai.test.ts` compares geometry and complete paths against native
C++ on the four retained maps. `classic-ai-tactical.test.ts` compares 690 aim,
weapon-choice and shooting cases, including all 38 weapons and final RNG state.
The generators pin upstream Git blob digests. `classic-bots.test.ts` covers active
search recovery, deterministic continuation, source control intent and respawn.
`scripts/fusero-ai-smoke.ts` exercises a bot with two humans and a shared TV,
including phone/TV reloads. `scripts/fusero-ai-benchmark.ts` reports six minutes of
five-bot play per native map, checking encoded snapshot size and validity; retain
its measured output and source revision with any performance claim.
