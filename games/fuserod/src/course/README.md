# Road contact

Fuserod checks its road edges using the separate collision routines from the 1991 DOS build. On a clear canyon segment the tyres first enter the gravel, then the car falls off the verge. On the strip a right-hand wall scrape below 40 mph knocks off up to 10 mph and pushes the car left. At 40 mph or above the same impact retires the driver. The concrete aqueduct walls have hard limits on both sides.

The adapter maps Fuse's centreline and half-widths to original camera coordinates. Fuserod places truss bridges, a rough surface, rocks and guardrails at new authored distances along the canyon. The renderer and contact detector read the same feature record. Trusses narrow the safe corridor; entering rough pavement above 60 mph or striking a rock above 30 mph ends the race. The original rock trigger was a projected sprite intersection; Fuserod uses the shared world position and a collision radius of 0.14 half-widths. The channel banks tilt the cockpit asymmetrically with the original roll angles. The original additionally deforms the channel floor, pitches the camera, and kicks the tyres at a central trough.

A faster driver closes on a leading rival within one 64-unit segment and 180 original lateral units. The DOS gate also tested two historical sprite poses to establish which driver was behind. Fuserod uses their relative positions on the preceding tick and sweeps the crossing for network play with more than two drivers.

The original front-view projection uses signed 16-bit camera offsets, a depth divisor and a 160-pixel horizontal centre. Its mirror has separate scale and origin. Fuse's renderer uses a responsive projection and original course art.

## Verification

The oracle runs original x86 instructions at `0dcb:148a`, including the separate `0dcb:1cd2` aqueduct routine, and the left/right bank functions at `0dcb:9d9c` and `0dcb:9e4e`. The image hash and unpacking procedure are shared with the [motor reference probe](../../tests/reference/README.md). The synthetic segment carries the requested flags, the tyres start undamaged, the driving speed and dashboard speed agree, and the sound vector returns immediately. Every case starts from fresh emulated RAM. Six TypeScript tests compare 399 contact decisions on clear roads, 392 flagged canyon cases, and 401 banking samples against the DOS oracle and exercise multi-car contact boundaries.

```sh
uv run --with unicorn==2.1.4 games/fuserod/src/course/probe.py /path/to/SR2-unpacked.exe
pnpm exec tsx --test games/fuserod/tests/course.test.ts
```

The interpretation of the DOS data addresses and control flow used the [MIT-licensed SDL3 reconstruction](https://github.com/kylofon/street-rod-2-sdl3/blob/9a3d488143d108985422c2eeb9501e4aa5a0fe72/sr2port/src/game/race_road.c). Its license is included in [the motor directory](../motor/LICENSE.txt).
