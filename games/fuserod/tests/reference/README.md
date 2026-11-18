# Fuserod driving reference

The local 1991 DOS build of Street Rod 2 has SHA-256 `d763bd13be07b2ef457b5982f26316a8d71470d73beeb4eee7c6c1e1fef72d96`. REA identified an x86 DOS MZ executable. Removing Microsoft EXEPACK yields a 288,912-byte load image, entry 34b0:0018 and 2,721 relocations. The load image digest is pinned in the probe.

The manual drivetrain adapts the [MIT-licensed SDL3 reconstruction at 9a3d488](https://github.com/kylofon/street-rod-2-sdl3/blob/9a3d488143d108985422c2eeb9501e4aa5a0fe72/sr2port/src/game/race_phys.c). The upstream license is in `src/motor/LICENSE.txt`. Fuserod uses three original car configurations. Each is class 2 with bodywork fitted, standard intake and exhaust, and a manual transmission. The engine, transmission and tires each have three grades. These properties select SR2 torque bands and gearbox ratios.

## Reproduce

With a local copy of the game, Python 3 and Unicorn 2.1.4, run from the Fuse checkout:

```sh
git clone https://github.com/kylofon/street-rod-2-sdl3 /tmp/sr2-reference
git -C /tmp/sr2-reference checkout 9a3d488143d108985422c2eeb9501e4aa5a0fe72
python3 /tmp/sr2-reference/tools/unexepack.py /path/to/SR.EXE /tmp/SR2-unpacked.exe
uv run --with unicorn==2.1.4 games/fuserod/tests/reference/probe.py /tmp/SR2-unpacked.exe
pnpm exec tsx --test games/fuserod/tests/motor.test.ts
```

The oracle executes original instructions from `car_setup` (0001:c294), the keyboard-to-physics portion of the timer interrupt (0001:2950 through 0001:2f40), and `speed_to_step` (0001:ce9c). It initializes synthetic part records and a clean physics block in emulated RAM, with 1500 idle RPM, neutral, zero wear and RNG seed 37. The keyboard, click and shoulder bytes are supplied directly. It stops before the separate road collision call. Neither SDL nor Fuse computes the oracle's RPM, steering, wear or speed results.

Six scenarios compare the entire sequence of RPM, mph, gear, wheel, torque band, limiter, engine wear, gearbox wear and failure flags. Three use a 4350 RPM shift policy, through steer hold/reversal, shoulder, braking, throttle release and stall. Three hold first gear to engine failure. Another check executes the DOS road-speed function at every integer from −1 to 141 mph. These traces assume the original fast-machine setting (CPU class 4).

Three complete quarter-mile motion traces compare RPM, mph, gear and position on every Fuse tick until 5,120 road units. The oracle executes the original motor on a 12-interrupt cadence and evaluates road distance on an eight-interrupt cadence, driven by a 1,193,182 Hz PIT with divisor 16,384. Fuse samples this reconstruction at 20 Hz and checkpoints the phase and queued shift. The measured finish frames are 403, 306 and 238 for the three sample builds. This is an isolated motor and road-distance measurement. The full DOS game loop, actual frame stalls on particular PCs, collision geometry, AI, event and economy progression are outside these comparisons.

## Fuse-specific behavior

Drivers can request up and down shifts explicitly. The original click chose a direction from the throttle, brake and current torque band. The parity cases use the same directional result as that click. After a breakdown the motor stops advancing and the caller handles the race outcome. The caller also owns course geometry, wheel-to-lane motion, opponents, start lights, race stakes and results. Choose the tune at race start and retain it for the duration of the race.

## Rival decisions, police and timing

Run `uv run --with unicorn==2.1.4 games/fuserod/tests/reference/rival_probe.py /tmp/SR2-unpacked.exe` and `pnpm exec tsx --test games/fuserod/tests/opponent.test.ts` to compare:

| DOS instructions                                       | Measured behavior                                                                                         | Cases |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----: |
| 0001:cb98 rival AI through acceleration or gear change | Requested speed cap on straights, entering turns, passing, alongside, police pursuit and sanctioned strip |   384 |
| 0001:d21a–d2a3 street traffic avoidance                | Clearance direction and lateral step for an obstructed span between two edges                             |    76 |
| 0001:d9b4 police dispatch                              | Waiting, abandonment, pursuit, siren, pulling the driver over                                             |   132 |
| 0001:b1e8–b219 finish ordering                         | Signed subdivision rounding when cars finish within or across a segment                                   |   390 |
| 0001:90a6 bracket countdown                            | Which lane waits for the stronger dial-in, and for how many PIT ticks                                     |    16 |
| 0001:b366 bracket decisions                            | First or second at the line, dial-in exceeded, matched or beaten                                          |    32 |

The opponent probe supplies synthetic road flags and reads the decision before any rendering, siren or car swap. The CPU driver's pedal adapter applies the recovered pacing targets through player-accessible controls. The DOS AI's private instantaneous gear changes and the original field's times are outside these trace claims. The three automated Fuse quarter-mile runs verify finish and checkpoint recovery. Course generation, the traffic lookahead scanner, bracket tournament seeding, aqueduct lane AI, traffic assets, police model swapping and the original game's complete campaign remain outside these probes.
