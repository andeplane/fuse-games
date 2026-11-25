# C-Dogs ordnance reference

Cyberfuse adapts Ronny Wester's original C-Dogs DOS v1.06 firing and mobile-object rules. Launch and burst profiles live in `profiles.ts`, the update loop in `index.ts`, and serialized shot checks in `shot-checkpoint.ts`. The numeric weapon IDs are the DOS `GUN_*` values 0–15. Game code copyright © 1995–2001 Ronny Wester. The TypeScript adaptation was made on 18 November 2026. This port is distributed under GPL version 2 or later, with the license text in [COPYING](./COPYING). The upstream source port preserves the license notice. [Upstream notice](https://github.com/cxong/cdogs-sdl/blob/b20d7d7c7e69590fb35f2867721fb3520b3eb010/src/cdogs/objs.c)

The reference source archive SHA-256 is `a3abe423206205739092953ccd1191746ab8a21130079cd0c40bbe9f48a309ee`. The source identifies itself as v1.06 in `DEFS.H`. The driver checks the hashes of its four original C translation units before compiling. [Source archive](https://www.dosgamesarchive.com/file/c-dogs/cdogssrc)

## Reproducing the traces

From the repository root:

```sh
python3 games/cyberfuse/src/ordnance/probe.py /path/to/unpacked/cdogssrc
pnpm exec tsx --test games/cyberfuse/src/ordnance/ordnance.test.ts
```

The probe compiles the original `Shoot`, `GetMuzzle`, directional tables and mobile-object creation and update functions with the host C compiler. It substitutes sound, rendering, tile bookkeeping and actor hit callbacks. It fires each weapon from pixel (512, 384), once in each of the eight directions in source order. Each opening is followed by 285 successive original mobile-object updates. The first arena is empty. The second has a walkable rectangle from (448, 336) through (575, 431) inclusive and returns a hit at x = 537 with y between 374 and 397 inclusive. Both put a character in tile (32, 32) for mine proximity queries. Every random draw returns 4. Digests cover the gun lock, score cost, and the ordered list's positions, velocities, altitude, vertical speed, age, range, power and half extents at initialization and after every update.

This checks 256 launches and 72,960 updates, with ground bounces, wall deflections, all three blast rings, delayed activation, fire patches, shrapnel spread, gas, sparks, expiration and list cleanup. It does not exercise DOS instruction timing, real actor health, the DOS random-number generator or a full mission. Flame and gas visual animation retain only the two bits used to select frames. Gas burst arguments in the original C call have compiler-dependent random draw order. Cyberfuse orders them range, speed, angle. The constant-input probe cannot distinguish these orders. The Fuse snapshot boundary also limits simultaneous shots to 2,048.

Pixels sent across the simulation boundary retain the exact original 1/256 position grid. Rendering is free to rescale them. Updates prepend newborn effects for the next tick. Combat resolves actor and prop damage using the caller's collision callback. Knife contact occurs in actor movement.
