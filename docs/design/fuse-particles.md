# Fuseparticles

Fuseparticles adapts the original [Particle Defence engine at e0eb939](https://github.com/andeplane/particle-defence/tree/e0eb939c822286e4ae6c05bbe8be5fa3742f0033) to the Fuse World room runtime. A match is one round. Particles spawn and bounce automatically. Players spend gold on upgrades, research, towers and a pulse. The last core standing wins. The time limit compares remaining core health, with a draw on equal health.

The room supports one to four humans and optional AI within four total seats. A battle needs at least two occupied seats. The map and seed are room choices. Duel bases occupy opposite edges. Three- and four-seat maps clear triangular and corner spawn areas and carve connections through the same map families. The Fuse port uses the original rules as its reference and adapts timing, targeting, bot decisions and economy where multiplayer requires it.

A fixed 20 Hz simulation runs on every peer. The seeded map, RNG state, research and construction timers, particle state, territory and sampled results are checkpointed. Only the held seat and its current stream generation can spend gold in a match. Bots use the same command validation and resource rules. The room service only coordinates peers.

Canvas rendering reads simulation state and keeps lighting and impact effects outside the simulation. The results screen uses shared Fuse components and opens the original twenty timeline metrics, territory and one strategy profile per participant. Frontline measures progress from each core in cells so that it applies to any orientation.
