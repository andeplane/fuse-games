# Fusero

Build a close clone of the pinned OpenLieroX Classic gameplay in Fuse. Gameplay mechanics must follow the original source and packaged data; graphics may use Fuse's neon style. Retain Fuse networking, room recovery, shared menus and phone controls. Do not treat a similar-feeling prototype as completed parity.

## Source contract

The baseline is OpenLieroX `20260717.2`, commit `0a20c6d0a10ed63b28a15f05c771913c294efbf6`, Classic v7 data internally named `Liero v1.0`. Preserve all 38 weapon definitions and 69 projectile descriptors, five weapon slots, current-slot charge/reload behavior, aim and facing, pixel collision/carving, rope flight/attachment/pull, explosions and physical masks, injury, scoring, respawn and optional bonuses. Fresh defaults use `Standard 100lt`, 15 kills, six minutes, unlimited lives and bonuses off.

Use the native default Dirt Level's 504×350 material plane without scaling geometry. Desktop personal cameras show 320×180 world units, corresponding to the native two-times rendering scale; narrow phones show 192×144. A player follows their own worm with a minimap. TV displays and unseated spectators retain the full-world overview.

The compatibility profile uses fixed 100 FPS outer frames (10 ms), independent 11 ms LX56 physics clocks, and next-outer-frame delivery of server-created shots. Checkpoint all evolving decisions and pending deliveries. Source/configuration override precedence matters: packaged Classic values take precedence over generic fallbacks. See [SOURCE-PARITY.md](SOURCE-PARITY.md) for authoritative details and remaining comparisons.

## Presentation and integration

Keep the existing Fuse neon/pixel system: distinct player colors, readable health and weapon charge, visible terrain edges and expressive effects. Cosmetic effects must not decide collision, damage, rope force, lifetime or timing. Keyboard and multitouch input feed the same public contracts. The hosted service coordinates rooms and signaling, with no always-running gameplay simulation.

Fusero's current bot controller is a Fuse input policy, not the original OpenLieroX AI. This distinction must remain visible in readiness claims. Native mod, protocol and game-mode compatibility must not be inferred from a Classic deathmatch implementation.

## Acceptance work

1. Reproduce the pinned catalog, physical masks and default level from retained source fixtures.
2. Compare source-derived movement, aim, rope, weapon/projectile, injury and lifecycle paths against independent native evidence.
3. Verify the composed clocks, replay and rollback, including pending shots, terrain edits, loadouts and corrupt-checkpoint rejection.
4. Exercise real browser menus, five-slot selection, solo and online play, personal cameras, shared TV, input cancellation and peer recovery.
5. Compare actual gameplay with the original and obtain the user's acceptance. Measure desktop and physical-phone behavior separately.

The original three-weapon prototype and its checks are historical work. The source-derived replacement remains incomplete until these acceptance requirements are demonstrated. No merge or deployment is authorized.
