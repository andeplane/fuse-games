# Fuse Galaxy

Fuse Galaxy is a session-length descendant of Planetarion: up to six players in teams ("galaxies") build an economy, research, produce fleets and fight over asteroids for 30 to 45 minutes, with bot-run neutral planets on the map. This note covers the headless engine in `games/fuse-galaxy/`. There is no page yet: no `index.html`, no `portal.json` and no analytics. Those arrive with the first playable screen.

## Shape

| Module                                  | Role                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/`                           | The rules: `applyTick`, the world and its `Rules`, command checking, views, the legal-command mask, hashing and the environment. Imports nothing else |
| `src/bots/economy-bot.ts`               | A stateless bot that plays through a view and the legal commands, like any other player                                                               |
| `src/cli/` and `scripts/fuse-galaxy.ts` | The terminal client (`pnpm galaxy`); the script only supplies the real terminal and clock                                                             |

`applyTick(world, submissions, rules)` returns the next world and never changes its arguments. Every world the engine hands out is frozen all the way down, so a bot or a client holding a world or a view cannot change the match either; a write throws. It reads no clock, does no I/O and uses whole numbers only (`math.ts` has the integer division, square root and percentage it needs). Randomness comes from the generator state stored in the world, so it is checkpointed with everything else. `tests/architecture.test.ts` fails on an import that leaves the engine folder and on floating-point or ambient calls inside it.

Every balance number lives in one frozen [`Rules`](../../games/fuse-galaxy/src/engine/rules.ts) object with `DEFAULT_RULES` as the default. A variant is another object, never a code change. A change to a number or a rule bumps `Rules.version`, and the pinned hashes in `tests/determinism.test.ts` change with it.

## State

The world holds the tick, the generator state, the phase and result, the planets (one per player, at a whole-number position on a square map), the fleets, the teams, each player's knowledge and the events of the last tick.

- A planet has resources (metal, crystal, eonium), asteroids per resource, structures, research levels, the construction and research queues, ship orders, the ships at home, and its value and score.
- A team has its members, a fund, a tax rate, a commander, each member's vote and a defence-priority planet.
- Knowledge is the scout reports a player has gathered. Reports are dated and never updated in place.
- Seats come first in id order, then the neutral planets, which belong to no team.

## One tick

The phases always run in this order:

1. Commands, player by player in id order and each player's in the order sent. A command is checked against the state the commands before it left.
2. Income: base, asteroids and structures, with the team's tax diverted to its fund.
3. Construction, research and ship production advance.
4. Fleets move, arrive, observe and come home.
5. Combat (later slice).
6. Asteroid capture and salvage (later slice).
7. Value and score.
8. The match ends at the tick limit; the team with the highest score (its members plus its fund) wins, and equal scores are a draw.

The tick an order is placed on counts as its first tick, so a structure with a build time of N ordered on tick T is finished on tick T+N−1.

## Commands

Commands are a discriminated union: `initiateAsteroid`, `buildStructure`, `startResearch`, `produceShips`, `launchFleet`, `recallFleet`, `voteCommander`, `setTax`, `grant`, `setDefencePriority` and `donate`. They arrive as untrusted data. `parseCommand` checks the shape, `commandProblem` checks it against the world, and a refused command becomes a `rejected` event with its reason. Nothing throws on bad input, and a refused command changes nothing. Input here means plain data, as `JSON.parse` gives it: a submission that is not even a record is refused as sent by nobody, while an object whose getter throws is outside what the engine promises. A match that has ended refuses whatever it is sent, once to each sender.

`viewFor(world, player)` is the only thing a player or a bot sees, and `legalCommands(view, rules)` lists what that player can do now with its cost and limits. The list is built by asking the engine's own check about each candidate, so the mask and the engine cannot disagree; `tests/view.test.ts` checks both directions on bot-played matches.

## Rules in this slice

- **Economy.** Income per tick is a base amount plus a yield per asteroid (raised by mining research) plus refineries. Initiating an asteroid is instant and costs Planetarion's quadratic in the number already owned of that resource.
- **Construction.** One structure in progress and one queued, paid when ordered, each further copy costing more. A research lab opens research and a shipyard opens ship production; more of either shortens the work up to a cap.
- **Research.** Five branches (travel, hulls, sensors, mining, jamming), one level in progress and one queued. Hulls opens the heavier ship classes.
- **Ships.** Six classes (fighter, corvette, frigate, destroyer, cruiser, battleship). Several orders run side by side; an order's time does not depend on its size.
- **Teams.** Every member votes for a commander; the most votes wins, the sitting commander wins a tie and the lowest id wins a tie without one. The commander sets the tax (up to the rules' maximum), grants from the fund to members and flags one member as the defence priority. Any member may donate to the fund.
- **Fleets.** A fleet flies at its slowest ship's speed. `defend` stations it at a teammate for a while and brings it home. `observe` flies to any planet that is not on the sender's team, records a report whose detail is the observer's sensors against the target's jamming, and comes home. `attack` is refused as "not implemented in this slice".
- **Fog.** A view shows the player's own planet and team in full, allies' planets and fleets, every planet's position, owner kind and score, and the newest report on each planet that the player or a teammate has gathered. It does not show another team's resources, queues, ships, fleets, fund or votes.
- **Neutral planets** are played by a bot through the same views and commands and earn a share of a seat's income.

## Environment and replays

`createEnv({ rules, neutralPolicy })` gives `reset(seed, setup)` and `step(commandsByPlayer)`, each returning every seat's view, its reward (the change in its own score) and whether the match is done. The environment keeps a log of the seed, the setup, the rules version and every tick's submissions. `replay(log, rules)` rebuilds the final world from it, and `hashWorld` (the world's canonical JSON folded through FNV-1a from two starting values, 16 hex characters) must then equal the hash of the live match. A log is saved as JSON, so the engine reads every command the way JSON would leave it: a number must be finite, negative zero is zero and an amount of `undefined` is one left out. A command therefore means the same before and after it is saved. The terminal client checks this after every bot match.

## Terminal client

```sh
pnpm galaxy bots --seed 1                # a 2v2 between bots, with ticks per second
pnpm galaxy bots --mode 3v3 --matches 10 # several matches and a total
pnpm galaxy play --seed 1 --seat 0       # play one seat against the bots
```

`play` is step-through: commands typed at the prompt are queued, and `next [n]` advances the match. `help` lists the commands and `legal` lists what can be done now.

## Later slices

- Combat, with multi-round battles, and the `attack` mission.
- Asteroid capture and salvage.
- Probes and wider fog of war: enemy fleets in flight and incoming-attack warnings.
- A page, rooms through `RollbackGame`, the portal entry and the `fuse-ui/analytics` and `fuse-ui/play-metrics` events (the round unit is one match).
