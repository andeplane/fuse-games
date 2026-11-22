# Fuse Galaxy

Fuse Galaxy is a session-length descendant of Planetarion: up to six players in teams ("galaxies") build an economy, research, produce fleets and fight over asteroids for 30 to 45 minutes, with bot-run neutral planets on the map. This note covers the headless engine in `games/fuse-galaxy/`. There is no page yet: no `index.html`, no `portal.json` and no analytics. Those arrive with the first playable screen.

## Shape

| Module                                  | Role                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/`                           | The rules: `applyTick`, the world and its `Rules`, command checking, views, the legal-command mask, hashing and the environment. Imports nothing else |
| `src/bots/`                             | Two stateless bots that play through a view and the legal commands like any other player: an economy bot and a raider; `roster.ts` deals them out     |
| `src/cli/` and `scripts/fuse-galaxy.ts` | The terminal client (`pnpm galaxy`); the script only supplies the real terminal and clock                                                             |

`applyTick(world, submissions, rules)` returns the next world and never changes its arguments. Every world the engine hands out is frozen all the way down, battles and formations included, so a bot or a client holding a world or a view cannot change the match either; a write throws. It reads no clock, does no I/O and uses whole numbers only (`math.ts` has the integer division, square root and percentage it needs). Randomness comes from the generator state stored in the world, so it is checkpointed with everything else. `tests/architecture.test.ts` fails on an import that leaves the engine folder and on floating-point or ambient calls inside it.

Every balance number lives in one frozen [`Rules`](../../games/fuse-galaxy/src/engine/rules.ts) object with `DEFAULT_RULES` as the default. A variant is another object, never a code change. A change to a number or a rule bumps `Rules.version` (now 3), and the pinned hashes in `tests/determinism.test.ts` and `tests/combat.test.ts` change with it.

## State

The world holds the tick, the generator state, the phase and result, the planets (one per player, at a whole-number position on a square map), the fleets, the battles in progress, the teams, each player's knowledge and the events of the last tick.

- A planet has resources (metal, crystal, eonium), asteroids per resource, structures, research levels, the construction and research queues, ship orders, the ships at home with their formation and whether they are sheltered, what it earned by fighting (xp), and its value, score and the score's public parts.
- A fleet has its owner, mission, target, ships, formation, phase (outbound, stationed, fighting, returning) and the ticks left in it.
- A battle has its planet, the rounds fought, the damage each fleet's squadrons carry and the wreckage so far.
- A team has its members, a fund, a tax rate, a commander, each member's vote and a defence-priority planet.
- Knowledge is the scout reports a player has gathered. Reports are dated and never updated in place.
- Seats are dealt a place at a time across the teams (in a 2v2v2, team 0 is planets 0 and 3), then the neutral planets, which belong to no team.

## One tick

The phases always run in this order:

1. Commands, player by player in id order and each player's in the order sent. A command is checked against the state the commands before it left.
2. Income: base, asteroids and structures, with the team's tax diverted to its fund.
3. Construction, research and ship production advance.
4. Fleets move, arrive, observe and come home. Probes in orbit report, and a planet that notices them shoots some down. An attack that lands joins the battle at its target or starts one.
5. One round of every battle.
6. A battle that is over: asteroids captured, wreckage salvaged, the attackers sent home.
7. Value and score.
8. The match ends at the tick limit; the team with the highest score (its members plus its fund) wins, and a tie at the top is a draw.

The tick an order is placed on counts as its first tick, so a structure with a build time of N ordered on tick T is finished on tick T+N−1.

## Commands

Commands are a discriminated union: `initiateAsteroid`, `buildStructure`, `startResearch`, `produceShips`, `launchFleet`, `recallFleet`, `setFormation`, `setShelter`, `voteCommander`, `setTax`, `grant`, `setDefencePriority` and `donate`. They arrive as untrusted data. `parseCommand` checks the shape, `commandProblem` checks it against the world, and a refused command becomes a `rejected` event with its reason. Nothing throws on bad input, and a refused command changes nothing. Input here means plain data, as `JSON.parse` gives it: a submission that is not even a record is refused as sent by nobody, while an object whose getter throws is outside what the engine promises. A match that has ended refuses whatever it is sent, once to each sender.

`viewFor(world, player)` is the only thing a player or a bot sees, and `legalCommands(view, rules)` lists what that player can do now with its cost and limits. The list is built by asking the engine's own check about each candidate, so the mask and the engine cannot disagree; `tests/view.test.ts` checks both directions on bot-played matches.

## Rules

- **Economy.** Income per tick is a base amount plus a yield per asteroid (raised by mining research) plus refineries. Initiating an asteroid is instant and costs Planetarion's quadratic in the number already owned of that resource.
- **Construction.** One structure in progress and one queued, paid when ordered, each further copy costing more. A research lab opens research and a shipyard opens ship production; more of either shortens the work up to a cap.
- **Research.** Five branches (travel, hulls, sensors, mining, jamming), one level in progress and one queued. Hulls opens the heavier ship classes.
- **Ships.** The probe, six warships (fighter, corvette, frigate, destroyer, cruiser, battleship) and the capture pod. Several orders run side by side; an order's time does not depend on its size.
- **Teams.** Every member votes for a commander; the most votes wins, the sitting commander wins a tie and the lowest id wins a tie without one. The commander sets the tax (up to the rules' maximum), grants from the fund to members and flags one member as the defence priority. Any member may donate to the fund.
- **Fleets.** A fleet flies at its slowest ship's speed. `defend` stations it at a teammate for a while and brings it home; its watch does not run down while the planet is fought over. `observe` flies probes past any planet that is not on the sender's team and comes home with a report; `orbit` leaves them there to report every tick. `attack` musters for longer and flies at half speed, then fights at the target until the battle is over. A recall flies back as far as the fleet had come.
- **Bash limit.** A seat may not launch an attack on a seat whose score is below a quarter of its own. It is checked at launch only; a fleet on its way lands whatever the scores do since. Neutral planets can always be attacked.

### Battles

A battle is fought at a planet between every fleet attacking it and, on the other side, its home fleet (unless sheltered) with the fleets stationed there to defend it. Every attacker is on one side, whatever its team: in a 2v2v2 two teams that attack the same planet fight beside each other, not each other. One round is fought each tick, until one side has nothing left that fights or the rules' ten rounds have been fought. A fleet that arrives during a battle joins its side on the tick it lands. The engine follows squadrons, not ships: a class's count and its pooled damage, so a round costs the same for ten ships as for ten thousand.

**Formations.** Each fleet, and the home fleet, places every class in one cell of a 3×3 grid (front, middle and rear line; left, centre and right column). A squadron's depth is how many occupied cells of its own side stand in front of it in its column, so an empty front line leaves what is behind it in the front. A squadron can fire at an enemy squadron when its depth plus the target's is less than its class's range; one whose column holds no enemy at all has turned the flank, and then the target's depth does not count. `setFormation` takes a named formation of the rules (`line`, `wall`, `column`, `wings`) or a cell per class moved; a fleet launches in the home fleet's formation.

**A round.** The classes fire in the order of their initiative, the lowest first; classes with the same initiative fire together, so what one destroys still fires back. A squadron fires its shots at the classes on its target list in that order, at whatever of each it can reach. A shot destroys at most one ship, so a heavy gun wastes what it does past a light hull's armour. Frigates fire freezing shots: for every armour's worth, one ship of the target does not fire this round, unless its turn has already come. Fighting earns xp: an attacker half the value it destroys, scaled by the target's score against its own (between a half and double), a defender all of it.

**The counter triangle.** Three fleets of about 80 000 resources each, all in the line formation: a line of 200 corvettes and 40 destroyers beats a swarm of 1000 fighters, 36 cruisers (artillery) beat the line, and the swarm beats the artillery, whichever side attacks. `tests/combat.test.ts` fights all six pairings.

**After the battle.** Attacking fleets that still have pods take asteroids, whether or not the defence still stands: at most a quarter of the planet's asteroids, scaled down in proportion when the planet scores below 60% of the largest attacker, and never fewer than one. The attackers share them by the worth of their fleets as far as their pods carry, the remainder going to the worthiest; each pod is spent on the asteroid it carries, and the planet gives up whichever kind it has most of. The planet's owner salvages 30% of what every ship destroyed there cost. Leaving a battle (recalling a fleet from it, or sheltering the home fleet during it) leaves 15% of each class behind, at least one ship, as wreckage. A home fleet sheltered before the attack lands loses nothing and fights nothing, and the attackers take their asteroids.

### Fog

Intel comes down to one comparison, the watcher's sensors research against the other side's jamming, which gives a detail level from 1 to 3: at 1 a probe sees asteroids and a warning says who is coming and when; at 2 structures, research and the ships present rounded down to a step; at 3 the exact counts, the stock and how the ships stand.

- A view shows the player's own planet and team in full, allies' planets and fleets, every planet's position and side, the public scoreboard (each planet's and team's score in its economy, military and technology parts, and asteroids mined), and the newest report on each planet that the player or a teammate has gathered.
- An attack on the player or a teammate shows up as a warning once it is within 60 ticks of landing, ten earlier for each sensors level and eight later for each of the attacker's jamming levels, never later than 30.
- A planet notices probes unless the prober's sensors beat its jamming by a level, and then shoots one down out of an orbit each tick.
- A battle the player or a teammate is in shows every force on both sides.
- Nothing else of another team is in the view: not its stock, queues, ships at home or in flight, fleets, fund, votes, formations or knowledge. `tests/intel.test.ts` builds two worlds that differ only in such secrets and checks that every other player's view of them is identical.

**Neutral planets** are played by a bot through the same views and commands, earn a share of a seat's income and start with a modest home fleet.

## Environment and replays

`createEnv({ rules, neutralPolicy })` gives `reset(seed, setup)` and `step(commandsByPlayer)`, each returning every seat's view, its reward (the change in its own score) and whether the match is done. The environment keeps a log of the seed, the setup, the rules version and every tick's submissions. `replay(log, rules)` rebuilds the final world from it, and `hashWorld` (the world's canonical JSON folded through FNV-1a from two starting values, 16 hex characters) must then equal the hash of the live match. A log is saved as JSON, so the engine reads every command the way JSON would leave it: a number must be finite, negative zero is zero and an amount of `undefined` is one left out. A command therefore means the same before and after it is saved. The terminal client checks this after every bot match, and `tests/combat.test.ts` replays a recorded match with battles in it and pins its hash.

## Terminal client

```sh
pnpm galaxy bots --seed 1                    # a 2v2 between bots (economy and raiders), with ticks per second
pnpm galaxy bots --mode 2v2v2 --matches 5    # several matches and a total
pnpm galaxy bots --bots economy              # nobody attacks
pnpm galaxy play --seed 1 --seat 0           # play one seat against the bots
```

`play` is step-through: commands typed at the prompt are queued, and `next [n]` advances the match. `help` lists the commands (`formation home wall`, `formation 3 fighter=8`, `shelter on` and the rest) and `legal` lists what can be done now. The view shows incoming attacks and the battles the player's team is in.

Bot matches at the default rules, `pnpm galaxy bots --mode <mode> --seed 1 --matches 5` (mixed rosters, bots' thinking included), on an Apple M4 Max with Node 22.20: about 8 000 ticks a second for a 2v2, 6 000 for a 3v3 and 9 500 for a 2v2v2, so a 40-minute match takes about a quarter of a second.

## Later slices

- Strategy bots beyond the economy bot and the raider, a tournament harness and balance tuning.
- A page, rooms through `RollbackGame`, the portal entry and the `fuse-ui/analytics` and `fuse-ui/play-metrics` events (the round unit is one match).
