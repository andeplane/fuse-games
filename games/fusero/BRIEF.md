# Fusero

Build a close clone of the pinned OpenLieroX Classic gameplay in Fuse. Gameplay mechanics must follow the original source and packaged data; graphics may use Fuse's neon style. Retain Fuse networking, room recovery, shared menus and phone controls. Do not treat a similar-feeling prototype as completed parity.

## Source contract

The baseline is OpenLieroX `20260717.2`, commit `0a20c6d0a10ed63b28a15f05c771913c294efbf6`, Classic v7 data internally named `Liero v1.0`. Preserve all 38 weapon definitions and 69 projectile descriptors, five weapon slots, current-slot charge/reload behavior, aim and facing, pixel collision/carving, rope flight/attachment/pull, explosions and physical masks, injury, scoring, respawn and optional bonuses. Fresh defaults use `Standard 100lt`, 15 kills, six minutes, unlimited lives and bonuses off.

Use the native JailBreak material plane (1200×600) as Fusero's default larger arena, following the user's playtest request. It combines open traversal with destructible dirt. Game settings also offer native Castle Strike (1350×550), Factory (1200×480) and the upstream startup Dirt Level (504×350). Preserve each level's physical geometry. Do not enlarge a small map's pixels to simulate a bigger level.

The native renderer uses a logical surface 480 pixels high, then displays world coordinates at two logical pixels per world pixel. Personal cameras therefore retain **240 world pixels of height**. Local 16:9 play sees 427×240; portrait local play sees 160×240; network play keeps the fair 320×240 view regardless of display aspect. A player follows their own worm with a minimap. TV displays and unseated spectators retain the full-world overview. The worm and gun together fit a maximum 10×9-world-pixel envelope; native pixel shots are 1×1 world pixel, and the 3×3-world-pixel crosshair is 16 world pixels from the worm.

Offer the source's primary keyboard controls as explicit presets. **Original PC** is the default, matching the official WebAssembly reference across browser platforms; **Original Mac** is selectable in MENU → GAME CONTROLS → Keyboard preset. Arrows move/aim; X launches the rope; A/S select previous/next weapons. PC uses left Ctrl fire, left Alt jump, left Shift weapon modifier and Z strafe. Mac uses left Option fire, left Command jump, Space weapon modifier and C strafe. The preset is a local preference and does not alter authoritative state. Digging is the native opposite-direction chord. Retain direct 1–5 slot selection. The previous WASD/F/R/Space-jump mapping was an incorrect substitution.

The compatibility profile uses fixed 100 FPS outer frames (10 ms), independent 11 ms LX56 physics clocks, and next-outer-frame delivery of server-created shots. Checkpoint all evolving decisions and pending deliveries. Source/configuration override precedence matters: packaged Classic values take precedence over generic fallbacks. See [SOURCE-PARITY.md](SOURCE-PARITY.md) for authoritative details and remaining comparisons.

## Presentation and integration

Keep the existing Fuse neon/pixel system: distinct player colors, readable health and weapon charge, visible terrain edges and expressive effects. Cosmetic effects must not decide collision, damage, rope force, lifetime or timing. Keyboard and multitouch input feed the same public contracts. The hosted service coordinates rooms and signaling, with no always-running gameplay simulation.

The live bots port the original Classic controller, including targeting, weapon choice, rope navigation, digging and stuck recovery. Their complete decision state is checkpointed. Deterministic worker scheduling and seeded randomness replace native threads and C `rand()`; retain these explicit comparison limits. Native mod, protocol and game-mode compatibility must not be inferred from a Classic deathmatch implementation.

## Acceptance work

1. Reproduce the pinned catalog, physical masks and default level from retained source fixtures.
2. Compare source-derived movement, aim, rope, weapon/projectile, injury and lifecycle paths against independent native evidence.
3. Verify the composed clocks, replay and rollback, including pending shots, terrain edits, loadouts and corrupt-checkpoint rejection.
4. Exercise real browser menus, five-slot selection, solo and online play, personal cameras, shared TV, input cancellation and peer recovery.
5. Compare actual gameplay with the original and obtain the user's acceptance. Measure desktop and physical-phone behavior separately.

The original three-weapon prototype and its checks are historical work. The later source port also overstated visual parity: its 320×180/192×144 crop and oversized worm art did not match the native renderer. The user rejected that build's feel. Those claims are superseded by the corrected dimensions above; passing mechanics tests was not visual or human acceptance. No merge or deployment is authorized.
