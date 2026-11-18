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

The garage uses three original silhouettes for the Kestrel club coupe, Marlin fastback and Meteor hardtop. Window glazing, wheels, paint, chrome and an optional scoop are separate layers. The catalogue and workshop use the same paint and body design as the garage. Finch, Pulse, Sable, Juno and Redline have individual portraits.

The road renderer layers a sunset sky, mountain ridges, route scenery, shoulders, tarmac, markings, street furniture, opponents, a finish banner, a painted bonnet and dashboard instruments. The mirror shows the front of a rival approaching from behind. The drag strip has a right-side rail. Solid slopes flank the aqueduct and exposed cliff edges mark the end of the canyon shoulders. Original paths and perspective scaling supply alternate sizes and vehicle colours. All drawing functions take the current view as input.

`drawGarage(canvas, car)` and `drawRace(canvas, race)` are exported from [renderer.ts](./renderer.ts). Set the canvas CSS width and height or aspect ratio. The drawing buffer follows its measured size at up to 2× pixel density. Distances are metres, speed is km/h, and lateral coordinates are in half-road widths. Race themes are `strip`, `canyon` and `aqueduct`.

When a race view supplies course features, narrow bridge girders, rocks, rough patches and guardrails appear at their corresponding positions. Approach signs show the upcoming restriction. A signed aqueduct bank angle rotates the road, sky and opponents together while the cockpit and mirror housing stay fixed.

`artCanvas(kind, item, options?)` in [catalog.ts](./catalog.ts) makes a two-density canvas suitable for a labelled control. A `rival` takes the zero-based rival index. A `car` takes a model index with optional paint and a side, front or quarter view. A `part` takes the workshop component name. The workshop pictures depict a V engine, whitewall tyre, transmission housing, final-drive gear and repair wrench.

## Reference roles and current coverage

| Reference picture role                                                             | Fuserod equivalent                                                                                                     | Remaining differences                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Garage cars, paint, tyre grades and add-on body panels                             | Three original model profiles with separate wheels, glazing, paint and optional hood scoop                             | The 22 original model-specific sets and their roof/bumper configurations have no one-for-one equivalents.   |
| Rival photos, garage display and dealer listings                                   | Five original driver portraits, service-bay scene and car thumbnails                                                   | Original character identities, seller photos and the original diner scene are absent.                       |
| Engine-bay, transmission, tyres, tuning and tools                                  | Five workshop illustrations for engine, tyres, gearbox, final drive and repairs                                        | Individual bolt, carburettor, manifold, jack and timing-light animations remain unmapped.                   |
| Opponent visual angles and traffic                                                 | Road tail views, mirror front and front-quarter views, plus garage side profiles                                       | The original's complete angle/shrink-mask set and police livery remain unmapped.                            |
| Roadside span objects and race HUD                                                 | Scaled scenery, markers, vegetation, architecture, course-edge geometry, gauges, mirror, hood, wheel and finish gantry | The 26 original shape sets have no per-ID visual correspondence.                                            |
| Titles, licence/save book, newspaper, calendar, story, gas station and end screens | Shared Fuse interface and the garage progression screens display their own live game state                             | Original title/credit illustrations, fuel-pump and hose animation, and scripted ending art remain unmapped. |

Original resource roles are described in the reference implementation's [garage study](https://github.com/kylofon/street-rod-2-sdl3/blob/9a3d488143d108985422c2eeb9501e4aa5a0fe72/port/spec/garage.md) and [game-flow study](https://github.com/kylofon/street-rod-2-sdl3/blob/9a3d488143d108985422c2eeb9501e4aa5a0fe72/port/spec/game_flow.md).
