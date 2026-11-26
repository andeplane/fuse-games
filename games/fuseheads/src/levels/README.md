# Deluxe level resources

The two supplied StuffIt files have the same SHA-256, `31866dfc5a14fa427553e8c276d5f2c86f6fd4cc340e0ce508c7197599ba5b7b`. The reader consumes the Mac resource forks extracted with `unar -forks visible`. From this directory, regenerate and verify the data with:

```sh
python3 import-levels.py "/path/to/Bonkheads Deluxe"
pnpm exec prettier --write campaign.json
uv run --with unicorn==2.1.4 verify-map-setup.py "/path/to/Bonkheads Deluxe"
```

The verifier executes the shipped 68000 map copy and floor fill at CODE 2 offsets `0x14e90..0x14eee` in Unicorn and compares its output to the TypeScript API, including every cell of all 144 original rounds, 54 bonus rounds and the finale. The combined SHA-256 of those 119,400 signed big-endian words is `03d2bf91e2e527378ae70f3fb4c06d18b02a7c172d466ab099a46881d9c1ce99`. This comparison stops before the game sets up directional collisions, cooperative-only gems and the TNT box.

## Campaign records

- `MLST` links underworlds beginning at resource 128. Its first five entries select maps. The next five after the background ID select pest schedules. The sixth round uses a separate ruler record and map. For original maps 139–144, `PreFinaleLoadLevelInfo` reads the ruler map from byte offset 52 for each round. After victory, `DoGrandFinale` loads the separate map 15000 from the shared data fork for a scripted ending.
- `BKMP` has 20 columns by 30 rows of signed 16-bit tile IDs in column order. Each cell is 32 by 16 screen pixels. `MapSetup` writes these to a working map with a 35-word column stride and sets the bottom four rows to 2. Fuse exposes row-major cells. Coordinates in `spawns` and pest entries are top-left sprite positions.
- `ENDT` starts with an unsigned count followed by 26-byte pest entries. The species IDs are 7 bulldog, 15 raccoon, 19 demon, 23 killer bee, 27 cobra, 52 baby raptor and 56 spider. Word 1 is temper, word 3 is signed initial speed, word 7 is kick score, word 8 is spacing after the previous spawn, and words 9–12 give the two possible entry positions. `BOSS` contains 15 signed words. The editor's ruler dialog uses word 1 for species, 4 for hit points, 5 for species-specific difficulty and 11–13 for extra attacks and their difficulty.
- Surfaceville 1 uses original map 1, background 900 and platform 2000. Its ten bulldog spacings are 10, 150, 150, 150, 170, 150, 150, 150, 140 and 150 source ticks. Each is worth 100 points. `MLST` bytes 28 and 30 are tire and bat frequencies. The source computes a nonzero frequency's interval as `250 + 13 * (101 - frequency)`. Zero disables that hazard.

## Tile behavior in the shipped code

These are static interpretations of CODE 2's `ScreenLayoutSetup`, `Player1Processor`, `SetBlockInMotion`, `JewelGrabPlayer1` and `POW`, cross-checked against the Bonkreator editor and the bundled help. The map comparison above does not execute these effects.

| Stored tile | Meaning                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| −1, 0       | Hologram with ordinary platform graphics, empty space                                                                           |
| 1, 2, 3     | Occupied continuation cell, immovable floor/block, ordinary bonkable platform                                                   |
| 4–9         | Quicksand, spring, superspring, magnet, movable block, web                                                                      |
| 11–16       | Ordinary-looking platforms containing Adrenalide, Tranquilium, Densidian, Moolamite, Resurrectite and Blastidian, respectively  |
| 17–22       | Counterparts to 11–16. `ScreenLayoutSetup` subtracts six when both players are present. Otherwise these become ordinary type 3. |
| 23          | Kryptoleum. Initial setup converts it to pickup type 17. It activates the player's shield.                                      |
| 24–26       | Spikes, slippery block, timed explosive                                                                                         |
| 27–28       | Ordinary-looking platforms concealing Prickly Pear and P. Yote                                                                  |
| 50, 51      | Left and right parts of a single 64×32 TNT box. Two type-1 cells complete its footprint.                                        |

Types 23–28 occur only in the bonus maps in these archives. A direct bonk releases a hidden pickup once and replaces its tile with 3. Moolamite awards 5,000 points and Resurrectite one life. Blastidian restores one TNT charge up to three when the box site is clear. Spending the last charge clears the entire 2×2 box footprint. The blast knocks out active grounded pests and awakens stunned grounded pests. It also drives off Bat Tee. The `POW` routine checks terrain directly at the creature's feet.
