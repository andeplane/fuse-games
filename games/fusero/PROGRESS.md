# Fusero progress

## Current scope

The user clarified that this must be a close clone: original gameplay mechanics, with only graphics styled differently. The public game name and route are now **Fusero** and `/fusero/`. Fuse's networking and room recovery remain the selected architecture. Source-derived Classic gameplay replaces the earlier custom three-weapon simulation. Merge and deployment are not authorized.

## Source-derived work

- Pinned OpenLieroX `20260717.2` at `0a20c6d0a10ed63b28a15f05c771913c294efbf6` and decoded the actual packaged Classic binary rather than the outdated decompiler example.
- Retained 38 weapon definitions, 69 projectile descriptors, native physical terrain masks and animation geometry used by projectile expiry. Exact source fixtures and regeneration commands are recorded in [upstream/SOURCE.md](upstream/SOURCE.md).
- Ported module boundaries for movement/aim/rope, weapons/projectiles, match/respawn/bonuses, compact pixel terrain and checkpoint validation. Complete-world integration is still being verified; module implementation alone is not parity proof.
- Extracted every physical pixel of the native default Dirt Level: 504×350, with 11,855 air, 159,596 dirt and 4,949 rock pixels. The baked runtime geometry is about 7 KB. Changing artwork does not change the material plane.
- Updated presentation toward five weapon slots, native charge/reload behavior, source-scaled personal cameras (320×180 desktop, 192×144 narrow phone), minimap and full-world TV overview.
- Selected a fixed 100 FPS outer profile: 10 ms outer frames, separate 11 ms LX56 physics, and native next-outer-frame shot delivery. These clocks and pending deliveries must survive replay/checkpoint recovery.

## Verification recorded at module scope

The terrain/default-level domain has **20 passing focused tests**, with strict TypeScript and focused ESLint checks. Tests compare original PNG mask pixels, all 176,400 native level material pixels, source digests, carving and dirt-placement behavior, spawn-search bounds and compact terrain serialization. The level generator's `--check` reproduces its retained source exactly.

The composed game has **156 passing focused tests**, including all 38 weapons, deferred shots, strict state validation, deterministic continuation, dropped/reordered input recovery, manual bot respawn and the integrated 200-frame native Laser timing fixture. TypeScript, scoped lint and the production build pass. Independent core and integration reviews found and corrected projectile RNG ordering, server clock offset and lost short input taps; two review suggestions hardened fixture-length and released-input assertions.

The rebuilt browser smoke passed solo preparation, native terrain, five-slot charge/reload, two players plus a TV, continuous aim, persistent rope with jump release, touch controls, resizing and phone reload recovery. All three replicas converged on the same room hash. Headless real-flow screenshots and a refreshed gallery capture exist; short desktop and portrait phone layouts keep the HUD, five slots and controls inside the viewport. Live weapon selection was exercised through the game menu. These are browser-emulation checks, not physical-phone or human feel acceptance. Earlier prototype observations do not validate this replacement engine. Exact parity coverage and remaining limits belong in [SOURCE-PARITY.md](SOURCE-PARITY.md).

## Remaining acceptance

- Finish the broader repository checks recorded in the pull request and compare actual play against the original.
- Obtain human gameplay acceptance and physical-phone evidence. The current bot policy emits ordinary Fuse inputs; native OpenLieroX bot AI remains unported.
- Keep deployment and merge separate from technical checks. Neither is currently authorized.

The initial prototype's header overlap, countdown display and bot-period aliasing were corrected during its development, but its invented mechanics were rejected as the final direction. Personal cameras and TV overview remain required; the source-scaled camera and native level now replace the prototype's enlarged procedural cave. Historical prototype validation remains in commit history rather than being presented as current readiness.
