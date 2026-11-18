# Fuserod graphics

## What the supplied DOS build draws

I inspected the files accompanying `SR.EXE` (SHA-256 `d763bd13be07b2ef457b5982f26316a8d71470d73beeb4eee7c6c1e1fef72d96`). Reading each little-endian directory count followed by 28-byte records produced the inventory below. All recorded picture ranges fit their library. Each library ends one byte after the final recorded picture. The CGA alternatives contain the same picture counts and mask flags.

| Library | Pictures | Masked |    Depth | CGA alternative |
| ------- | -------: | -----: | -------: | --------------: |
| LIB1    |        4 |      1 | 4 planes |        2 planes |
| LIB2    |      212 |    173 | 4 planes |        2 planes |
| LIB3    |       83 |     54 | 4 planes |        2 planes |

In LIB2, 172 records have mask flag 1. Picture 1112 has flag 2. The table counts both as masked.

These 299 directory entries include screens, component overlays and UI pieces as well as sprites. Each 28-byte record describes dimensions, plane count, masking, sixteen compression tokens, payload offset and packed length. The reference format study identifies a table for 22 model-specific groups of roof, scoop and bumper overlays, and six groups of opponent/police views with separate shrink masks. See the [independent format study at the inspected revision](https://github.com/kylofon/street-rod-2-sdl3/blob/9a3d488143d108985422c2eeb9501e4aa5a0fe72/FORMATS.md).

The road objects use a second system. I walked the local `SR2_SHP` records using the two documented headers, 16-byte level records and three bytes per coloured span. Twenty-three ordinary sets followed by three grouped sets consumed exactly 42,742 bytes. The reference associates these sets with scaled roadside objects and aqueduct roll angles. This inventory verifies record structure and bounds. It does not establish the visual identity or use site of every bitmap.

## Original art

The garage catalogue covers 22 original hot rods, from the Kestrel club coupe through the Wildfire drag special. Each family defines a wheelbase, track, cabin and fin geometry. Side, rear, front and front-quarter views share that definition. Roof, bumper and hood-scoop fittings are independently visible; their availability comes from the game. The garage, classifieds, station, diner and victory scenes use the same vehicle and paint. Finch, Pulse, Sable, Juno and Redline have individual portraits.

`drawGarage(canvas, car)` and `drawRace(canvas, race)` are exported from [renderer.ts](./renderer.ts). Set the canvas CSS width and height or aspect ratio. The drawing buffer follows its measured size at up to 2× pixel density. Distances are metres, speed is km/h, and lateral coordinates are in half-road widths. Race themes are `strip`, `canyon` and `aqueduct`.

When a race view supplies course features, narrow bridge girders, rocks, rough patches and guardrails appear at the corresponding positions. A signed aqueduct bank angle rotates the world while the cockpit stays fixed. A shallow drainage trough runs along the aqueduct floor. Patrol colours and a roof light bar appear on the designated opponent in the windscreen or rearview mirror. Approaching a town destination brings its roadside building and sign into view.

`artCanvas(kind, item, options?)` in [catalog.ts](./catalog.ts) creates artwork for a labelled control. A `rival` takes its index. A `car` takes its catalogue index, with optional paint, fittings and side, front or quarter view. A `part` takes its component name. [scenes.ts](./scenes.ts) exports `drawScene` for larger illustrations.

The title scene shows the Fuserod marque and a front-quarter car. Credits use a workshop drawing board. The garage licence is an illustrated race log with space for the current driver's name and record. Separate citation, jail-window and fractured-windscreen views support a police stop, career retirement and wreck. Scope the illustrated pointer to the game root with `cursor.css` and `.fuserod-pointer`.

[street-furniture.ts](./street-furniture.ts) supplies original counterparts for hydrants, low and high trees, reflectors, telephone poles, striped work barricades, loose debris, bend chevrons, winding-road warnings and an overhead county/city/route banner. [hazards.ts](./hazards.ts) supplies narrow-road and speed warning signs and boulders. Palms, shrubs, ridgelines, streetlights, sun and sky use [landscape.ts](./landscape.ts). Seeded rocks, debris, barricades and shrubs use the positions received from the race view. Separately placed scenic objects do not change the simulation.

## Reference roles and current coverage

| Reference role                                                      | Fuserod art                                                                                                                                            | Differences                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Garage cars, wheel/paint variants, removable roof, hood and bumpers | 22 original vehicle profiles and fitting states, using common paint, geometry and glazing across views                                                 | Original models and renderings are replaced by their own Fuserod families. |
| Garage, rival photos, diner and listings                            | Five rival portraits, the garage, diner with seated rival, car catalogue                                                                               | Fuserod has its own rivals, vehicle names and building art.                |
| Engine bay, underside, maintenance and tools                        | Engine, carburettor, manifold, headers, muffler, tyres, gearbox, final drive, jack, bolts, wrench and timing light, in service, workshop or item views | The live mechanic chooses the visible work and component.                  |
| Rivals and police                                                   | Tail views, front and front-quarter mirror views, headlights, fascias and patrol light bar                                                             | Perspective scales and procedural poses replace the original shrink masks. |
| Roads, track objects and instruments                                | Three routes, banks, trough, mountain ridges, poles, shrubs, course hazards, gauges, mirror, hood and wheel                                            | The semantic identification of certain distant shapes remains incomplete.  |
| Fuel station and career ending                                      | A fuel station with pump, hose and nozzle; a trophy scene with the player's car and flags                                                              | Both are original illustrations.                                           |

Original resource roles are described in the reference implementation's [garage study](https://github.com/kylofon/street-rod-2-sdl3/blob/9a3d488143d108985422c2eeb9501e4aa5a0fe72/port/spec/garage.md) and [game-flow study](https://github.com/kylofon/street-rod-2-sdl3/blob/9a3d488143d108985422c2eeb9501e4aa5a0fe72/port/spec/game_flow.md).
