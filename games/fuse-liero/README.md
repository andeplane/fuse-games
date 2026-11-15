# Fuse Liero

Original Fuse adaptation of Liero/OpenLieroX-style real-time worms combat, with a full neon treatment. Five worms, a destructible cave, ninja ropes, rockets, grenades and a scattergun. First to seven frags wins a cave; two caves win the match. A cave times out after three minutes and ranks players by frags, then deaths, then health, then slot. Deaths respawn after 1.5 seconds with a short protective grace period.

## Play

Run `pnpm dev`, then open the printed URL plus `/fuse-liero/?mute`. PLAY → Single player starts a match against three bots. PLAY → Host room creates an online room. Take a seat, invite friends or add AI, then START MATCH. OPEN TV SCREEN adds a display-only spectator; phones joining the room can control their worms with the touch buttons. A refreshed member recovers play from a peer.

| Keyboard              | Action                                    |
| --------------------- | ----------------------------------------- |
| A / D or left / right | Move                                      |
| W / S or up / down    | Rotate aim                                |
| Space                 | Jump; hold while attached to reel rope in |
| F / J                 | Fire                                      |
| R / K                 | Hold ninja rope; release to detach        |
| Q / E                 | Switch rocket → grenade → scattergun      |

Aim into a wall or ceiling before holding rope. Rockets dig paths on impact; grenades bounce before detonating; scattergun fires a close spread. Movement, health, frags, rope anchors and terrain all belong to the deterministic engine.

## Architecture

The cave is 1536×864 world pixels, four times the area of the first prototype. Each player follows their own worm in a 640×360 viewport (384×288 on a narrow phone), with a minimap showing the camera rectangle and other living worms. The shared TV display and unseated spectators keep the full-world overview. Camera bounds, aim look-ahead and zoom affect presentation only; every browser still simulates the same complete cave.

OPEN TV SCREEN opens a separate window, keeping the source page visible while the display recovers its world. It can be moved to a connected TV; a separate device can open the same display URL. A hidden source tab cannot supply a recovery snapshot under the shared runtime's existing visibility policy.

`src/engine/` owns the pure fixed-step rules, seeded cave and bots, and validated world snapshots. `src/online/` folds scoped held inputs through `fuse-netcode`, fences match/round/member generations and restores validated room checkpoints. `src/app/` renders the current view and connects keyboard/multitouch inputs to that runtime. Rendering never advances online physics. The room service coordinates membership and WebRTC signalling; it does not simulate or relay gameplay.

One analytics round is one cave deathmatch, counted for participating browsers after countdown. Confirmed frames drive the shared `fuse-ui/play-metrics` lifecycle; spectators and menu backgrounds do not count. Account history/rankings are not credited in this version.

This is an original TypeScript adaptation, not a binary port. It does not load OpenLieroX skins, maps or mods or connect to OpenLieroX servers. See [CREDITS.md](CREDITS.md) for reference and asset provenance.

## Verify

`pnpm exec tsx --test games/fuse-liero/tests/*.test.ts` covers engine, rollback, checkpoints and held-control cancellation. `ONLINE_URL=http://localhost:PORT/ pnpm exec tsx scripts/fuse-liero-smoke.ts` exercises real browser rooms. Use `pnpm gallery:capture fuse-liero` against a built server (or set `GALLERY_URL`) to refresh the real-play gallery image.

Browser tests and emulated touch are technical checks; human playtesting and physical-phone acceptance remain separate. No production deployment is authorized by this implementation task.
