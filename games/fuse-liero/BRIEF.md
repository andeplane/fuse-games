# Fuse Liero

Real-time worms combat in a destructible neon cavern, inspired by Liero and OpenLieroX. Move, jump and swing into position; switch between rockets, grenades and a scattergun to make new paths and score frags. One round is one cave deathmatch; win rounds to win the match. No progression in this first version.

Fixed whole-arena camera, keyboard and multitouch controls, five players plus spectators. Target 60 FPS on desktop and modern phones, measured in browser rather than assumed. Pure deterministic TypeScript simulation, Canvas presentation, shared Fuse room runtime and WebRTC transport. All terrain, projectiles, bot decisions and random state checkpoint with the round.

Visual direction: luminous lime worms, cyan and magenta opponents, dark violet caves with bright cut edges, readable white health/weapon HUD. Adjectives: electric, chunky, subterranean, explosive, legible. Extend Fuse's existing system; no new site-wide design world.

1. Engine: deterministic motion, terrain destruction, rope, three weapons, respawn, bots, finite rounds; test replay and checkpoints.
2. Integration: scoped held controls, shared menus/lobby, solo/online/display, confirmed play metrics; test two-browser replication and recovery.
3. Presentation: neon cave renderer and touch controls, real gameplay capture, gallery/desktop discovery, screenshot and frame timing evidence.

Out of scope: binary compatibility, OpenLieroX map/mod imports, original game assets, ranked history and production deployment. This is an original Fuse adaptation, not the native C++ executable embedded in a page.
