# Fusero

Fusero is being built as a close clone of OpenLieroX Classic gameplay, with Fuse's neon presentation, menus and multiplayer. The requirement is source-derived mechanics, rather than a similar-feeling ruleset. **The integrated port is still under verification; mechanical parity and release readiness are not yet established.** The earlier three-weapon prototype is superseded.

The baseline is OpenLieroX release `20260717.2`, commit `0a20c6d0a10ed63b28a15f05c771913c294efbf6`, its packaged Classic mod, and the native default **Dirt Level**. [SOURCE-PARITY.md](SOURCE-PARITY.md) records source contracts, comparisons and outstanding verification. [CREDITS.md](CREDITS.md) and [upstream/SOURCE.md](upstream/SOURCE.md) retain source and asset provenance.

## Gameplay baseline

The exact Classic binary supplies **38 weapons and 69 projectile descriptors**, including child and trail projectiles. Players choose five weapon slots. The fresh-configuration `Standard 100lt` preset enables twelve weapons; the room settings also offer all 38. Charge, reload and fire timers advance only for the selected slot, so switching away pauses that slot's reload.

Classic deathmatch defaults are 15 kills, six minutes and unlimited lives. The default respawn delay is 2.5 seconds, with automatic respawn enabled by the native maximum-delay setting. Health and weapon bonuses are disabled by default; their optional behavior follows the source rules. There are no added match crowns or invented rounds between deathmatches.

Movement, aim, collision, carving and ninja rope use source-derived kernels. A rope press launches or relaunches the hook. Releasing that button leaves the rope active; jumping releases it. Hook flight, falling, terrain and worm attachment, and the native constant pull are distinct states. Terrain is per pixel. Explosions and dirt placement use the original physical masks and projectile actions; displayed neon blast effects do not determine damage or digging geometry.

The default level retains all **504×350 native physical pixels**. OpenLieroX renders those world units at twice their size. Fusero's corresponding personal view is 320×180 world units on desktop and a closer 192×144 on a narrow phone. Each player follows their own worm, with a minimap. A TV display or unseated spectator sees the whole level. The physical level is never enlarged to create the appearance of a larger world.

## Local play and controls

Run `pnpm dev`, then open the printed URL plus `/fusero/?mute`. The intended flow is **PLAY → SINGLE PLAYER** for a match with Fuse-controlled bots, or **HOST ROOM** for an online room. Take a seat, choose the five weapons in the lobby, invite friends or add AI, then **START MATCH**. Room settings expose weapon restrictions, limits, loading time, bonuses and owner injury.

| Keyboard              | Action                                    |
| --------------------- | ----------------------------------------- |
| A / D or left / right | Move; walking sets facing unless strafing |
| W / S or up / down    | Aim                                       |
| Space                 | Jump and release an active rope           |
| F / J                 | Fire                                      |
| R / K                 | Launch or relaunch the ninja rope         |
| Q / E                 | Previous or next weapon slot              |
| 1–5                   | Select a weapon slot                      |
| G / C / Ctrl          | Carve nearby dirt                         |
| Shift + A / D         | Select a weapon without walking           |
| Alt + A / D           | Strafe while retaining facing             |

Phones provide movement, aim, jump, rope, fire, carve and five weapon-slot controls. Touch walking records the native periodic auto-carve input. OPEN TV SCREEN opens a separate window so the source page remains visible while the display recovers its world. A TV on another device can open the display URL. Hidden source tabs are excluded from snapshot recovery by Fuse's existing visibility policy.

## Architecture and compatibility profile

`src/engine/classic/` owns the source-derived simulation and pinned immutable data. `src/online/` supplies Fuse's room management, scoped input log, rollback and peer recovery. `src/app/` renders views and records keyboard/touch controls. The hosted room service handles membership and signaling; gameplay stays in the browsers.

The selected parity profile fixes the native outer frame at **100 FPS / 10 ms**. LX56 physics keeps its separate **11 ms** step, produced by the source's integer `1000 / 84` calculation. Native next-outer-frame shot delivery, clock remainders, pending shots, RNG, terrain, projectiles and weapon-slot state belong in checkpoints. Fuse's 50 ms log tick groups five outer frames; rendering does not advance either simulation clock. This scheduling contract is part of integration verification, not a claim that every native variable-frame-rate execution has already been matched.

Fuse bot controllers emit ordinary inputs through the same gameplay kernels. **OpenLieroX's native bot AI has not been ported**, so bot decisions are not a demonstrated parity area. Shared Fuse menus, phone controls and room recovery are integration features. Compatibility with OpenLieroX's network protocol, arbitrary mods and every native game mode is not established by this Classic port.

One first-party analytics round is one deathmatch, counted for participating browsers from confirmed play. Spectators and menu backgrounds do not count. Account history/rankings are not credited by the current room-only platform registration.

## Verification

```sh
pnpm exec tsx scripts/fusero-decode-classic.ts --check
pnpm exec tsx scripts/fusero-decode-level.ts --check
pnpm exec tsx --test games/fusero/tests/classic-*.test.ts
```

The source-data checks verify the packaged binary, descriptors and native material plane. Focused module tests cover mechanics and serialization; native differential fixtures compare the specific physics paths they exercise. These are separate from complete-world replay, multiplayer and browser acceptance.

`ONLINE_URL=http://localhost:PORT/ pnpm exec tsx scripts/fusero-smoke.ts` is the browser integration entry point. It must be refreshed and passed against the composed source-derived engine before its results establish current readiness. `pnpm gallery:capture fusero` refreshes the gallery from real play after a successful build. Earlier prototype screenshots, frame rates and browser results do not validate this replacement engine.

Human gameplay comparison and physical-phone checks remain outstanding. The draft PR is not merge or deployment authorization.
