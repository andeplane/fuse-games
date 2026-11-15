# Classic weapon and projectile sounds

All eleven files under `public/fusero/audio/` are unmodified Ogg assets from
OpenLieroX commit `0a20c6d0a10ed63b28a15f05c771913c294efbf6` (111,657 bytes total).
They are upstream recordings, not original Fusero assets or generated effects.
No pitch, timing, waveform, encoding or loudness changes were made.

The packaged Classic binary names thirteen distinct case-sensitive `.wav`
references across its 38 weapons and 69 projectile descriptors. They resolve to
eleven source files. All of these references use the global fallback directory;
the mod's `Classic/sfx/` contains only the unrelated `dirt.ogg` and `ZZZdirt.ogg`.
There are no missing weapon/action sample references in this pinned catalog.

Native resolution evidence at the same commit:

- `src/common/CGameScript.cpp:1185–1210`, `LoadGSSample`: try the mod's `sfx`
  directory, then `data/sounds`, with ten simultaneous plays per sample.
- `src/sound/Sounds.cpp:97–123`, `LoadSample`: try the requested filename and
  then the same basename with `.ogg` when a requested `.wav` is unavailable;
  cache the result and retain the simultaneous-play limit.
- `src/common/FindFile.cpp:319–360`, `CaseInsFindFile`: resolve filename case
  differences against actual directory entries.
- `src/common/PhysicsLX56_Projectiles.cpp`, `Proj_Action::applyTo`: action
  samples play only from the native `UseSound` branch. The combat port attaches
  that reference to the existing effect; presentation does not guess sounds
  from an explosion's size or create synthetic substitutes.

Every source path below is under `share/gamedir/data/sounds/`:

| Shipped file   | Native catalog references | SHA-256                                                            |
| -------------- | ------------------------- | ------------------------------------------------------------------ |
| Bazooka.ogg    | `Bazooka.wav`             | `411a1c331d6324ec6af8112d0efc20851ba1edf849484ddfd5ff16ffb50f6d78` |
| Larpa.ogg      | `Larpa.wav`               | `6979ba297e360803a633b03613537217cee2a481a3821fe422e943dc95402920` |
| Shot.ogg       | `Shot.wav`                | `d24d415c8eaa38035c4730335e73574cf082b1d5d1dfc9c5c748c3037a1cde92` |
| Shotgun.ogg    | `Shotgun.wav`             | `76dca73e416d2d33e5f7fb8495a2f1a51d719c70766026cf959ede4f9cf966c3` |
| blaster.ogg    | `Blaster.wav`             | `0c462a2bf2c27a54ad6dec6539787205f62c66fa38e9c2fc5a0ed8b6fc5bfb3d` |
| exp2.ogg       | `Exp2.wav`                | `334ad9c4f904cad04fe994f902030a971521b6d95f2724ba967b21d08e8ec1e6` |
| exp3.ogg       | `Exp3.wav`                | `d6b256f0e7e9e3930224442d5e7a3255e361b3d5b2b9bc69516be4dffa077d20` |
| exp3a.ogg      | `Exp3a.wav`, `exp3a.wav`  | `df3e65c56cc8c185955b27ba9ff8b2301dd06b1dc74ae0363ce393a570ae91eb` |
| rifle.ogg      | `Rifle.wav`               | `f5be2aa40a2ae3539b87fe64be65bdc095b027545eda1a95fb71c171b3563cd7` |
| sm_explode.ogg | `sm_explode.wav`          | `8e240547d81353abd46bf6ce1912337b38e13efbb9cec8e5796e7a6e2b007d3c` |
| throw.ogg      | `Throw.wav`, `throw.wav`  | `08f3a84e17e7e7623d8eb75e5569d745240ea9a06c08b5f649c157a2baf755b8` |

Source directory:
https://github.com/openlierox/openlierox/tree/0a20c6d0a10ed63b28a15f05c771913c294efbf6/share/gamedir/data/sounds

To reproduce a file download without changing its bytes:

```sh
gh api 'repos/openlierox/openlierox/contents/share/gamedir/data/sounds/Bazooka.ogg?ref=0a20c6d0a10ed63b28a15f05c771913c294efbf6' \
  -H 'Accept: application/vnd.github.raw+json' > public/fusero/audio/Bazooka.ogg
```

The assets remain covered by the applicable upstream distribution notices.
`original-license.txt` preserves the original Liero Xtreme software notice;
the project's complete licensing record also retains later OpenLieroX notices.
The pinned root `COPYING.LIB` actually begins **GNU Library General Public
License, Version 2, June 1991**. No separate per-file license notice is present
in these two sound directories; these files must not be labeled CC0 or claimed
as Fusero creations.

`src/app/audio.ts` uses an explicit audio/fetch/clock capability boundary. It
loads and decodes each resolved sample once, caps simultaneous voices at ten
per sample, and deduplicates speculative and confirmed frames by match and
effect id. The master sound switch stops active voices, hidden tabs suspend
audio, and `?mute` forbids opening an audio surface or fetching samples. Late
asynchronous loads do not replay stale shots after mute, a new match or a
hidden tab. Failed sample requests have a five-second retry backoff.

Verification:

- `pnpm exec tsx --test games/fusero/tests/classic-audio.test.ts`: exact source
  hashes and complete native-reference coverage, typed fake audio/fetch/clock
  boundaries, cache and rollback deduplication, forced mute, visibility,
  cancellation, bounded retries and voice limits.
- Headless Chrome's `OfflineAudioContext.decodeAudioData` decoded all eleven
  shipped Ogg files successfully without playing sound. They decode to stereo
  samples; durations range from approximately 0.093 to 2.090 seconds.

Audible acceptance remains a human playtest: listen for the original weapon
shots, thrown grenades and the distinct impact/explosion samples. Muted agent
verification establishes decoding and event behavior, not listening evidence.
