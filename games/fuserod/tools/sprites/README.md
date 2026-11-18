# Street Rod 2 picture and roadside-shape audit

[inventory.tsv](inventory.tsv) lists all 299 picture-directory entries and all 26 span-shape sets in the supplied March 1991 PC build. Every picture has an evidenced functional role. All shape sets have an identified consumer. The exact subjects drawn by canyon sets **20, 21 and 22** remain unresolved. The Dos build uses set 20 for a second collision object and chooses 21/22 for different roadside flags. It uses set 7 for the small rock hazard as well as shrubbery.

| Source         | Records | Runtime IDs | Evidence                                                                                   |
| -------------- | ------: | ----------- | ------------------------------------------------------------------------------------------ |
| LIB1 and LIB1C |       4 | 1–4         | Title, pointer, publisher and credits.                                                     |
| LIB2 and LIB2C |     212 | 1000–1211   | Garage, models, parts, portraits, town, menus and ending.                                  |
| LIB3 and LIB3C |      83 | 2000–2082   | Cockpit, rivals, police, road scene, race events and results.                              |
| SR2_SHP        |      26 | 0–25        | 23 ordinary sets with distance levels, then three aqueduct sets using roll-angle variants. |

The EGA and CGA directory entries share indices and mask flags. Each TSV row includes both modes' measured dimensions and packed sizes. The LIB2 mask column has 172 values of 1, one value of 2 (picture 1112) and 39 zeros. The role of that unusual mask value in the renderer remains unverified. The ordinary and grouped span headers cover the entire 42,742-byte shape file.

## Interpreting the assignments

A `role` row names how a call site or a typed source table uses the record. A `consumer` row identifies the source consumer while leaving the pictured subject open. Roles can be shared; the engine reuses pictures among models, and a single sheet can serve several animation stages. Resolving a starter distance variant, for example, establishes why the picture is loaded without establishing what pose it depicts.

The owner column points to the Fuse module handling that role. Bare art filenames are relative to `games/fuserod/src/art/`. Other module paths are relative to `games/fuserod/src/`. A linked module can be a scene illustration or interface that serves several reference records. A link alone gives no evidence of a distinct replacement for each original frame.

Evidence labels such as `race_opp.c:28-32` refer to the game sources under `sr2port/src/game/` at [the pinned SDL3 revision](https://github.com/kylofon/street-rod-2-sdl3/tree/9a3d488143d108985422c2eeb9501e4aa5a0fe72/sr2port/src/game). Short Markdown filenames refer to the [pinned reference studies](https://github.com/kylofon/street-rod-2-sdl3/tree/9a3d488143d108985422c2eeb9501e4aa5a0fe72/port/spec). For sets 0–19 the sequel study preserves the original type numbers and identifies their uses. The inherited descriptions are cross-referenced to the [first game's shape catalogue](https://github.com/kylofon/street-rod-sdl3/blob/0e5598e4fb45735b7c611a41b3595c91f16c3fa8/port/spec/race_render.md#54-road-side-shapes-hline-sprites). Some span counts differ between editions. This audit did not render either game's pixels.

## Outstanding visual coverage

At the initial Fuse art audit, commit `a25feb14`, **278 picture records and 15 shape sets have an analogous Fuse module**. These matches establish role coverage. No row has a one-for-one, frame-by-frame visual acceptance result.

- The 21 picture rows without an equivalent are IDs 2–4 (pointer, publisher, credits), 1001–1006 (licence and save/book controls), 1153–1155 (jail artwork), 2009 and 2051 (ticket scene), and 2048, 2052–2054 and 2064–2066 (crash cockpit and fractured glass).
- Shape sets 2, 12–14, 16–22 have no specific artwork assignment at that revision. These cover the hydrant, overhead signs, curve signs, secondary obstacle, and canyon scenery. Sets 20–22 additionally need subject identification.
- Model and angle tables identify 22 garage models and six traffic/police appearance groups. A complete visual check needs every body/roof/scoop/bumper combination that the player can actually select, opponent front/side/three-quarter/rear views, shrink steps, and aqueduct angles. Five illustrated rivals or one painted body do not establish all model/portrait variants.
- A picture record is not a frame count. The supplied `SR2_END` describes 84 sprite rectangles from picture 1181. All 84 are used across 182 commands before the terminator. The drive-in carhop alone uses two sheets (1113/1114) with 11 and 10 frames. The check still needed is a comparison by _displayed state_ for dashboards, tyre and tool operations, the starter, pump, drive-in, endings, and their animation transitions. The inventory does not count those sheets as completed animations.

## Reproduce offline

Use Python 3, a local DOS game folder, and a checkout of the pinned reference listed above. The directory reader reads only index headers. The span walker checks header counts and seeks past drawing payloads. The generator reads model, overlay and person references, executable data tables, and literal calls in the pinned C source. Its output contains metadata and code references only. Keep the unpacked image outside the project.

```sh
python3 /path/to/street-rod-2-sdl3/tools/unexepack.py /path/to/sr2pc/SR.EXE /tmp/SR2-unpacked.exe
python3 games/fuserod/tools/sprites/inventory.py /path/to/sr2pc /path/to/street-rod-2-sdl3 /tmp/SR2-unpacked.exe --check
```

The default prints the TSV to stdout. The check verifies the supplied executable and unpacked image hashes, the reference revision, both graphics-library directories and shapes, then compares the output to the checked-in TSV. It runs without a window or network access.
