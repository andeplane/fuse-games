# Fuse Drivers native racing engine

Fuse Drivers runs a TypeScript reconstruction of the 1990 DOS racing simulation in the existing Fuse room. Solo play, desktop clients, phone controllers and the TV share the same authoritative input fold. Start at Sidewinder or select Wipeout to race the circuit in the reference screenshot.

## Reference implementation

The reference GAME.EXE has SHA-256 `a67ba31b021ed53d2d033cbe67ecb32a4537bf20593392bcf4ba85d3fd67836c`. For gameplay segment 0000, add 0x400 to an instruction offset to find its file offset. The supplied executable, disassembly, decompiler output and decoded artwork stay outside this repository.

| Subsystem                                      | Original location         | Native source                    |
| ---------------------------------------------- | ------------------------- | -------------------------------- |
| Truck update, throttle, nitro and translation  | CS:152c, 1769, 17a1, 1871 | `src/game/offroad/motion.ts`     |
| Four wheel contacts, suspension and body pose  | CS:18df, 1c8b, 1d73       | `src/game/offroad/suspension.ts` |
| Track contour grids and facet lookup           | File 0x229b and 0x1d0a    | `src/game/offroad/terrain.ts`    |
| Pair contacts and velocity transfer            | CS:169d                   | `src/game/offroad/motion.ts`     |
| Lap regions, progress and isometric projection | File 0x235a and 0x1a5f    | `src/game/offroad/course.ts`     |
| CPU route interpreter                          | CS:2189, 21f3             | `src/game/offroad/cpu.ts`        |
| Cash bags and nitro pickups                    | CS:0508, 056e             | `src/game/offroad/pickups.ts`    |

The measurement scripts in `scripts/fuse-drivers-*` read a supplied local copy. Committed course data describes the functional contact surfaces, routes and gates for eight circuits in both directions. The default renderer draws its own dirt, banks and barriers from the physics surfaces.

## Timing and multiplayer

Rules version `fuse-drivers-5` identifies the new simulation contract. A room runs seven physics updates per six 50 ms log ticks, corresponding to one DOS update per three nominal 70 Hz VGA retraces. The presenter interpolates between updates. Every wheel, both headings, the CPU program counter, pickups and the shared random state travel in validated snapshots. Each peer uses the same simulation for replay and local prediction.

The original grid has four trucks. Fuse adds a fifth start position for five-driver rooms. Hardware retrace jitter, physical input latency and the network transport are outside the DOS instruction comparisons.

## Verification

The reference checks execute the original 16-bit instructions with controlled registers and memory. The terrain check covers 61,952 probes. Lap progress checks cover 50,072 region positions. Truck checks exercise scripted inputs at all 64 original starting positions across the sixteen directions. Integrated race checks compare the vehicles on each update, including stock, heading, momentum, coordinates, lap and region.

Across 18 four-truck races, all 1,026,216 sampled vehicle fields matched through the winning finish. The traces cover every course direction and include races with one and two independent human input streams. Final standings, wallets, earnings and remaining nitro matched for all 72 grid entries.

Run `pnpm exec tsx --test games/fuse-drivers/tests/*.test.ts` for the engine and room tests. Run `OFFROAD_CAMPAIGN_SMOKE=1 ONLINE_URL=http://localhost:PORT/ pnpm exec tsx scripts/fuse-drivers-smoke.ts` against the local room service for a multiplayer race, purchase and reconnect.
