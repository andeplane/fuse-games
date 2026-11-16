# All-game UI review — 16 November 2026

This is a refinement of the existing Fuse neon/pixel interface. Game geometry,
timing, artwork, identities and networking remain game-owned. Fusetown retains
its warm town and paper panels during play; its shared arcade entrance needs a
dark backing for light text.

## Rendered coverage

Headless Chrome captures used real source pages with `?mute`, at 360×800,
844×390 and 1440×1000. The pass opened every game's main menu, How to Play,
available entrance settings, single-player entry and host waiting room:

| Game            | Public page        |
| --------------- | ------------------ |
| Ball Bros       | `/ballbros/`       |
| Pig (demo)      | `/dice/`           |
| Elasto Fuse     | `/elastofuse/`     |
| Fuse Axe        | `/fuseaxe/`        |
| Fuse Birds      | `/fusebirds/`      |
| Fuse Bombers    | `/fusebombers/`    |
| Fuse Choppers   | `/fusechoppers/`   |
| Fuse Craft      | `/fusecraft/`      |
| Fuse Drivers    | `/fusedrivers/`    |
| Fuse Freight    | `/fusefreight/`    |
| Fuse Front      | `/fusefront/`      |
| Fusetown        | `/fuselane/`       |
| Fuse Riders     | `/fuseriders/`     |
| Fuse Surge      | `/fusesurge/`      |
| Fuse Volley     | `/fusevolley/`     |
| Fuseball        | `/fuseball/`       |
| Fusemania       | `/fusemania/`      |
| Fusero          | `/fusero/`         |
| Graveyard Shift | `/graveyardshift/` |
| Hook Havok      | `/hookhavok/`      |
| Killer Fuse     | `/killerfuse/`     |

Single-player entry means the actual setup screen or match reached by selecting
Single player; games with a setup step were not treated as already playing.
Guest and TV waiting rooms were also captured at these sizes. Check the PR's
verification notes for exceptions and final run results. Screenshots belong in
the PR, not the repository.

## Corrections

- At 360px, Fusemania's Player options label pushed PLAY outside the dialog's
  clipped bar. Narrow shared dialog bars now keep the settings icon and its
  accessible name, leaving room for Back and the primary action. Wider layouts
  keep the text label.
- Graveyard Shift's fixed direction grid plus ability-button minimum widths
  exceeded the phone width. The pad now distributes available space, retaining
  at least 44px touch targets and all six actions.
- Riders' legacy short-landscape header rule changed the shared fixed bar to
  relative positioning during countdown. Its left inset then pushed the menu
  button beyond the viewport. The legacy positioning excludes the shared bar.
- Fusetown's translucent attract scene was composited over its bright town
  background, washing out the light menu text. Its entrance now supplies a dark
  backing, and the shared header uses a light green brand/portal accent.
- Axe, Choppers, Fuseball, Volley, Surge, Fusemania and Elasto had duplicate
  keyboard-only help grids that could squeeze instructions into a few letters
  per line. Landing and room copies use `createHowToPlay` and the same existing
  keyboard/touch guide data. Fusemania preserves binding refresh in room help;
  its landing guide resolves current preferences whenever opened.
- Ball Bros and Front now teach their actual keyboard and touch actions in
  structured guides. Ball Bros reuses its guide in the match sidebar. Front's
  spell/item labels share the HUD's key constants.
- Killer Fuse supplies its authored guide directly, avoiding a redundant
  description fallback before the instructions.
- Hook Havok's join, help and settings dialogs replace the small × with shared
  Back/page headers. The header stays reachable while the authored guide
  scrolls; native Escape remains available.

## Repeatable checks

```sh
pnpm exec tsx scripts/ui-responsive-smoke.ts
ONLINE_URL=http://localhost:PORT/ pnpm exec tsx scripts/how-to-play-smoke.ts
ONLINE_URL=http://localhost:PORT/ pnpm exec tsx scripts/game-lobbies-smoke.ts
HOME_URL=http://localhost:PORT/ pnpm exec tsx scripts/match-recap-smoke.ts
```

The responsive regression runs current source through Vite by default. It checks
dialog actions, options dismissal, both mouse and emulated touch layouts, Riders
rotation and Hook Havok's three Back headers. The help smoke covers fifteen real
structured guides, readable descriptions, contrast, scrolling and Back/Escape.
These additions do not add a job to the pull-request gate.

## Evidence boundaries

The carousel intentionally shows clipped neighboring songs; their bounds are
not a document-overflow defect. The Impeccable source scan also flagged existing
town illustration borders/bounce easing and score accents. Those reflect the
incumbent visual world and were not replaced during this refinement.

This pass is browser-emulation evidence. It does not establish physical-phone,
screen-reader or sustained network-impairment acceptance, every game's complete
match/results lifecycle, authenticated account flows, or a full FuseOS audit.
The shared results implementation and existing recap smoke provide separate
coverage; opening a waiting room is not evidence of a completed multiplayer match.
