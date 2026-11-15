# Fusero

Fusero is being built as a close clone of OpenLieroX Classic gameplay, with Fuse's neon presentation, menus and multiplayer. The requirement is source-derived mechanics, rather than a similar-feeling ruleset. **The integrated port is still under verification; mechanical parity and release readiness are not yet established.** The earlier three-weapon prototype is superseded.

The mechanics baseline is OpenLieroX release `20260717.2`, commit `0a20c6d0a10ed63b28a15f05c771913c294efbf6`, and its packaged Classic mod. Fusero now defaults to the native **JailBreak** arena in response to the user's larger-map request; native **Castle Strike**, **Factory** and the original startup **Dirt Level** remain selectable. [SOURCE-PARITY.md](SOURCE-PARITY.md) records source contracts, comparisons and outstanding verification. [CREDITS.md](CREDITS.md) and [upstream/SOURCE.md](upstream/SOURCE.md) retain source and asset provenance.

## Gameplay baseline

The exact Classic binary supplies **38 weapons and 69 projectile descriptors**, including child and trail projectiles. Players choose five weapon slots. The fresh-configuration `Standard 100lt` preset enables twelve weapons; the room settings also offer all 38. Charge, reload and fire timers advance only for the selected slot, so switching away pauses that slot's reload.

Classic deathmatch defaults are 15 kills, six minutes and unlimited lives. The default respawn delay is 2.5 seconds, with automatic respawn enabled by the native maximum-delay setting. Health and weapon bonuses are disabled by default; their optional behavior follows the source rules. There are no added match crowns or invented rounds between deathmatches.

Movement, aim, collision, carving and ninja rope use source-derived kernels. A rope press launches or relaunches the hook. Releasing that button leaves the rope active; jumping releases it. Hook flight, falling, terrain and worm attachment, and the native constant pull are distinct states. Terrain is per pixel. Explosions and dirt placement use the original physical masks and projectile actions; displayed neon blast effects do not determine damage or digging geometry.

The default JailBreak level retains **1200×600 native physical pixels**, with open passages and destructible dirt. Game settings also offer Castle Strike at **1350×550**, Factory at **1200×480** and Dirt Level at **504×350**. Their physical pixels are not scaled up.

OpenLieroX uses a fixed 480-high logical render surface with **two logical pixels per world pixel**. Its personal view is therefore **240 world pixels high**: **427×240** for local 16:9 play, **160×240** for portrait local play, and a fixed **320×240** for fair network play. Each player follows their own worm, with a minimap. A TV display or unseated spectator sees the whole selected level. Neon worm art, including the gun, stays inside the native **10×9-world-pixel** envelope. Pixel bullets are 1×1 world pixel; the crosshair is 3×3 at a distance of 16 world pixels.

The previous 320×180/192×144 camera description and oversized sprite presentation were wrong. The user's playtest exposed that mismatch despite passing mechanics tests. Those checks were not proof of the original's visual scale or feel.

## Local play and controls

Run `pnpm dev`, then open the printed URL plus `/fusero/?mute`. The intended flow is **PLAY → SINGLE PLAYER** for a match with the native Classic bots, or **HOST ROOM** for an online room. Take a seat, choose the five weapons on the room page, invite friends or add AI, then **START MATCH**. Game settings expose the level, weapon restrictions, limits, loading time, bonuses and owner injury.

The shared configuration layout keeps the player list on the left and the five weapon choices on the right, including solo rooms. Phones stack players before choices. Solo omits QR/invitation content; online rooms retain their invitation. Back, Room settings and Start stay in the shared room header.

The default **Original PC** keyboard preset uses the original primary-player bindings from the pinned `Options.cpp`, matching the official WebAssembly build even when played on a Mac. **Original Mac** is available under **MENU → GAME CONTROLS → Keyboard preset**. The choice is a local keyboard preference, not a room or gameplay setting.

| Action                                    | PC                                                             | Mac                 |
| ----------------------------------------- | -------------------------------------------------------------- | ------------------- |
| Move                                      | Left / right arrows                                            | Left / right arrows |
| Aim                                       | Up / down arrows                                               | Up / down arrows    |
| Fire                                      | Left Ctrl                                                      | Left Option         |
| Jump; release rope                        | Left Alt                                                       | Left Command        |
| Launch / relaunch rope                    | X                                                              | X                   |
| Previous / next weapon                    | A / S                                                          | A / S               |
| Weapon modifier, with left / right arrows | Left Shift                                                     | Space               |
| Strafe while retaining facing             | Z                                                              | C                   |
| Direct weapon slot                        | 1–5                                                            | 1–5                 |
| Dig                                       | Press the opposite direction while holding a walking direction | Same chord          |

The earlier WASD movement, F/J fire, R/K rope and Space jump bindings were substitutions and did not match the native defaults.

Phones provide movement, aim, jump, rope, fire, carve and five weapon-slot controls. Touch walking records the native periodic auto-carve input. OPEN TV SCREEN opens a separate window so the source page remains visible while the display recovers its world. A TV on another device can open the display URL. Hidden source tabs are excluded from snapshot recovery by Fuse's existing visibility policy.

## Architecture and compatibility profile

`src/engine/classic/` owns the source-derived simulation and pinned immutable data. `src/online/` supplies Fuse's room management, scoped input log, rollback and peer recovery. `src/app/` renders views and records keyboard/touch controls. The hosted room service handles membership and signaling; gameplay stays in the browsers.

The selected parity profile fixes the native outer frame at **100 FPS / 10 ms**. LX56 physics keeps its separate **11 ms** step, produced by the source's integer `1000 / 84` calculation. Native next-outer-frame shot delivery, clock remainders, pending shots, RNG, terrain, projectiles and weapon-slot state belong in checkpoints. Fusero selects a **10 ms input-log tick**, admitting controls every outer frame. Brief presses wait in checkpointed room state until the next physics pulse. Other Fuse games retain their 50 ms default; rendering does not advance either simulation clock. This scheduling contract is part of integration verification, not a claim that every native variable-frame-rate execution has already been matched.

The native Classic bot controller supplies source control fields through the same gameplay kernels as humans. Its arsenal, targeting, aiming, shooting, rectangle A*, digging, rope navigation and stuck recovery follow the pinned source. Bot memory, frontier, timers and shared random samples survive checkpoints; private AI graphs stay out of presentation views. Seeded randomness and deterministic worker scheduling replace native C `rand()` and OS threads. See [the controller design](../../docs/design/fusero-native-ai.md) for exact comparison limits. Shared Fuse menus, phone controls and room recovery are integration features. Compatibility with OpenLieroX's network protocol, arbitrary mods and every native game mode is not established by this Classic port.

One first-party analytics round is one deathmatch, counted for participating browsers from confirmed play. Spectators and menu backgrounds do not count. Account history/rankings are not credited by the current room-only platform registration.

## Verification

```sh
pnpm exec tsx scripts/fusero-decode-classic.ts --check
pnpm exec tsx scripts/fusero-decode-level.ts --check
pnpm exec tsx --test games/fusero/tests/classic-*.test.ts
```

The source-data checks verify the packaged binary, descriptors and native material plane. Focused module tests cover mechanics and serialization; native differential fixtures compare the specific physics paths they exercise. These are separate from complete-world replay, multiplayer and browser acceptance.

`ONLINE_URL=http://localhost:PORT/ pnpm exec tsx scripts/fusero-smoke.ts` exercises solo preparation, five-slot charge/reload, two players and a shared TV, native controls, terrain changes, phone reload recovery and full-state convergence. It passed against the composed source-derived engine. `pnpm gallery:capture fusero` refreshes the gallery from real play after a successful build. Earlier prototype results do not validate this replacement engine.

The official OpenLieroX WebAssembly build has also been played through its UI with native PC fire, dig, aim and rope inputs. Reference play visibly produced explosions, health changing from 100 to 84 and weapon charge changing from 100 to 66. This is evidence of actual reference interaction, not a whole-session or bit-perfect equivalence proof. Source-extracted C++ fixtures include geometry/path comparisons and 690 tactical cases across all 38 weapons. Current cloud checks and browser results belong in the PR.

The user's acceptance of gameplay feel and physical-phone checks remain outstanding. The open PR is not merge or deployment authorization.
