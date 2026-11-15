# Fuse Liero progress

- Implemented: original deterministic cave combat, destruction, rope, three weapons, bots, respawns and finite rounds; shared Fuse rooms, scoped held inputs and validated recovery; neon Canvas presentation, keyboard/multitouch, menus/lobby, gallery/desktop entry, confirmed play metrics.
- Focused verification: 27 engine/control/rollback tests pass. Reviewed desktop/mobile/menu/lobby captures, corrected header overlap. Measured 60 browser RAF frames/s on the development Mac, not a physical-phone performance claim.
- Integration verification: TypeScript, production build, repository lint/config and tracked-file formatting pass. Full unit run passed 6,544 of 6,545 tests; the sole failure was the existing service test's explicit game list, updated with Fuse Liero and actual room admission and rechecked separately. Both home workers timed out over SSH, so the full run used low-priority local execution with concurrency two.
- Browser smoke passed: two players and a display, controls and terrain replication, matching hashes, touch controls, spectator exclusion and reload recovery. Independent review found timer offset and bot-period aliasing; both corrected and the reviewer verified the fixes.
- Blanket formatting also sees the existing ignored `.claude/settings.local.json`; its unrelated formatting was left untouched. Tracked source and all task files pass.
- Human playtest: pending. No merge or deployment authorized.

## Larger-world playtest correction

User requested a larger Liero-style world and personal follow cameras, retaining an overview on shared TVs. Implemented 1536×864 terrain (four times the original area), connected galleries and climbing shafts across the full map, separated safe spawns, desktop/phone follow views and a minimap. TV and unseated spectators retain the full-world overview. Physics and weapon geometry/timing are unchanged; rules version is now `fuse-liero-2`.

34 focused tests pass. Actual five-player engine checkpoint measured 84,234 bytes, within the existing 2,600,000-byte snapshot limit. Updated multiplayer smoke passed personal camera tracking, portrait/landscape viewport changes, full-world TV view at both sizes, terrain/input replication and reload recovery with matching state hashes. Independent review found no actionable issues in this correction and verified eight randomized rounds of checkpoint closure. Human traversal/gameplay acceptance remains pending.
