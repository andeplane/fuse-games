# Gallery captures

These JPEGs are resized copies of existing browser gameplay captures in the repository, rather than concept art. They illustrate the games and are not evidence of the current deployment. Images are limited to 1200 pixels wide (JPEG quality 84) to keep the catalog light.

| Image             | Source                                                                       |
| ----------------- | ---------------------------------------------------------------------------- |
| fuse-riders.jpg   | docs/gameplay-phaser.png                                                     |
| fuse-drivers.jpg  | docs/online/ui-evidence/fuse-drivers/cleanup-solo.png                        |
| fuse-axe.jpg      | games/fuse-axe/docs/images/app-play-bots.png                                 |
| fuse-bombers.jpg  | games/fuse-bombers/docs/images/online-round.png                              |
| fuse-choppers.jpg | games/fuse-choppers/docs/evidence/cave-mid-round.png                         |
| fuse-craft.jpg    | docs/fuse-craft/verification/organic-light-2026-09-30/lit-desktop-battle.png |
| fuse-freight.jpg  | games/fuse-freight/docs/evidence/mid-round.png                               |
| fuse-lane.jpg     | games/fuse-lane/docs/screenshots/desktop-week.png                            |
| hook-havok.jpg    | games/hook-havok/docs/evidence/art-production-pull.png                       |

The images below are captured from real play by `scripts/gallery-capture.ts`, which drives each game's own menus into a solo or bot match in a 1200×750 browser and saves the frame:

```sh
pnpm build
pnpm gallery:capture             # every game with a recipe
pnpm gallery:capture fuseball    # only this one
```

| Image               | Recipe            |
| ------------------- | ----------------- |
| ball-bros.jpg       | `ball-bros`       |
| fuse-birds.jpg      | `fuse-birds`      |
| fuse-front.jpg      | `fuse-front`      |
| fuseball.jpg        | `fuseball`        |
| graveyard-shift.jpg | `graveyard-shift` |

Every game on the portal needs an image: `tests/gallery-screenshots.test.ts` fails for a `portal.json` without a `screenshot`, or one that names a missing file. For a new game, add a recipe to `scripts/gallery-capture.ts`, run `pnpm gallery:capture <id>`, look at the result, and set `screenshot` to `gallery/<id>.jpg` in the game's `portal.json`. To refresh one of the copied images above from live play, add a recipe for it the same way.

## Fusteam carousel

Every portal entry also has a three-image `screenshots` array: its existing gameplay cover, `<id>-menu.jpg`, and `<id>-controls.jpg`. The latter two are distinct captures of the actual title screen and the How to Play screen, taken headless and muted with agent-browser from source on 2026-11-15. They are game screenshots, not mockups or generated art. The gameplay cover retains the provenance above.

Refresh these two screens for every game, or name specific games:

```sh
# Requires agent-browser and ImageMagick (magick) on PATH; the agent-browser binary defaults to /opt/homebrew/bin/agent-browser.
pnpm exec vite --host 127.0.0.1 --port 5260
GALLERY_URL=http://127.0.0.1:5260/ pnpm gallery:capture --carousel
GALLERY_URL=http://127.0.0.1:5260/ pnpm gallery:capture --carousel fuseball
```

`--carousel` uses the game's own How to Play button without injected game state, captures through agent-browser at 1200×750, and encodes JPEG quality 84. It updates `screenshots` only after both captures succeed. Without `GALLERY_URL` it starts and stops the built local room service, like the gameplay capture mode; with Vite it captures the current source tree without rebuilding. `AGENT_BROWSER_BINARY` can override the installed binary. The script closes its isolated browser when finished. Inspect the images before committing them.
