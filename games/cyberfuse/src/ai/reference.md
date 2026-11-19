# C-Dogs character decisions

The hostile controller adapts the released DOS v1.06 `AI.C` (SHA-256 `b5773f78f5c817c7960ebe0a4c5fbed8afe56c11eee8bb7883a11a2c0a698cd5`). Its behavior depends on previous movement, its delay, which side of a wall it is following, sleep state, visibility and the mission RNG. The simulation passes visibility and collision queries into the controller. DOS used actor draw calls to wake enemies. The Fuse co-op and dogfight seat bot uses a separate policy for playing through the ordinary player input interface. [Upstream source history](https://github.com/cxong/cdogs-sdl) · [DOS source distribution](https://www.dosgamesarchive.com/file/c-dogs/cdogssrc).

The fixture in `ai.test.ts` records the decisions of the original compiled C for twelve one-command scenarios. It compares the command, facing before the command is applied, delay, detour turn count, gun lock and number of random draws. Each hostile starts at (32,32), facing and random draws are specified by each row, and one living player stands at (64,32). Wall collision is either open or blocked in all directions. These fixtures cover the decision step on normal difficulty. They do not measure DOS real-time rendering or an entire mission.

To reproduce the six output fields per row, set `DOS_SRC` to the unpacked source directory and run from this directory:

```sh
probe_dir=$(mktemp -d)
cp probe.c "$probe_dir"
for src in "$DOS_SRC/AI.C" "$DOS_SRC/DEFS.C" "$DOS_SRC"/*.H; do
  cp "$src" "$probe_dir/$(basename "$src" | tr '[:upper:]' '[:lower:]')"
done
cc -std=c99 -Wno-unknown-pragmas "$probe_dir/probe.c" -o "$probe_dir/probe"
"$probe_dir/probe"
```
