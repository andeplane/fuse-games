# Street Rod 2 picture and roadside-shape audit

[inventory.tsv](inventory.tsv) lists all 299 picture-directory entries and all 26 span-shape sets in the supplied March 1991 PC build. Every picture has a traced functional role and every shape set has a known renderer call site.

| Source         | Records | Runtime IDs | Evidence                                                                                   |
| -------------- | ------: | ----------- | ------------------------------------------------------------------------------------------ |
| LIB1 and LIB1C |       4 | 1–4         | Title, pointer, publisher and credits.                                                     |
| LIB2 and LIB2C |     212 | 1000–1211   | Garage, models, parts, portraits, town, menus and ending.                                  |
| LIB3 and LIB3C |      83 | 2000–2082   | Cockpit, rivals, police, road scene, race events and results.                              |
| SR2_SHP        |      26 | 0–25        | 23 ordinary sets with distance levels, then three aqueduct sets using roll-angle variants. |

The EGA and CGA directory entries share indices and mask flags. Each TSV row includes both modes' measured dimensions and packed sizes. The LIB2 mask column has 172 values of 1, one value of 2 (picture 1112) and 39 zeros. The role of that unusual mask value in the renderer remains unverified. The ordinary and grouped span headers cover the entire 42,742-byte shape file.

## Interpreting the assignments

A `role` row names how a call site or a typed source table uses the record. A `visual` row adds local inspection of the source graphics in the race palette. Roles can be shared; the engine reuses pictures among models, and a single sheet can serve several animation stages. Resolving a starter distance variant, for example, establishes why the picture is loaded without establishing what pose it depicts.

The owner column points to the Fuse module handling that role. Bare art filenames are relative to `games/fuserod/src/art/`. Other module paths are relative to `games/fuserod/src/`. A linked module can be a scene illustration or interface that serves several reference records. A link alone gives no evidence of a distinct replacement for each original frame.

Evidence labels such as `race_opp.c:28-32` refer to the game sources under `sr2port/src/game/` at [the pinned SDL3 revision](https://github.com/kylofon/street-rod-2-sdl3/tree/9a3d488143d108985422c2eeb9501e4aa5a0fe72/sr2port/src/game). Short Markdown filenames refer to the [pinned reference studies](https://github.com/kylofon/street-rod-2-sdl3/tree/9a3d488143d108985422c2eeb9501e4aa5a0fe72/port/spec). For sets 0–19 the sequel study preserves the original type numbers and identifies their uses. The inherited descriptions are cross-referenced to the [first game's shape catalogue](https://github.com/kylofon/street-rod-sdl3/blob/0e5598e4fb45735b7c611a41b3595c91f16c3fa8/port/spec/race_render.md#54-road-side-shapes-hline-sprites). Local inspection of the sequel supersedes those inherited labels for sets 7 and 8.

## Fuse art coverage and remaining checks

The ledger maps **299 of 299 picture records and 26 of 26 shape sets** to a Fuse art or interface role. We checked the original art in `a8475524` and its application call sites in the integration checkout. A shared replacement, such as the Fuserod title illustration for the publisher card, counts once for each source role it serves. This tally measures functional coverage. Individual poses, animation frames and visual legibility still need direct comparison during play.

- The app loads the CSS cursor. The attract screen draws the title, the menu draws credits, and the garage selects the licence/logbook and jail scenes. Race results select the patrol ticket or wreck illustration. The race renderer draws fractured glass for a wrecked cockpit. These call sites cover the 21 picture roles left open in the first audit.
- The road renderer calls `furniture`, `routeBanner` and `trafficProp` for trees, hydrants, signs, barricades, and debris. It selects chevrons and winding-road warnings using the signed bend. The canyon's secondary road hazard and two distinct vegetation silhouettes are catalogued below.
- Model and angle tables identify 22 garage models and six traffic/police appearance groups. A complete visual check needs every body/roof/scoop/bumper combination that the player can actually select, opponent front/side/three-quarter/rear views, shrink steps, and aqueduct angles. Five illustrated rivals or one painted body do not establish all model/portrait variants.
- A picture record is not a frame count. The supplied `SR2_END` describes 84 sprite rectangles from picture 1181. All 84 are used across 182 commands before the terminator. The drive-in carhop alone uses two sheets (1113/1114) with 11 and 10 frames. The check still needed is a comparison by _displayed state_ for dashboards, tyre and tool operations, the starter, pump, drive-in, endings, and their animation transitions. The inventory does not count those sheets as completed animations.

## Private visual inspection of the canyon shapes

For sets 7, 8 and 20–22 we decoded the signed horizontal spans of each distance variant, applied the supplied race palette at `DS:1DC8`, then inspected the largest silhouettes locally. The dimensions below are the occupied pixel bounds. The game draws 20 on the road and tests it against the wheels, while 21 and 22 appear beyond the road edges. The executable gives them numerical identifiers. The material of the road hazard and the species of the plants remain uncertain. [DOS shape drawing](https://github.com/kylofon/street-rod-2-sdl3/blob/9a3d488143d108985422c2eeb9501e4aa5a0fe72/sr2port/src/game/race_gfx.c#L405-L431) · [Race palette selection](https://github.com/kylofon/street-rod-2-sdl3/blob/9a3d488143d108985422c2eeb9501e4aa5a0fe72/sr2port/src/game/race_drive.c#L72-L80)

| Set | Largest variant | Visible subject                                                                                        |
| --- | --------------- | ------------------------------------------------------------------------------------------------------ |
| 7   | 18 × 9          | Single grey rock with a lit upper edge. The road renderer also uses it as a collision object.          |
| 8   | 28 × 12         | A group of overlapping grey rocks. The roadside cluster routine combines sets 7 and 8.                 |
| 20  | 40 × 10         | Low, ragged grey road patch with a dark far rim and a light near edge. The shading suggests a pothole. |
| 21  | 53 × 20         | Wide spreading green foliage above exposed, branching brown wood.                                      |
| 22  | 33 × 24         | A compact domed green crown with a short brown trunk.                                                  |

## Reproduce offline

Use Python 3, a local DOS game folder, and a checkout of the pinned reference listed above. The directory reader reads only index headers. The span walker checks header counts and seeks past drawing payloads. The generator reads model, overlay and person references, executable data tables, and literal calls in the pinned C source. Its output contains metadata and code references only. Keep the unpacked image outside the project.

```sh
python3 /path/to/street-rod-2-sdl3/tools/unexepack.py /path/to/sr2pc/SR.EXE /tmp/SR2-unpacked.exe
python3 games/fuserod/tools/sprites/inventory.py /path/to/sr2pc /path/to/street-rod-2-sdl3 /tmp/SR2-unpacked.exe --check
```

The default prints the TSV to stdout. The check verifies the supplied executable and unpacked image hashes, the reference revision, both graphics-library directories and shapes, then compares the output to the checked-in TSV. It runs without a window or network access.
