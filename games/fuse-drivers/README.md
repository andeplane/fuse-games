# Fuse Drivers

A four-lap stadium truck race for two to five drivers and bots, inspired by Ivan "Ironman" Stewart's Super Off Road. The whole course stays in view. Open `/fuse-drivers/` (locally **http://localhost:8787/fuse-drivers/**).

Open it from the shared app portal. Product events use the shared `fuse-ui/analytics` and `fuse-ui/play-metrics` contract with the `fuse-drivers` game id.

Hold `W` or `↑` for gas, release to coast, and steer with `A`/`D` or `←`/`→`. Press `Shift` or `Space` for nitro. On a phone, hold GAS while steering and tap NITRO for a burst of speed.

For shared-screen play, the host ticks **Shared TV** in the room, under the invitation, and opens **OPEN TV SCREEN** on the TV. The TV shows the arena and phones show controls.

## How it fits the shared packages

The rules (`src/game/`) fold on `fuse-netcode`'s shared input log: every device simulates the identical
race from the same entries, and nobody is the authority. The page (`src/app/`) is `fuse-ui` for the
landing, lobby, invite and results, with the arena as a lazily imported Phaser renderer that the page's
own frame loop drives. `src/platform.ts` registers the racing stats with the room service.

Two details are specific to a racing game on a 50 ms log:

- The simulation models one DOS race update per three VGA retraces (70/3 Hz). All clients derive the same update count from each 20 Hz log tick.
- **A driver logs only a change of controls.** Thumbs stay put for seconds, so silence in the log means
  still as before, and a race costs a few entries per corner rather than one per tick.

## Tracks

The default course is Sidewinder. The room host can choose any of the eight original circuits in either direction. The physics samples the measured terrain at each wheel, and the renderer shades the same triangular planes. The course and terrain measurements live under `src/game/offroad/`.

## Checks

```sh
npx tsx --test games/fuse-drivers/tests/*.test.ts
ONLINE_URL=http://localhost:PORT/ pnpm exec tsx scripts/fuse-drivers-smoke.ts
```

`sim-*.test.ts` are the simulation's own suite, carried over from the game's first home, including a
recorded replay hash that pins its physics. The rest cover the fold, the checkpoint, the mesh and the
page.
