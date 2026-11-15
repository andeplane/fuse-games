# Classic mod data provenance

`classic-script.lgs` is the exact `share/gamedir/Classic/script.lgs` from
OpenLieroX commit `0a20c6d0a10ed63b28a15f05c771913c294efbf6`:

https://github.com/openlierox/openlierox/blob/0a20c6d0a10ed63b28a15f05c771913c294efbf6/share/gamedir/Classic/script.lgs

- Bytes: 12,004.
- SHA-256: `ed0ab6247796c975cfea0e58c88ed2c2f8d930f58f88078b20cc476fa4e04d6d`.
- Native script version: 7; embedded mod name: `Liero v1.0`.
- Weapons: 38; recursively embedded projectile descriptors: 69.

This is the packaged Classic mod. The similarly named plaintext example under
`tools/GameDecompiler/share/Classic` has 37 weapons and different tuning; it is
not the source of this catalog. `Liero v1.11` is a separate mod.

`scripts/fusero-decode-classic.ts` is an altered TypeScript translation of the
binary-reading portions of `src/common/CGameScript.cpp` at the same commit,
especially `CGameScript::Load`, `CGameScript::LoadProjectile`, and
`Wpn_Beam::read`. Original source headers credit Jason Boettcher, Dark Charlie
and Albert Zeyer and identify the code as LGPL. The pinned root `COPYING.LIB`
begins **GNU Library General Public License, Version 2, June 1991**; retain the
actual upstream notices rather than substituting a different license version.

`original-license.txt` is copied byte-for-byte from
`doc/original_source_release/License.txt`, retaining the original software
license and naming conditions. It does not replace the notices applying to
later OpenLieroX source contributions. The project licensing record owns the
complete distribution notices.

Regenerate the typed catalog with:

```sh
pnpm exec tsx scripts/fusero-decode-classic.ts
pnpm exec tsx scripts/fusero-decode-classic.ts --check
```

The generator checks the source digest, native header, bounds and full byte
consumption. Weapon ids retain file order. Projectile ids are preorder traversal
indices, retaining each descriptor's native byte offset. Native numeric values
are preserved: `recharge` is divided by ten by the original runtime, `rofMs` by
one thousand, and `drain` is a percentage. Display fields and obsolete native
Exp/Touch action blocks are retained so replacing graphics does not discard
source data or accidentally alter collision geometry.

The four small PNG files in `animation/` are exact pinned source fixtures,
not the game's replacement artwork. Native `ANI_ONCE` projectile expiry uses
bitmap width divided by height (`PhysicsLX56_Projectiles.cpp:1264–1270`), so
these dimensions are physical data. The generator verifies each PNG digest and
emits its geometry separately from the logical projectile hitbox:

| File          | Native location under `share/gamedir/` | Width × height | Frames |
| ------------- | -------------------------------------- | -------------- | ------ |
| Flame.png     | `Classic/gfx/Flame.png`                | 96 × 16        | 6      |
| FloatMine.png | `Classic/gfx/FloatMine.png`            | 32 × 8         | 4      |
| None.png      | `data/gfx/None.png`                    | 1 × 1          | 1      |
| ZimmFlash.png | `data/gfx/ZimmFlash.png`               | 88 × 22        | 4      |

The global `data/gfx` entries follow `LoadGSImage`'s fallback after the mod's
own `gfx` directory. Source image digests are retained in generated descriptor
metadata and the generator. Replacement graphics must preserve the native
animation expiry timing independently of how their own frames are drawn.

The catalog is immutable simulation data. `Standard 100lt` startup selection
is independently traced in `FeatureList.cpp` (its `Default` column) and
`Options.cpp` (registering wrappers with `defaultValue`), then loaded by
`Game_loadWeaponRestrictions.cpp`. This is the fresh-configuration default;
saved user preferences can select another restriction preset.

## Default native level and physical terrain masks

`default-level.lxl` is copied byte-for-byte from
`share/gamedir/levels/Dirt Level.lxl` at the same pinned commit:

https://github.com/openlierox/openlierox/blob/0a20c6d0a10ed63b28a15f05c771913c294efbf6/share/gamedir/levels/Dirt%20Level.lxl

- File bytes: 59,879.
- File SHA-256: `a5aa3ea9a3327eddbe1c182a56713a74f91a8967fd128774ee36a20c50812403`.
- Native dimensions: **504×350 world pixels**, without scaling the physical plane.
- Native LXL version: 0, image format 1; theme `dirt`.
- Material flag plane SHA-256: `69d6a395a47006fc548f227566053a1962be7447d9c398e904739415d9174b80`.
- Physical pixels: 11,855 air, 159,596 dirt, 4,949 rock.

The file embeds a zlib payload containing a background RGB image, a foreground
RGB image and then an explicit one-byte-per-pixel LX material flag plane. The
flag plane, **not image colours**, determines physics. `PX_ROCK` takes precedence
over `PX_DIRT`; the fallback is empty, matching `Material::indexFromLxFlag`.
The native loader permits the fixture's one unused terminal payload byte.

`scripts/fusero-decode-level.ts` is an altered TypeScript port of the image-map
read paths in `src/common/MapLoader_LieroX.cpp`, whose header credits Albert
Zeyer and identifies the code as LGPL. It retains source digests and emits only
the physical geometry into `engine/classic/level-data.ts`. Replacement neon
graphics do not change collision pixels. Each new world receives a separate
mutable row container over the immutable generated strings.

```sh
pnpm exec tsx scripts/fusero-decode-level.ts
pnpm exec tsx scripts/fusero-decode-level.ts --check
```

The six `dirt-*.png` files are exact physical-mask fixtures from
`share/gamedir/data/themes/Dirt/hole1.png` through `hole5.png`, plus
`share/gamedir/data/gfx/greenball.png`. Their per-file SHA-256 values are retained
in `engine/classic/terrain-masks.ts`. Pink hole pixels remove dirt; black pixels
are transparent, and the coloured rim also fills dirt when placing terrain.
Greenball uses its distinct 8×9 footprint. These masks are gameplay data even
when the displayed blast and dirt artwork change.

Source material and decoder notices are retained under the distribution's
existing `COPYING.LIB` and original source-release license records. No separate
embedded level-author notice was present in this binary; provenance is the
unmodified file in the pinned upstream distribution.

## Larger native arenas

`castle-strike.lxl`, `liero-factory.lxl` and `jail-break.lxl` are byte-for-byte native levels from
the same pinned release's `share/gamedir/levels/` directory. Their bytes were
also checked against `OpenLieroX.app/Contents/Resources/gamedir/levels/` in the
official `openlierox_20260717.2_macos.zip` distribution. These are original
arenas, not enlarged copies of Dirt Level; their material planes and physical
world-pixel sizes are retained.

Fusero now starts on Jail Break in response to the user's explicit request
for a larger arena with substantial destructible dirt. Dirt Level remains selectable and retains the upstream
startup-default provenance described above; the Fusero content-default change
does not rescale or retune any native level.

| Fixture             | Native path                | World pixels | SHA-256                                                            |
| ------------------- | -------------------------- | ------------ | ------------------------------------------------------------------ |
| `castle-strike.lxl` | `levels/CastleStrike.lxl`  | 1350 × 550   | `9b26d3f417e3a9a0c61909bf3b1d841831a1a492f37e2d45869e8f92d0d37517` |
| `liero-factory.lxl` | `levels/Liero Factory.lxl` | 1200 × 480   | `25289df1b4561101a8cb1405acb75e9901755ee36200744c48622cb424ca171d` |
| `jail-break.lxl`    | `levels/JailBreak.lxl`     | 1200 × 600   | `8c03fb4b89ed8f6a414ac25569fffc32c219d9e29f32ad34ea2af62fa2e2aa56` |

The same `scripts/fusero-decode-level.ts` generator extracts all four levels.
It verifies both source-file and physical-flag-plane digests and emits compact,
immutable material rows. `--check` verifies every generated arena. Native
foreground/background colours do not decide collision materials. Focused level
tests compare every material pixel of all larger arenas with their original
flag planes and exercise selected-level checkpoint recovery.
