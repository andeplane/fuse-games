# Fuseheads reference build

The English and Deluxe StuffIt downloads are identical. Their SHA-256 is
`31866dfc5a14fa427553e8c276d5f2c86f6fd4cc340e0ce508c7197599ba5b7b`.
They contain Bonkheads Deluxe, a 68k Macintosh application, its art, two level
sets and the Bonkreator editor. The bundled manual identifies version 1.0.0.
The larger download is a separate Windows CD image. The engine comparison
below uses the Mac release.

## Reproduce the CPU comparison

Extract the resource forks with `unar -forks visible`. Run the Python probe
with Unicorn 2.1.4 and pass the extracted game directory. All reference code,
data and world parameters come from that local archive. The probe checks the
SHA-256 of each resource it executes or reads.

```sh
unar -forks visible -o /tmp/fuseheads-ref "$ARCHIVE"
uv run --with unicorn==2.1.4 python games/fuseheads/tests/reference/mac_probe.py \
  "/tmp/fuseheads-ref/Bonkheads Deluxe" > /tmp/fuseheads-observed.json
diff <(jq -S . games/fuseheads/tests/reference/deluxe.json) \
     <(jq -S . /tmp/fuseheads-observed.json)
```

The harness runs the original startup data initializer and game instructions
on an emulated 68020. It supplies scripted keyboard input, synthetic rectangle
data for sprite frames, QuickDraw rectangle operations, and a collector for
score increments. Input, ground geometry, coordinates, and call order are
specified in the probe. There are no random draws in the motion or contact
scenarios. Each species probe receives a fixed chart value of 10 and resets
its actor state. The original game's graphics, audio, scheduler, entire room
and campaign are outside this CPU probe.

### Movement

The original main loop (`CODE 1`, `MainLoop` at 0x4550) applies one gameplay
update then waits until the initial Mac TickCount plus the configured delay.
Executing its initialized DATA yields two Mac ticks, or about 30 updates per
second. The segment's `STANDARDPLAY` jump table dispatches GameController,
ProcessSprite, TireProcessor, EnemyProcessor, NewJewelProcessor, player
collisions and both player processors in that order on a normal pest level.
The renderer, animator and moving blocks then consume the new state.

The 36-row `motion` fixture runs ProcessSprite and Player1Processor on a
48×48 player in original world 1 conditions. Solid tiles span row 15. The
player's top-left starts at (120, 192), with zero velocity and the jump
released. Hold Right on updates 1–5 and Jump on updates 2–4, both inclusive.
Index 0 is an idle update. Each output row is [x, y, vx, vy] in sixteenths
of a pixel, after processing that update.

| Update |    x |    y |  vx |   vy |
| -----: | ---: | ---: | --: | ---: |
|      0 | 1920 | 3072 |   0 |    0 |
|      1 | 1920 | 3072 |  24 |    0 |
|      2 | 1944 | 3056 |  48 | −236 |
|      4 | 2064 | 2599 |  96 | −206 |
|     18 | 2784 | 1080 |   0 |    4 |
|     35 | 2784 | 3072 |   0 |    0 |

The sampled key changes the next integration's velocity. The first jump also
lifts the player one pixel immediately. The feet rise 124.5 pixels, land back
on their starting platform, and the player travels 54 pixels horizontally.
World 1 uses acceleration 24, speed limit 96, release drag 8, jump impulse
236 and gravity 15 in the fixed-point units above. The level's MLST resource
stores these parameters. Player1Processor tests fall velocity before applying
gravity, so the final downward velocity can exceed 240.

### Pests

The `pests` fixture runs individual paths in `CODE 2` EnemyProcessor
(0x55cc), including its calls into the original MoveSpriteTo and IncreaseSpeed.
The kind-7 pest starts on column 4 at x=128 with 150 points of value, speed
16, increment 7 and cap 44. Applying marker 999 at the center of the
supporting tile knocks it into the air with velocity (0, −160). The timed
probe advances the counter across its two thresholds. At age 251 the warning
animation starts. The pest is still down at 500 and wakes at 501, with speed
23 and a new kick value of 200.

Setting the active pest's top-left to (−25, 303) runs the left escape branch.
It reappears at the configured left entrance (−16, 48), heads right at speed
30 and is worth 250. At an upper side exit, ordinary pests wrap around at the
same height. EnemyProcessor tests x<−24 or x>639 and y>302 for a lower exit.
Some species have distinct exit heights.

A stunned pest with a rect at x=100..132 is immune to a player's kick while
their effective rectangles just touch. Moving the player one pixel closer
awards 250, switches the pest to its departing pose, copies the player's
horizontal velocity, and applies −160 vertical velocity. The kick test shrinks
the pest's rect by three pixels at either side and five at the top. It shrinks
the player's rect by three at either side, ten at the top and five at the
bottom. Living pests use a different contact test.

The `specialEnemy` fixture invokes SpecialEnemy (0xaee8) with sustained ground
contact for different kinds. Player 1 is living, left of the pest, and above
its feet. Each row is [vx, vy, pose, animation rate] at calls 1, 2, 9, 10, 11
and 12. Kinds 7 and 15 retain their horizontal velocity. Kind 19 turns and
accelerates toward the player. Kind 23 stops, then launches on the tenth call.
Kind 27 varies its speed. Kinds 52 and 56 depend on animation phase for their
leaps. Only the decision routine is advanced in this fixture.

### Additional rules from the executable and manual

- GameController reads the 26-byte ENDT entries in order. It waits until
  elapsed updates exceed the entry's spacing and allows seven outstanding
  spawns. The ordinary spawn passes the signed initial velocity, the temper
  increment, the point value and the two entrances to SwitchEnemyDeadToAlive.
  A nonnegative velocity selects the left entrance. A negative velocity
  selects the right one.
- Each player starts with two spare lives. KillPlayer decrements that counter.
  BringPlayerBack stops respawning when it is negative. During the normal
  return animation, the troll emerges to y=416, waits for jump or a timeout of
  900 updates, climbs over 16 updates and becomes vulnerable at y=368. Every
  10,000 score awards a spare life.
- Runtime tile types 4–8 implement quicksand, regular springs, super springs,
  magnets and movable blocks. World 1's normal spring produces vy −270, or
  −290 with a timed jump. A super spring produces −320 or −349. Type 24 kills
  an unprotected player standing on its center. Type 25 suppresses drag.
- Both the manual and the bundled Bonkreator editor describe a six-level
  underworld with five pest levels and a ruler fight. Shrew Man-Chew releases
  rats, T. Wrecks has no projectile special, and D. Evil can use two
  fireballs. Ruler health and attack options come from the level pack.
- The manual describes TNT toggling grounded pests between active and
  unconscious. Airborne pests escape the blast. A full crate has three
  charges and Blastidian replenishes it. The guide also describes boosts
  from another troll, destructible webs and climbing.

The isolated CPU cases establish these behaviors for the pinned build and
inputs. They leave full campaign timing, boss AI parity, hazards, powerups,
two-player interactions, input-to-display latency and sound timing unmeasured.
