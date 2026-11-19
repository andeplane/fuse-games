# C-Dogs DOS v1.06 gameplay probes

These observations come from running Ronny Wester’s original `CDOGS.EXE` in a muted, headless DOSBox. The probe sends player keystrokes through the emulator and reads labels from the displayed VGA pixels using the font in the supplied DOS folder. It does not patch the executable. Files written by the game live in its temporary virtual drive.

| Input                                                        | SHA-256                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| [DOS v1.06 archive](https://dosgames.com/files/cdogs106.zip) | `de6c5e025b5c03b475e55c2ec6ab88b493517a4d4e8c649e2e7dd1919b7b50cc` |
| `CDOGS.EXE`                                                  | `1a9420f29c7bd9c99b8c5083f583636c7b236c3f52e5ee1fba968a8d30647f1e` |
| `emulators@8.5.3/dist/wdosbox.wasm`                          | `b33afba80de1a420c123086e5952d135de041f9e85d4444170e29d9249ec049c` |

## Run the probes

Use the unpacked C-Dogs DOS release with uppercase filenames. Install the pinned [js-dos emulator](https://js-dos.com/node.html) in a scratch folder. The game workspace and its runtime do not depend on it.

```sh
scratch=$(mktemp -d)
npm install --prefix "$scratch" --ignore-scripts --no-audit --no-fund emulators@8.5.3
for scenario in campaign password coop-password ordnance extraction spawn-in-exit dogfight; do
  NODE_PATH="$scratch/node_modules" node games/cyberfuse/reference/probe.cjs \
    /path/to/unpacked/cdogs106 "$scenario" || break
done
```

Verified with Node 26.13.0 on Apple Silicon. Each scenario starts with keyboard controllers, seed zero, player health 100%, and a fresh process. Normal CPU core, 20,000 fixed cycles, no joystick and no sound keep the setup consistent. The original game seeds actor placement from its clock, so an identical landscape can still have a different starting position.

## Observed outcomes

| Scenario                             | Entries and observable result                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campaign selection and equipment     | The first campaign listed is **Ogre Rampage**. Mission 1 is **Maintain integrity**. It asks the player to destroy five terminals. The available weapons are Knife, Machine gun, Flamer, Shotgun, Powergun, Sniper gun and Dynamite. The default loadout retains Shotgun and Machine gun. Adding Knife puts it in the third slot.                                 |
| Stationary secondary button          | A fresh single-player mission displayed **200 hp** and **Shotgun**. Three individual Enter presses with all direction keys released changed the HUD to **Machine gun**, **Knife**, then **Shotgun**.                                                                                                                                                             |
| Campaign passwords                   | Entering `q4skdb` on the original letter grid opened Ogre Mission 2 for one player. Entering `u5sahj` opened Mission 2 for two independently confirmed players.                                                                                                                                                                                                  |
| Campaign extraction                  | An authored 20×20 floor with a 1% survey objective and a western extraction strip gave the operative a clear path left. The HUD counted **Pickup in 5, 4, 3, 2, 1 seconds**, then showed **Completed mission**. From observing 5 to observing the summary took 4,983 ms in the sampled run. The 350-step, 70 Hz engine fixture reproduces this normal duration.  |
| Extraction already complete at spawn | An authored mission with no objectives and the entire walkable area inside extraction went straight to **Completed mission** with a **60 secs × 25** time bonus. In the DOS source, the pickup timer first becomes 350 on a frame where the completion condition is false (`GAME.C`, `gameloop`). This edge differs from starting a timer for every new mission. |
| Held fire and weapon charge          | In an empty level, consecutive shotgun shots changed the score from 0 to −5 and then −10. The two updates were 705 ms apart. After switching, the machine gun changed −10 to −11 and then −12, 87 ms apart. Those samples are consistent with 50 and six steps at 70 Hz.                                                                                         |
| Dogfight                             | In an authored 8×8 arena, two controllers independently equipped weapons. Both spawned at **500 hp** in each bout. The first player eliminated the second, the HUD counted down pickup, and the scoreboard advanced through **1–0, 2–0, 3–0, 4–0, 5–0**, with another equipment screen before each subsequent bout. After the fifth it displayed **Winner!**.    |

A separate interactive run held Tab and displayed the automap with objective text. Using the same initial stance near a wall, holding Right for 150 ms moved a fixed patch of scenery nine DOS pixels left by the last sampled frame. Holding Enter and Right for 150 ms moved the patch 23 pixels. Both translations matched the entire 135×71 pixel comparison region exactly after horizontal alignment. The periods were measured on the host. Frame delivery, acceleration and the nearby obstacle preclude inferring an exact per-tick displacement from those two samples. The independent source-function trace in `tests/sim.test.ts` exercises walking, sliding, switching, collision and extraction at exact simulation ticks.

Starting the unconfigured archive also revealed a DOS distribution quirk. **Game options** showed **Player hp 0%**. Entering a fresh mission produced **0 hp**, **Game Over** and the failed mission summary. Setting it explicitly to **100%** produced the normal 200-HP spawn. The probe supplies this setting in its virtual `OPTIONS.CNF`.

The campaign observations cover the first briefing, the weapon cycle and two password cases. Extraction uses purpose-built CPN data. A complete playthrough of each shipped campaign would provide additional coverage.
