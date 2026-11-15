# Fusero progress

## Current scope

The user clarified that this must be a close clone: original gameplay mechanics, with only graphics styled differently. The public game name and route are now **Fusero** and `/fusero/`. Fuse's networking and room recovery remain the selected architecture. Source-derived Classic gameplay replaces the earlier custom three-weapon simulation. Merge and deployment are not authorized.

## Source-derived work

- Pinned OpenLieroX `20260717.2` at `0a20c6d0a10ed63b28a15f05c771913c294efbf6` and decoded the actual packaged Classic binary rather than the outdated decompiler example.
- Retained 38 weapon definitions, 69 projectile descriptors, native physical terrain masks and animation geometry used by projectile expiry. Exact source fixtures and regeneration commands are recorded in [upstream/SOURCE.md](upstream/SOURCE.md).
- Ported module boundaries for movement/aim/rope, weapons/projectiles, match/respawn/bonuses, compact pixel terrain and checkpoint validation. Complete-world replay, recovery and real browser integration pass within the documented canonical profile; module implementation alone is not parity proof.
- Retained every physical pixel of the original startup Dirt Level (504×350), and added native JailBreak (1200×600), Castle Strike (1350×550) and Factory (1200×480). Fusero selects JailBreak by default following the user's request for a larger arena with destructible terrain; its native material plane is about 23.1% dirt and 68% air. Game settings can select any of the four. Their geometry is not rescaled.
- Corrected the native camera interpretation: the logical screen is 480 high, yielding a 240-world-pixel-high view. Local 16:9 is 427×240, portrait local is 160×240, and network play keeps the native fair 320×240. TV overview uses the selected map's actual dimensions.
- Corrected art units: native worm and gun together occupy at most 10×9 world pixels; pixel bullets occupy 1×1; the crosshair is 3×3 at 16 world pixels from the worm.
- Replaced the invented keyboard mapping with exact Original PC and Original Mac presets. Original PC is the browser default, matching the official WebAssembly reference; Original Mac is selectable in MENU → GAME CONTROLS → Keyboard preset. Arrows move/aim, X launches rope, A/S select weapons, and opposite-direction chords dig. PC uses Ctrl fire / Alt jump; Mac uses Option fire / Command jump. The preset is a local preference. Five-weapon selection remains visible on the room page.
- Selected a fixed 100 FPS outer profile: 10 ms outer frames, separate 11 ms LX56 physics, and native next-outer-frame shot delivery. These clocks and pending deliveries must survive replay/checkpoint recovery.

## Rejected visual/feel claim

The preceding build was described as ready despite its incorrect 320×180/192×144 view, oversized worm drawing and substituted controls. The user reported that the map looked far too small, the worms far too large, and the game was unplayable. That feedback invalidates the earlier visual/feel readiness claim. Mechanics, codec and convergence tests did not demonstrate visual parity or human acceptance.

The source audit traced the missed conversion through `CClient::SetupViewports`, `CViewport`, `VideoPostProcessor` and `CGameSkin`. Native positions are doubled before the 20×18-logical-pixel skin is drawn. The former renderer treated too many screen-pixel dimensions as world-pixel dimensions and cropped away part of the native view.

## Current repair verification

The game tests cover native camera dimensions, platform-specific keyboard bindings, all 38 weapons, deferred shots, strict state validation, deterministic continuation, dropped/reordered input recovery, native bot respawn and the integrated 200-frame native Laser fixture. The live controller now ports native targeting, aiming, shooting, rectangle A*, rope navigation and stuck recovery, with checkpointed per-bot and shared decision state. Independent source-extracted C++ compares geometry/path behavior and 690 tactical cases. Current check counts and cloud results are recorded in the PR. These checks exercise the stated paths; they do not prove the whole original application's behavior.

The official OpenLieroX WebAssembly release was played through its own UI with native PC fire, dig, aim and rope inputs. The active reference interaction visibly produced explosions, health changing from 100 to 84 and charge changing from 100 to 66. A prior reference attempt ended at the match timeout; it is not evidence of those active actions. The repaired browser smoke passed native controls and zoom, multiplayer convergence and recovery. Browser emulation is not physical-phone evidence, and the reference interaction does not establish whole-session or bit-perfect equivalence. Broader repository checks and fresh screenshot evidence are recorded separately in the PR. Exact parity coverage and limits belong in [SOURCE-PARITY.md](SOURCE-PARITY.md).

The native controller integration passed all 175 Fusero tests on cloud-ci. The full merged repository run passed 7,005 unit tests, plus 1,818 FuseOS tests; a pre-build asset skip was rerun successfully after building, while one unrelated FuseOS skip remains. Typecheck, format, lint, configuration, production build and GitHub's `verify` gate passed on `bd158e60`. A six-minute five-bot workload on each native map validated all 288 sampled checkpoints, with the largest encoded world at 49,305 bytes. The PR retains the exact workload, revision and measurements.

A further real-game comparison completed a six-minute Castle Strike match in both the official release and Fusero, then delivered trusted keyboard inputs to another live round in each. Both showed Blaster charge near 33% after the firing sequence, with visible native combat and injury. The native actor died and respawned during part of the sequence, so this is functional interaction evidence, not a controlled trajectory comparison; the independent C++ fixtures provide the latter. The browser tool's incomplete held-key events were detected and replaced with Playwright's correctly encoded physical key events.

The phone-landscape visual check caught a real layout defect: at 844×390, surrounding UI reduced the cave to roughly 30 px high. The short-landscape layout now overlays HUD/scores, compacts weapon and action rows and hides the keyboard hint, retaining the native camera and all 15 controls at 44 px or larger. The cave is 202 px high at that viewport. A real-room regression also verifies the narrower 520×320 HUD cannot wrap into scores. Portrait and desktop retain their layout; before/after screenshots are attached to the PR.

## Remaining acceptance

- Obtain the user's gameplay-feel acceptance and physical-phone evidence. Seeded RNG, the declared prepared-match epoch and deterministic worker scheduling remain explicit differences from arbitrary native execution.
- Keep deployment and merge separate from technical checks. Neither is currently authorized.

The initial prototype and superseded source-port screenshots remain historical work. Neither those results nor earlier readiness reports establish acceptance of this repair.
