# Cyberfuse gameplay reference

Cyberfuse targets Ronny Wester's C-Dogs DOS v1.06. The executable contains the v1.06 string and the source distribution defines that version in `DEFS.H`. The v1.05 heading in the bundled manual predates the executable. The Cyberdogs Pascal build with `DOGS.EXE` is a separate game.

| Reference                                                                                    | SHA-256                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [DOSGames original cdogs106.zip](https://dosgames.com/files/cdogs106.zip)                    | `de6c5e025b5c03b475e55c2ec6ab88b493517a4d4e8c649e2e7dd1919b7b50cc` |
| `CDOGS.EXE` inside that ZIP                                                                  | `1a9420f29c7bd9c99b8c5083f583636c7b236c3f52e5ee1fba968a8d30647f1e` |
| [DOS source distribution cdogssrc.zip](https://www.dosgamesarchive.com/file/c-dogs/cdogssrc) | `a3abe423206205739092953ccd1191746ab8a21130079cd0c40bbe9f48a309ee` |

The DOS executable can be launched from the **Play online** control on [the original game's listing](https://dosgames.com/game/c-dogs/). For a local reference run, unpack the DOS archive to a temporary directory, mount that directory as C in DOSBox, then run `CDOGS.EXE`. Cyberfuse runs the TypeScript simulation inside the Fuse room runtime. Reference binaries and sampled DOS sound effects are excluded from the game. Upstream records the licenses for the original graphics, Ronny Wester's campaigns and contributed data. [Upstream data licensing](https://github.com/cxong/cdogs-sdl/blob/master/doc/README_DATA.md)

## A complete actor and extraction trace

With Python 3 and a C99 compiler installed, run these commands from the repository root. Pass an unpacked, digest-verified source directory as the last argument to the probe.

```sh
python3 games/cyberfuse/src/sim/reference_probe.py /path/to/cdogssrc
node --import tsx --test games/cyberfuse/tests/sim.test.ts
```

The probe compiles original `CheckWall`, `MoveActor`, `SlideActor`, `CommandActor`, `PlayerSpecialCommands` and `MissionCompleted` into a native harness. Add `--trace` to print every tick. The harness supplies scripted input, one collision pickup, a static floor with a wall and exit, and stubs for sound, projectiles and character animation. The TS test runs the same scenario through the public mission step, including its real projectile and fog updates.

One living player starts at (120,120) with a machine gun, shotgun and powergun. A jewel at (136,120) is the sole required objective. The input covers walking, turning to fire, slide initiation and deceleration, diagonal movement against the wall, and releasing the special button to cycle weapons. See the probe and test for the exact control schedule. Each row records the step number, fixed-point x/y, slide velocity x/y, facing, active weapon, collected count and extraction progress. The complete 368 rows hash to `b0651a703ec77580818b01cf5eb9c2236d5ef9462aa9cdc146b0710b2e973859`. The snapshot test forks immediately after a sliding shot and compares the complete states through pickup. The ordnance, hostile AI and map modules carry additional independent probes.

## Timing and simulation boundaries

- `GAME.H` sets 560 timer interrupts per second and eight interrupts per ordinary frame. The adapter supplies exactly 70 game steps per second. `GAME.C` updates actor counters, mobile objects, player commands, enemy commands and watches. Fuse preserves the distinct existing-projectile and newly fired phases. A direction while firing updates aim and holds walking. A slide starts on its own frame, then decays by 32 fixed-point units per axis on each subsequent command.
- `ACTORS.C`, `MAP.C` and `PREP.C` define a 7×5 half-size actor footprint, 256 subpixels per pixel and one pixel per axis per walk step. Source-provided coordinates and authored character attributes initialize each actor. The simulator retains the position, shot phase, recoil displacement, status timers, held special button, score and NPC decision state in snapshots.
- `AI.C` checks enemy population after commanding NPCs. At normal difficulty a replacement can spawn once per step when total NPCs fall below the mission's density. Death advances through nine frames before releasing a slot. A Fuse checkpoint retains retired owners of live ordnance until their projectiles expire. Placement uses the checkpointed random stream, a 150-pixel exclusion around living seats and a finite search.
- `MISSION.C` checks required objective counts, living players and the rescued prisoner. `GAME.C` sets the normal pickup delay to 350 uninterrupted frames. Stepping out restarts the countdown. At initialization Cyberfuse starts the same countdown for a party that spawns already ready to leave. The DOS executable can finish such a custom first mission immediately with its initial zero pickup timer.
- Fuse replaces the DOS host clock seed and rendering-driven NPC visibility with checkpointed seed streams and simulation-derived tile visibility. Browser peers therefore agree despite different screen sizes and frame rates. The DOS slow-frame catch-up path (`Synchronize`) and graphics-driver timing are outside the fixed-step port. Five-seat rooms, AI-controlled platform seats and individual-device camera ownership extend the original two-player game.
- The 368-step result establishes the listed fields in the scripted corridor. It does not establish binary-equivalent full combat traces, identical spawn sequences during arbitrary campaign play, or identical prisoner pathfinding. Actor projectile hits, prop reactions, campaign-wide checkpoint creation, door locks, death, replenishment and replay have separate tests. Browser execution and DOS runtime comparisons are reported separately.
- Rescue missions use the campaign character's speed, weapon, health, allegiance and immunity flags. Contact between the player's and prisoner's 7×5 half-size footprints clears the captive flag and records the objective once. The released character enters the regular NPC command pass, including follower targeting, door and collision handling, projectile damage and effects. Extraction requires the living prisoner inside the exit. Cyberfuse ends a required rescue if the prisoner dies. The DOS source increments character objectives on death and removes the character without clearing its separate prisoner pointer. Reproducing that dangling reference would make the result depend on freed memory.
