# The Incredible Fuse reference study

The reference is the locally supplied 111,951-byte x86 DOS executable. Its SHA-256 is `1d8702c45106f4abd5af468c72c38d0588fc9e02a8928df988faaf57d5eb2303`. The resource index hash is `5ac303e00ce1e62222015bc6130b9cba802fa0f9e1c334b7a5ba336c327e47a4`. The tools below use local files. The Fuse game ships original artwork and puzzles.

## Motion and timing

The motion probe executes the decompressed DOS instructions under Unicorn 2.1.4. The fixture sets air to 67 and gravity to 272, initializes each object at rest at (20, 100), and advances 45 simulation steps without input. It samples positions before presenting them as pixels. Each pixel spans 512 internal units. Velocity changes before position, and the vertical speed limit in this atmosphere is 9,695 internal units per step.

| Reference object | Acceleration per step | Pixel Y after 20 steps |
| ---------------- | --------------------: | ---------------------: |
| Bowling ball     |                   269 |                    210 |
| Balloon          |                  −198 |                     18 |
| Basketball       |                   266 |                    209 |
| Baseball         |                   268 |                    209 |
| Tennis ball      |                   266 |                    209 |

The controlled floor scene calls the DOS geometry constructors and full simulation dispatcher. A 32-pixel bowling ball begins at (64, 100), over a 160-by-16 brick at (10, 160). The reference reports positions from the object's top left. On ticks 11, 21 and 25, the ball is at Y 128 with vertical velocities −1,415, −573 and −187. It rests there from tick 26 through tick 45. A separate contact probe supplies an already detected wall contact to distinguish the response from the contact search. At a downward speed of 4,096, flat brick returns −1,984 for a bowling ball and −3,008 for a basketball.

The timer probe runs the original initialization, IRQ handler and frame gate against emulated port I/O. The timer receives divisor 5,041. Seven interrupts leave the gate closed, and the eighth releases it. A nominal 1,193,182 Hz PC timer gives approximately 29.59 steps per second. This frequency is a calculation from the programmed timer. No physical DOS machine was timed.

The atmospheric probe also checks 58 table entries at the 15 campaign settings and eight boundary settings, giving 1,334 combinations. Fuse tests compare its movable materials against the resulting acceleration and speed limits. Rope constraints, pipe contacts and creature AI remain approximations.

## Power transmission

The drive probe invokes the original switch, motor and conveyor callbacks in sequence and supplies an existing basketball contact on the conveyor. The switched outlet feeds the motor through a socket, and a belt joins the motor to the conveyor. Opening the switch or removing the belt gives horizontal speed zero. Closing the switch with the belt attached gives −4,096 internal units per step, or +4,096 when the motor is flipped. The eight cases isolate connection and direction behavior. They do not exercise a whole puzzle or establish every callback's scheduling priority.

## Graphics

All 159 entries in the four resource volumes are indexed by name and offset. There are 61 bitmap banks containing 540 frame pieces. Of these, 281 belong to 48 numbered gameplay banks, 22 to title banks, and 237 to interface banks. The belt, rope and severed cord have no dedicated numbered bitmap bank. A count of pieces does not give an animation duration. For example, the incline bank contains four widths.

The bitmap frame table stores a count followed by every width and then every height. The 484 SCN pieces have individual offsets and use a palette base, transparent skips, repeat or literal color runs, and row positioning. The inspector checks painted spans against their declared frame dimensions. In the three BIN banks it checks LZW expansion against the expected packed size for all 56 pieces. Each of the three VGA palettes has 256 triples of six-bit channels. The inspector emits dimensions and encoding metadata without emitting images.

The OpenTIM implementation was a secondary reference for part identification and pose composition. Dimensions, span validation and frame counts above come from the supplied files. [OpenTIM reference revision](https://github.com/mrfixit2001/OpenTIM/tree/83fac1af87651fb6bcb128c9470fad236133e3c8/src)

## Levels and coverage

The inspector consumed all 87 embedded v1.02 campaign levels and three standalone freeform machines. The campaign contains 1,830 static, 430 moving and 881 inventory entries across 15 atmospheres. The serialized levels contain 52 populated rope records, 34 connected belt records and 13 occupied plug slots. These counts describe stored records, including both ends where recorded. They do not count successful solves. In the supplied freeform examples, stored endpoints include a switched outlet feeding a motor, a motor belted to a conveyor and a cord between a mechanical driver and a rocker.

The probes establish specific timing, motion and linkage behavior. They do not establish whole-campaign parity, every object's collision geometry, animation timing or all object interactions. Changes to the Fuse rules can be compared against the probes independently of rendering and networking.

## Reproduce

Run the following from `scripts/research/incredible-fuse/`. The motion and drive probes require Python 3, Unicorn 2.1.4 and a decompressed copy of the matching executable. Build `unlzexe` from the pinned upstream revision and run it on a private copy. Instructions and hash checks are in `probe_tim_motion.py`. The archive inspectors need only Python's standard library. [unlzexe revision](https://github.com/mywave82/unlzexe/tree/066aac7be3b27813c221d3b03621ad6dfaecd285)

```sh
python3 inspect_graphics.py /path/to/local/game
python3 inspect_levels.py /path/to/local/game
python3 probe_tim_motion.py /path/to/private/unpacked.exe
python3 probe_drive_chain.py /path/to/private/unpacked.exe
```
