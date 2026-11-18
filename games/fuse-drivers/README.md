# Fuse Drivers

A four-lap stadium truck race for two to five drivers and bots, inspired by Ivan "Ironman" Stewart's Super Off Road. The whole course stays in view. Open `/fuse-drivers/` (locally **http://localhost:8787/fuse-drivers/**).

Open it from the shared app portal. Product events use the shared `fuse-ui/analytics` and `fuse-ui/play-metrics` contract with the `fuse-drivers` game id.

Hold `W` or `↑` for gas, release to coast, and steer with `A`/`D` or `←`/`→`. Press `Shift` or `Space` for nitro. On a phone, hold GAS while steering and tap NITRO for a burst of speed.

For shared-screen play, the host ticks **Shared TV** in the room, under the invitation, and opens **OPEN TV SCREEN** on the TV. The TV shows the arena and phones show controls.

Solo opens the same race setup as a room. Start with three CPU opponents, add or remove drivers, and choose one of eight opening courses in either direction. A series defaults to three races. Set one to eight races or choose Continuous to keep following the DOS calendar. Each race has four laps. Controls appear during every countdown.

## Race rules and graphics

The host chooses **Classic** or **Battle** for the series. Both use the same finish line, laps, nitro and speed shop. In Battle, everyone starts each race with a firebomb. Press **E** or tap **ITEM** to drop it where you are. The flashing ring marks the blast area before it slows nearby rivals. Drive through a crate with an empty item slot to collect another firebomb or a temporary shield. CPU drivers use the same items.

Each screen chooses its own **Graphics** in the lobby. **Fuse** uses the neon stadium presentation and **Classic** uses the dirt circuit presentation. Both draw the same physical course, so players with different graphics can share a race.

## Between races

The first truck through four laps wins. The other drivers are classified by their race progress and take a place prize. Cash bags add to the payout, and nitro pickups refill the truck during the race. Open **Speed shop** on the results screen to buy nitro bottles, shocks, tires, acceleration or top speed. Each player spends their own wallet. Drivers start with 25 nitros and two credits. When a purchase exceeds the available cash, one credit adds $200,000 to the wallet before the purchase. Unspent cash and nitros carry to the next race. The shop closes when the series finishes. **Next race** advances the campaign and carries each driver's truck to the next grid. **Back to lobby** starts a fresh campaign.

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

Set `OFFROAD_CAMPAIGN_SMOKE=1` when running the browser check to drive a shared-TV room through the finish, buy an upgrade from a guest phone, start the next race and reconnect. The [engine verification record](PORT-STATUS.md) describes comparisons against the DOS instructions.

### Local DOS artwork comparison

The local reference launcher runs the same native race and room service with track surfaces, sprite poses and shadows decoded from a local 1990 DOS installation. It binds to loopback and reads a private art pack outside this repository. Supply the EGA release directory and its indexed race screenshot for palette calibration.

```sh
python3 scripts/fuse-drivers-reference.py /path/to/OFFROAD /path/to/OFFROAD_screenshot.png /private/path/offroad-reference.json
pnpm exec tsx scripts/fuse-drivers-reference.ts /private/path/offroad-reference.json --open
```

Four trucks use the DOS paint schemes. A fifth Fuse driver uses violet. The shared Fuse controls, race HUD, pickups and results stay available. Choose Wipeout in the lobby's opening course picker for comparison with the DOS screenshot.
