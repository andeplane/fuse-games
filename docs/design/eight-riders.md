# Eight riders, and an arena that grows past six

Status: implemented in rules `fuse-p2p-59`.

## What players see

A Fuse Riders room seats up to eight riders. With seven or eight riders in a round, the arena is bigger: each rider has the floor six riders have on the standard 1600 × 900 board. With six or fewer, nothing changes. Solo and local play still fill with AI up to six riders. More people on one screen all ride, up to eight, with no AI beside them.

| Riders in the round | Arena       | Floor per rider |
| ------------------- | ----------- | --------------- |
| 2–6                 | 1600 × 900  | 240,000 at six  |
| 7                   | 1728 × 972  | 239,945         |
| 8                   | 1848 × 1040 | 240,240         |

## Rules

- The size is chosen at each round's start from the riders taking part (`arenaSize` in `engine/tuning.ts`) and kept for the whole round, whoever leaves. It lives in `GameState.width` / `height`, which everything in the engine already read, so spawns, scenery, pickups, black holes and the walls follow it. The renderer resizes to the snapshot's size.
- The sizes are a table rather than a square root, so every replica and the checkpoint guard agree on them exactly. The guard admits only those three boards (`isArenaSize`).
- Overtime brings the walls in at `0.5 × height / 900` units a tick (`overtimeInsetPerTick`), so a grown arena has closed the same share of its field by the round's draw tick.
- The trains map's rail grid (`RAIL_GRID`) is drawn for the standard board. A grown arena lays the railway there, with spawn corridors moved into that frame, and centres it (`shiftRailway`).

## Why grow the arena

We ran 100 seeded bots-only first rounds per setup, with combat and pickups on, capped at 60 s:

| Setup                 | Median round | Mean survival | Crashed in first 10 s |
| --------------------- | ------------ | ------------- | --------------------- |
| 6 riders, 1600 × 900  | 40 s         | 24.2 s        | 4.8 %                 |
| 8 riders, 1600 × 900  | 41 s         | 21.9 s        | 10.1 %                |
| 8 riders, 1848 × 1039 | 51 s         | 25.3 s        | 6.0 %                 |

At eight riders the standard board doubles the early crashes. The grown board brings them and survival back to six-rider levels. Rounds run about 10 s longer, before overtime's faster walls are counted. Bomb kills in the first 3 s were more common on the grown board (69 of 100 rounds against 39 at six). Spawn gaps (193 to 252 units) are all inside the bomb's 100–400 range, so this is unexplained bot behaviour and worth watching in human playtests.

## Limits it moved

- `MAX_PLAYERS` is 8 and `leaderboard.ts` ranks up to 8. The combat record has eight places and still reads five- and six-place records.
- Two more AI names (Volt, Quark).
- `MAX_RATED_PLAYERS` is 8.
- The room service admits 8 riders, 5 spectators and a TV.
- Eight riders at the trail cap encode to about 3 MB (six did to about 2.2 MB). The checkpoint, snapshot and message caps are 3.4 MB, and the snapshot buffer limit is 4.8 MB.
- A full room is 28 direct links between peers instead of 15. Real Wi-Fi with eight phones has not been qualified yet (#5).
