# Fuserod graphics

## What the supplied DOS build draws

I inspected the files accompanying `SR.EXE` (SHA-256 `d763bd13be07b2ef457b5982f26316a8d71470d73beeb4eee7c6c1e1fef72d96`). Reading each little-endian directory count followed by 28-byte records produced the inventory below. All recorded picture ranges fit their library. Each library ends one byte after the final recorded picture. The CGA alternatives contain the same picture counts and mask flags.

| Library | Pictures | Masked |    Depth | CGA alternative |
| ------- | -------: | -----: | -------: | --------------: |
| LIB1    |        4 |      1 | 4 planes |        2 planes |
| LIB2    |      212 |    174 | 4 planes |        2 planes |
| LIB3    |       83 |     54 | 4 planes |        2 planes |

These 299 directory entries include screens, component overlays and UI pieces as well as sprites. Each 28-byte record describes dimensions, plane count, masking, sixteen compression tokens, payload offset and packed length. The reference format study identifies a table for 22 model-specific groups of roof, scoop and bumper overlays, and six groups of opponent/police views with separate shrink masks. See the [independent format study at the inspected revision](https://github.com/kylofon/street-rod-2-sdl3/blob/9a3d488143d108985422c2eeb9501e4aa5a0fe72/FORMATS.md).

The road objects use a second system. I walked the local `SR2_SHP` records using the two documented headers, 16-byte level records and three bytes per coloured span. Twenty-three ordinary sets followed by three grouped sets consumed exactly 42,742 bytes. The reference associates these sets with scaled roadside objects and aqueduct roll angles. This inventory verifies record structure and bounds. It does not establish the visual identity or use site of every bitmap.

## Original art

The garage uses a side-profile body, masked window glazing, separate wheel and hub layers, paint, chrome, and optional scoop. Three silhouettes support a coupe, open-top model and wagon. The road renderer layers a gradient sky, sun, parallax ridges, route scenery, shoulders, tarmac, markings, street furniture, opponent tails, finish banner, painted bonnet and dashboard instruments. Original paths and perspective scaling supply the alternate sizes and vehicle colours. Both functions take the current view as input, including absolute rival positions; neither advances the simulation.

`drawGarage(canvas, car)` and `drawRace(canvas, race)` are exported from [renderer.ts](./renderer.ts). Set the canvas CSS width and height or aspect ratio. The drawing buffer follows its measured size at up to 2× pixel density. Distances are metres, speed is km/h, and lateral coordinates are in half-road widths. Race themes are `strip`, `canyon` and `aqueduct`.

The art covers the garage and road views. The original's individual menu illustrations, driver portraits, model-specific overlays and all original viewing angles are outside this artwork inventory.
