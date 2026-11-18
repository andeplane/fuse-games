# Road contact

Fuserod checks its road edges using the separate collision routines from the 1991 DOS build. On a clear canyon segment the tyres first enter the gravel, then the car falls off the verge. On the strip a right-hand wall scrape below 40 mph knocks off up to 10 mph and pushes the car left. At 40 mph or above the same impact retires the driver. The concrete aqueduct walls have hard limits on both sides.

The adapter maps Fuse's centreline and half-widths to the original camera coordinates. Its open segments carry zero scenery flags. The original also has flags for narrowed bridges, rock, guardrail, low-speed bump and bank geometry. Those hazards depend on the course layout and remain outside these checks. The original front-view projection uses signed 16-bit camera offsets, a depth divisor and a 160-pixel horizontal centre. Its mirror has separate scale and origin. Fuse's renderer uses its own responsive projection and original course art.

## Verification

The oracle runs the original x86 instructions at `0dcb:148a`, including the separate `0dcb:1cd2` aqueduct routine. The image hash and unpacking procedure are shared with the [motor reference probe](../../tests/reference/README.md). The synthetic road segment is clear, the tyres start undamaged, the driving speed and dashboard speed agree, and the sound vector returns immediately. Every case starts from fresh emulated RAM. Each of the three courses has 19 boundary positions and seven speeds. The TypeScript test compares all 399 results, including speed, final camera position, shoulder and crash flags, with the DOS output digest.

```sh
uv run --with unicorn==2.1.4 games/fuserod/src/course/probe.py /path/to/SR2-unpacked.exe
pnpm exec tsx --test games/fuserod/src/course/contact.test.ts
```

The interpretation of the DOS data addresses and control flow used the [MIT-licensed SDL3 reconstruction](https://github.com/kylofon/street-rod-2-sdl3/blob/9a3d488143d108985422c2eeb9501e4aa5a0fe72/sr2port/src/game/race_road.c). Its license is included in [the motor directory](../motor/LICENSE.txt).
