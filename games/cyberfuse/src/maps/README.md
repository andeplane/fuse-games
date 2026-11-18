# C-Dogs DOS mission maps

Cyberfuse adapts Ronny Wester's C-Dogs mission generator and placement rules to TypeScript. The port is distributed under GPL-2.0-or-later. See [COPYING](../../COPYING). The reference is Wester's released DOS source archive, SHA-256 `a3abe423206205739092953ccd1191746ab8a21130079cd0c40bbe9f48a309ee`, particularly `MAP.C`, `MISSION.C`, `AI.C` and `CDOGS.C`. [Source archive](https://www.dosgamesarchive.com/file/c-dogs/cdogssrc)

Every mission uses its original dimensions, room/access probabilities, square and wall counts, prop densities, collision footprints and extraction bounds. The Watcom random stream starts from the campaign's layout seed (zero by default) plus ten times the mission index within that campaign. Keycards unlock successively higher access rooms. The original executable reseeds actor placement from a clock after setting up the map. Cyberfuse uses a separate match-seeded actor stream for reproducible replay and supports up to five operatives.

The two probes compile portions of the original DOS source with a host C compiler. The geometry probe emits complete tile/access hashes and exit bounds. The placement probe reads all 73 original campaign mission records and two dogfight arenas from the DOS release. It runs the original setup code with sinks for allocated objects and trigger descriptors, recording each prop, collectible and key's ordered pixel position, sprite and collision flags. The TypeScript tests compare these traces using the default campaign layout seed. They also exercise deterministic actor placement and valid spawns across every mission. Exact clock-seeded enemy/player positions from an original DOS execution are outside those comparisons.

```sh
python3 games/cyberfuse/src/maps/probe.py /path/to/extracted/cdogssrc
python3 games/cyberfuse/src/maps/objects-probe.py /path/to/extracted/cdogssrc /path/to/extracted/cdogs106
pnpm exec tsx --test games/cyberfuse/tests/maps.test.ts
```
