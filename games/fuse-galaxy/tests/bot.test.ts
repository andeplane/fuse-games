import test from "node:test";
import assert from "node:assert/strict";
import {
  NONE,
  SETUP_2V2,
  SETUP_2V2V2,
  SETUP_3V3,
  noShips,
  shipTotal,
  totalOf,
  type Command,
  type MatchSetup,
  type Policy,
  type Rules,
  type World,
} from "../src/engine/index.js";
import {
  DEFAULT_BOT_CONFIG,
  createEconomyBot,
  type BotConfig,
} from "../src/bots/economy-bot.js";
import {
  DEFAULT_RAIDER_CONFIG,
  createRaiderBot,
  type RaiderConfig,
} from "../src/bots/raider-bot.js";
import { ROSTERS, createRoster, isRoster } from "../src/bots/roster.js";
import { runBotMatch, type Clock } from "../src/cli/bot-match.js";
import {
  RICH,
  RULES,
  fleetOf,
  from,
  idle,
  knowing,
  reasons,
  reportOf,
  rich,
  ships,
  start,
  tick,
  viewFor,
  withPlanet,
  withTeam,
} from "./support.js";

/** A bot that decides on every tick, so a test does not have to wait for its turn. */
const EAGER: BotConfig = { ...DEFAULT_BOT_CONFIG, thinkEvery: 1 };

/** What a policy sends from this world, after checking that the engine carries all of it out. */
function sends(
  policy: Policy,
  world: World,
  player: number,
  rules: Rules = RULES,
): readonly Command[] {
  const commands = policy(viewFor(world, player, rules), rules);
  assert.deepEqual(
    reasons(tick(world, from(player, ...commands), rules)),
    [],
    JSON.stringify(commands),
  );
  return commands;
}

/** What the economy bot sends from this world. */
const decide = (
  world: World,
  player: number,
  config: BotConfig = EAGER,
  rules: Rules = RULES,
): readonly Command[] => sends(createEconomyBot(config), world, player, rules);

const still: Clock = { now: () => 0 };

const vote: Command = { type: "voteCommander", candidate: 0 };

const NOTHING = { metal: 0, crystal: 0, eonium: 0 };

/** One probe past a planet. */
const scout = (target: number): Command => ({
  type: "launchFleet",
  mission: "observe",
  target,
  ships: { probe: 1 },
});

/**
 * Seat 0 as its team's commander, with the vote, the tax and the flag already as the bot wants them, and no probe
 * at home to send scouting.
 */
const settled = (world: World): World =>
  withPlanet(
    withTeam(world, 0, {
      commander: 0,
      votes: [0, 0],
      taxPercent: 10,
      defencePriority: NONE,
    }),
    0,
    { ships: noShips() },
  );

const playedBy = (policy: Policy, seed: number, setup: MatchSetup) =>
  runBotMatch({ seed, setup, rules: RULES, policy, clock: still });

for (const [name, seed, setup] of [
  ["2v2", 1, SETUP_2V2],
  ["3v3", 2, SETUP_3V3],
] as const)
  test(`economy bots play a whole ${name} through views and legal commands, and nothing they send is refused`, () => {
    const { world, rejected, commands, replayMatches, ticks, battles } =
      playedBy(createEconomyBot(), seed, setup);
    assert.equal(ticks, RULES.match.tickLimit);
    assert.equal(world.phase, "ended");
    assert.equal(rejected, 0);
    assert.ok(commands > 1000);
    assert.equal(replayMatches, true);
    assert.ok(world.result);
    assert.equal(world.result.teamScores.length, 2);
    // Nobody attacks in a match of economy bots.
    assert.equal(battles, 0);

    for (const planet of world.planets) {
      // Every planet, neutral ones included, grew an economy and a fleet.
      assert.ok(planet.score > 10 * 550, `planet ${planet.id}'s score`);
      assert.ok(totalOf(planet.asteroids) > 30, `planet ${planet.id}'s rocks`);
      assert.ok(planet.structures.researchLab >= 1);
      assert.ok(planet.structures.shipyard >= 1);
      assert.ok(planet.research.mining >= 3);
      assert.ok(planet.research.hulls >= 2);
    }
    for (const team of world.teams) {
      assert.equal(team.commander, team.members[0]);
      assert.ok(team.votes.every((voted) => voted === team.members[0]));
      assert.equal(team.taxPercent, DEFAULT_BOT_CONFIG.taxPercent);
      // Nobody was attacked, so nobody was flagged.
      assert.equal(team.defencePriority, NONE);
      // The team scouted every planet that is not its own.
      const reports = viewFor(world, team.members[0]!).reports;
      assert.equal(reports.length, world.planets.length - team.members.length);
    }
    assert.ok(world.nextFleetId > 20);
    assert.ok(
      world.planets.reduce(
        (sum, planet) => sum + shipTotal(planet.ships),
        world.fleets.reduce((sum, fleet) => sum + shipTotal(fleet.ships), 0),
      ) > 200,
    );
  });

for (const [name, seed, setup] of [
  ["2v2", 1, SETUP_2V2],
  ["3v3", 2, SETUP_3V3],
  ["2v2v2", 3, SETUP_2V2V2],
] as const)
  test(`economy bots and raiders play a whole ${name} with battles in it, and nothing they send is refused`, () => {
    const played = playedBy(createRoster("mixed"), seed, setup);
    assert.equal(played.ticks, RULES.match.tickLimit);
    assert.equal(played.world.phase, "ended");
    assert.equal(played.rejected, 0);
    assert.equal(played.replayMatches, true);
    assert.ok(played.world.result);
    assert.equal(played.world.result.teamScores.length, setup.teams);
    // The raiders fought, over several rounds, and took asteroids.
    assert.ok(played.battles > 0, "battles");
    assert.ok(played.rounds > played.battles, "rounds");
    assert.ok(played.captured > 0, "captured");
    // A battle that is over leaves nothing behind it.
    for (const battle of played.world.battles)
      assert.ok(battle.round < RULES.combat.rounds);
  });

test("a roster gives every planet its bot: all economy, all raiders, or one of each on every team", () => {
  assert.deepEqual(ROSTERS, ["economy", "raider", "mixed"]);
  assert.ok(ROSTERS.every(isRoster));
  assert.equal(isRoster("pacifist"), false);

  // A seat with warships worth a strike and a neutral planet in reach: a raider attacks, an economy bot does not.
  let world = start();
  for (const seat of [0, 1, 2, 3])
    world = withPlanet(world, seat, { ships: ships({ destroyer: 20 }) });
  const attacks = (roster: Parameters<typeof createRoster>[0]) =>
    [0, 1, 2, 3, 4].filter((planet) =>
      // Each planet on its own turn of the cycle.
      sends(createRoster(roster), { ...world, tick: 5 - planet }, planet).some(
        (command) =>
          command.type === "launchFleet" && command.mission === "attack",
      ),
    );
  assert.deepEqual(attacks("economy"), []);
  assert.deepEqual(attacks("raider"), [0, 1, 2, 3]);
  // Seats 2 and 3 are the second members of their teams.
  assert.deepEqual(attacks("mixed"), [2, 3]);
});

test("a bot keeps nothing between turns: the same view gets the same answer, and the same seed the same match", () => {
  const world = idle(rich(start(3)), 5);
  const view = viewFor(world, 0);
  for (const create of [createEconomyBot, createRaiderBot]) {
    const first = create()(view, RULES);
    assert.ok(first.length > 0);
    assert.deepEqual(create()(view, RULES), first);
    const bot = create();
    bot(viewFor(start(9), 0), RULES);
    assert.deepEqual(bot(view, RULES), first);
  }

  const short: Rules = { ...RULES, match: { tickLimit: 400 } };
  const play = (seed: number) =>
    runBotMatch({
      seed,
      setup: SETUP_2V2,
      rules: short,
      policy: createRoster("mixed"),
      clock: still,
    }).hash;
  assert.equal(play(5), play(5));
  assert.notEqual(play(5), play(6));
});

test("planets take turns to think, one tick of the cycle each", () => {
  const bot = createEconomyBot();
  const thinks = (world: World, player: number) =>
    bot(viewFor(world, player), RULES).length > 0;
  const world = start();
  assert.deepEqual(
    world.planets.map((planet) => thinks(world, planet.id)),
    [true, false, false, false, false, true, false, false, false, false],
  );
  const later = idle(world, 3);
  assert.deepEqual(
    later.planets.map((planet) => thinks(later, planet.id)),
    [false, false, true, false, false, false, false, true, false, false],
  );
  const every3: BotConfig = { ...DEFAULT_BOT_CONFIG, thinkEvery: 3 };
  assert.deepEqual(
    world.planets.map(
      (planet) =>
        createEconomyBot(every3)(viewFor(world, planet.id), RULES).length > 0,
    ),
    [true, false, false, true, false, false, true, false, false, true],
  );
  const raider = createRaiderBot();
  assert.deepEqual(
    world.planets.map(
      (planet) => raider(viewFor(world, planet.id), RULES).length > 0,
    ),
    [true, false, false, false, false, true, false, false, false, false],
  );
});

test("a bot's first move is a vote for the team's first seat, the cheapest income there is and a probe sent out", () => {
  const roid: Command = { type: "initiateAsteroid", resource: "metal" };
  assert.deepEqual(decide(start(), 0), [vote, roid, scout(1)]);
  assert.deepEqual(decide(start(), 2), [vote, roid, scout(1)]);
  assert.deepEqual(decide(start(), 3), [
    { type: "voteCommander", candidate: 1 },
    roid,
    scout(0),
  ]);
  // A neutral planet has no team to vote in and no probe. Planet 4 mines twelve asteroids, so its lab is due.
  assert.deepEqual(decide(start(), 4), [
    { type: "buildStructure", structure: "researchLab" },
  ]);
  // With nothing to spend, the vote and the probe are all there is.
  const broke = withPlanet(start(), 0, { resources: NOTHING });
  assert.deepEqual(decide(broke, 0), [vote, scout(1)]);
  assert.deepEqual(decide(settled(broke), 0), []);
});

test("a bot says nothing once the match has ended", () => {
  const ended = idle(start(), RULES.match.tickLimit);
  for (const planet of ended.planets) {
    assert.deepEqual(decide(ended, planet.id), []);
    assert.deepEqual(sends(createRaiderBot(), ended, planet.id), []);
  }
});

test("it buys whichever asteroid or refinery pays for itself soonest", () => {
  // With three asteroids of each kind, another costs 500 for 4 a tick, and a refinery 400 for 6.
  const mined = withPlanet(settled(rich(start())), 0, {
    asteroids: { metal: 3, crystal: 3, eonium: 3 },
    structures: {
      ...start().planets[0]!.structures,
      researchLab: 1,
      shipyard: 1,
    },
    researchQueue: [{ branch: "mining", level: 1, remaining: 9 }],
    ships: { ...noShips(), battleship: 40 },
    value: 1000,
  });
  assert.deepEqual(decide(mined, 0), [
    { type: "buildStructure", structure: "metalRefinery" },
  ]);
  // Mining research makes asteroids pay more, and a dearer refinery pays less.
  const researched = withPlanet(mined, 0, {
    research: { ...mined.planets[0]!.research, mining: 5 },
    structures: {
      ...mined.planets[0]!.structures,
      metalRefinery: 3,
      crystalRefinery: 3,
      eoniumRefinery: 3,
    },
  });
  assert.deepEqual(decide(researched, 0), [
    { type: "initiateAsteroid", resource: "metal" },
  ]);
});

test("it saves up for its research lab, then its shipyard, once it mines enough asteroids", () => {
  const six = { metal: 2, crystal: 2, eonium: 2 };
  const nine = { metal: 3, crystal: 3, eonium: 3 };
  const lab: Command = { type: "buildStructure", structure: "researchLab" };
  const yard: Command = { type: "buildStructure", structure: "shipyard" };
  const at = (patch: Parameters<typeof withPlanet>[2]) =>
    decide(withPlanet(settled(start()), 0, patch), 0);

  assert.deepEqual(at({ asteroids: six, resources: RICH }), [lab]);
  // Enough for another asteroid, not for the lab: it waits.
  assert.deepEqual(
    at({
      asteroids: six,
      resources: { metal: 399, crystal: 800, eonium: 400 },
    }),
    [],
  );
  assert.deepEqual(at({ asteroids: nine, resources: RICH }), [lab]);
  // A lab on its way counts as a lab.
  assert.deepEqual(
    at({
      asteroids: nine,
      resources: RICH,
      construction: [{ structure: "researchLab", remaining: 30 }],
    }),
    [yard],
  );
  assert.deepEqual(
    at({
      asteroids: nine,
      resources: { metal: 499, crystal: 800, eonium: 400 },
      structures: { ...start().planets[0]!.structures, researchLab: 1 },
    }),
    [],
  );
  const early: BotConfig = { ...EAGER, labAtAsteroids: 3, yardAtAsteroids: 3 };
  assert.deepEqual(decide(settled(start()), 0, early), [lab]);
});

/** A planet with its lab and its yard, rich, and with a level of research already in the works. */
const equipped = (patch: Parameters<typeof withPlanet>[2] = {}): World =>
  withPlanet(settled(start()), 0, {
    asteroids: { metal: 3, crystal: 3, eonium: 3 },
    structures: {
      ...start().planets[0]!.structures,
      researchLab: 1,
      shipyard: 1,
    },
    researchQueue: [{ branch: "travel", level: 1, remaining: 9 }],
    resources: RICH,
    value: 1000,
    ...patch,
  });

test("it keeps a share of its value in ships, of the heaviest class it can build", () => {
  const bought = (world: World, config: BotConfig = EAGER) =>
    decide(world, 0, config)[0];
  const refinery: Command = {
    type: "buildStructure",
    structure: "metalRefinery",
  };
  assert.deepEqual(bought(equipped()), {
    type: "produceShips",
    shipClass: "fighter",
    count: 5,
  });
  const hulls2 = { ...start().planets[0]!.research, hulls: 2 };
  assert.deepEqual(bought(equipped({ research: hulls2 })), {
    type: "produceShips",
    shipClass: "corvette",
    count: 5,
  });
  // No more than it can pay for, and no more than its batch.
  assert.deepEqual(
    bought(
      equipped({
        research: hulls2,
        resources: { metal: 300, crystal: 400, eonium: 150 },
      }),
    ),
    { type: "produceShips", shipClass: "corvette", count: 2 },
  );
  assert.deepEqual(bought(equipped(), { ...EAGER, shipBatch: 1 }), {
    type: "produceShips",
    shipClass: "fighter",
    count: 1,
  });

  // 19 fighters are worth 152, past 15% of a value of 1000: income comes next.
  const armed = equipped({ ships: ships({ fighter: 19 }) });
  assert.deepEqual(bought(armed), refinery);
  assert.deepEqual(bought(equipped({ ships: ships({ fighter: 18 }) })), {
    type: "produceShips",
    shipClass: "fighter",
    count: 5,
  });
  // Ships out in its own fleets count, and a teammate's do not.
  const away = (owner: number) =>
    fleetOf(1, owner, 1, {
      mission: "attack",
      ships: ships({ fighter: 19 }),
    });
  assert.deepEqual(bought({ ...equipped(), fleets: [away(0)] }), refinery);
  assert.deepEqual(bought({ ...equipped(), fleets: [away(2)] }), {
    type: "produceShips",
    shipClass: "fighter",
    count: 5,
  });
  assert.deepEqual(bought(equipped(), { ...EAGER, fleetPercent: 0 }), refinery);
});

test("it researches one level at a time, before anything else it buys: the lowest branch first, its favourites before the rest", () => {
  const research = (
    levels: Partial<World["planets"][number]["research"]>,
    config: BotConfig = EAGER,
  ) =>
    decide(
      equipped({
        research: { ...start().planets[0]!.research, ...levels },
        researchQueue: [],
      }),
      0,
      config,
    )[0];
  assert.deepEqual(research({}), { type: "startResearch", branch: "mining" });
  assert.deepEqual(research({ mining: 1 }), {
    type: "startResearch",
    branch: "hulls",
  });
  assert.deepEqual(research({ mining: 1, hulls: 1, sensors: 1, travel: 1 }), {
    type: "startResearch",
    branch: "jamming",
  });
  assert.deepEqual(
    research({ mining: 5, hulls: 5, sensors: 5, travel: 5, jamming: 4 }),
    { type: "startResearch", branch: "jamming" },
  );
  assert.deepEqual(
    research(
      {},
      {
        ...EAGER,
        researchOrder: ["jamming", "travel", "sensors", "hulls", "mining"],
      },
    ),
    { type: "startResearch", branch: "jamming" },
  );
  // With a level in the works it invests instead of queueing another.
  assert.deepEqual(decide(equipped(), 0, { ...EAGER, fleetPercent: 0 }), [
    { type: "buildStructure", structure: "metalRefinery" },
  ]);
  // Everything researched: the same.
  const done = equipped({
    research: { travel: 5, hulls: 5, sensors: 5, mining: 5, jamming: 5 },
    researchQueue: [],
  });
  assert.deepEqual(decide(done, 0, { ...EAGER, fleetPercent: 0 }), [
    { type: "buildStructure", structure: "metalRefinery" },
  ]);
});

const seen = (target: number, at: number) => reportOf(target, at, 0);

test("it scouts with one probe: planets it has no report on first, then the stalest", () => {
  const armed = withPlanet(settled(start()), 0, {
    resources: NOTHING,
    ships: ships({ probe: 2, corvette: 2 }),
  });
  assert.deepEqual(decide(armed, 0), [scout(1)]);
  // No probe at home, no scout.
  assert.deepEqual(
    decide(withPlanet(armed, 0, { ships: ships({ corvette: 2 }) }), 0),
    [],
  );

  // A teammate's report counts: planet 1 is known, planet 3 is next.
  assert.deepEqual(decide(knowing(armed, { 2: [seen(1, 0)] }), 0), [scout(3)]);
  // A scout already on its way there counts too.
  const sent = fleetOf(1, 0, 1);
  assert.deepEqual(decide({ ...armed, fleets: [sent] }, 0), [scout(3)]);
  assert.deepEqual(decide({ ...armed, fleets: [{ ...sent, owner: 2 }] }, 0), [
    scout(1),
  ]);

  // At tick 400 every report is fresh but the ones on planets 3 and 7, and 7's is the older.
  const late: World = { ...armed, tick: 400 };
  const fresh = [1, 3, 4, 5, 6, 7, 8, 9].map((target) => seen(target, 399));
  const stale = fresh.map((report) =>
    report.target === 3
      ? seen(3, 100)
      : report.target === 7
        ? seen(7, 40)
        : report,
  );
  assert.deepEqual(decide(knowing(late, { 2: fresh }), 0), []);
  assert.deepEqual(decide(knowing(late, { 2: stale }), 0), [scout(7)]);
  assert.deepEqual(
    decide(knowing(late, { 2: stale }), 0, { ...EAGER, rescoutTicks: 1000 }),
    [],
  );
  // Exactly as old as the limit is old enough.
  assert.deepEqual(
    decide(
      knowing(late, {
        2: fresh.map((report) => (report.target === 5 ? seen(5, 100) : report)),
      }),
      0,
    ),
    [scout(5)],
  );
});

test("it sends every warship to the teammate its commander flagged", () => {
  const armed = (home: Parameters<typeof ships>[0], flag: number) =>
    withPlanet(
      withTeam(start(), 0, {
        commander: 0,
        votes: [0, 0],
        taxPercent: 10,
        defencePriority: flag,
      }),
      2,
      { resources: NOTHING, ships: ships(home) },
    );
  const defend = (sent: Parameters<typeof ships>[0]): Command => ({
    type: "launchFleet",
    mission: "defend",
    target: 0,
    ships: ships(sent),
  });
  // The probes stay at home: they do not fight.
  assert.deepEqual(decide(armed({ fighter: 3, frigate: 2, probe: 1 }, 0), 2), [
    defend({ fighter: 3, frigate: 2 }),
  ]);
  assert.deepEqual(decide(armed({ fighter: 1 }, 0), 2), [
    defend({ fighter: 1 }),
  ]);
  // Nobody defends themselves; no flag, no help: a scout goes out instead when there is a probe.
  assert.deepEqual(decide(armed({ fighter: 3 }, 2), 2), []);
  assert.deepEqual(decide(armed({ fighter: 3, probe: 1 }, 2), 2), [scout(1)]);
  assert.deepEqual(decide(armed({ fighter: 3, probe: 1 }, NONE), 2), [
    scout(1),
  ]);
  // Help already there is not sent twice.
  const helping = fleetOf(1, 2, 0, {
    mission: "defend",
    ships: ships({ fighter: 4 }),
    phase: "stationed",
    eta: 50,
    travelTicks: 17,
  });
  assert.deepEqual(
    decide({ ...armed({ fighter: 3, probe: 1 }, 0), fleets: [helping] }, 2),
    [scout(1)],
  );
});

test("as commander it sets the tax, flags the member under attack and pays the fund out to the one furthest behind", () => {
  const voted = withTeam(start(), 0, { commander: 0, votes: [0, 0] });
  const broke = (world: World, player = 0) =>
    withPlanet(world, player, { resources: NOTHING, ships: noShips() });
  assert.deepEqual(decide(broke(voted), 0), [{ type: "setTax", percent: 10 }]);
  // Not the commander: none of that is theirs to do.
  assert.deepEqual(decide(broke(voted, 2), 2), []);
  // The rules may allow less tax than it would like.
  assert.deepEqual(
    decide(broke(voted), 0, EAGER, { ...RULES, team: { maxTaxPercent: 4 } }),
    [{ type: "setTax", percent: 4 }],
  );
  assert.deepEqual(decide(broke(voted), 0, { ...EAGER, taxPercent: 0 }), []);

  // An attack its sensors have picked up: the target is flagged, the one it reaches soonest when there are two.
  const calm = broke(settled(start()));
  const attack = (id: number, target: number, eta: number) =>
    fleetOf(id, 1, target, {
      mission: "attack",
      ships: ships({ fighter: 5 }),
      eta,
      travelTicks: 90,
    });
  const flag = (planet: number): Command => ({
    type: "setDefencePriority",
    planet,
  });
  assert.deepEqual(decide({ ...calm, fleets: [attack(1, 2, 20)] }, 0), [
    flag(2),
  ]);
  assert.deepEqual(
    decide({ ...calm, fleets: [attack(1, 2, 20), attack(2, 0, 12)] }, 0),
    [flag(0)],
  );
  // One too far off to see is no reason yet.
  assert.deepEqual(decide({ ...calm, fleets: [attack(1, 2, 89)] }, 0), []);
  // A battle at a member's home comes before any attack still on its way.
  const besieged: World = {
    ...calm,
    fleets: [attack(1, 0, 12), { ...attack(2, 2, 0), phase: "fighting" }],
    battles: [{ planet: 2, round: 1, wounds: [], wreck: NOTHING }],
  };
  assert.deepEqual(decide(besieged, 0), [flag(2)]);
  // The flag comes down when the danger has passed.
  assert.deepEqual(decide(withTeam(calm, 0, { defencePriority: 2 }), 0), [
    flag(NONE),
  ]);
  assert.deepEqual(
    decide(
      withTeam({ ...calm, fleets: [attack(1, 2, 20)] }, 0, {
        defencePriority: 2,
      }),
      0,
    ),
    [],
  );

  const behind = withPlanet(calm, 2, { score: 100 });
  const fund = { metal: 300, crystal: 0, eonium: 300 };
  assert.deepEqual(decide(withTeam(behind, 0, { fund }), 0), [
    { type: "grant", to: 2, resources: fund },
  ]);
  assert.deepEqual(
    decide(withTeam(behind, 0, { fund: { ...fund, metal: 299 } }), 0),
    [],
  );
  assert.deepEqual(
    decide(withTeam(behind, 0, { fund: { ...fund, metal: 1 } }), 0, {
      ...EAGER,
      grantAt: 301,
    }),
    [{ type: "grant", to: 2, resources: { ...fund, metal: 1 } }],
  );
  // The commander may be the one furthest behind.
  const self = withPlanet(calm, 0, { score: 100 });
  assert.deepEqual(decide(withTeam(self, 0, { fund }), 0), [
    { type: "grant", to: 0, resources: fund },
  ]);
});

test("a bot that lost the post votes again and leaves the commander's work alone", () => {
  const world = withTeam(start(), 0, { commander: 2, votes: [2, 2] });
  const commands = decide(world, 0);
  assert.deepEqual(commands[0], vote);
  assert.ok(commands.every((command) => command.type !== "setTax"));
  // Two bots settle it between them in two turns each.
  let now = world;
  const bot = createEconomyBot();
  for (let step = 0; step < 10; step++)
    now = tick(
      now,
      [0, 2].flatMap((player) =>
        from(player, ...bot(viewFor(now, player), RULES)),
      ),
    );
  assert.equal(now.teams[0]!.commander, 0);
  assert.deepEqual(now.teams[0]!.votes, [0, 0]);
  assert.equal(now.teams[0]!.taxPercent, 10);
});

const KEEN: RaiderConfig = { ...DEFAULT_RAIDER_CONFIG, thinkEvery: 1 };

const raids = (
  world: World,
  player: number,
  config: RaiderConfig = KEEN,
): readonly Command[] => sends(createRaiderBot(config), world, player);

test("a raider draws its fleet up, then sends everything at home against the richest planet it expects to beat", () => {
  const wall: Command = {
    type: "setFormation",
    fleet: NONE,
    arrangement: "wall",
  };
  const strike = (target: number, sent: Parameters<typeof ships>[0]) => ({
    type: "launchFleet",
    mission: "attack",
    target,
    ships: ships(sent),
  });
  // Ten destroyers and three pods are worth 1210: a strike, and enough for any planet at the start.
  const home = { destroyer: 10, pod: 3 };
  const armed = withPlanet(settled(start()), 0, {
    resources: NOTHING,
    ships: ships(home),
  });
  const rocks = (world: World, planet: number, count: number) =>
    withPlanet(world, planet, {
      asteroids: { metal: count, crystal: 0, eonium: 0 },
    });
  // Planet 3 mines the most.
  const richest = rocks(armed, 3, 90);
  assert.deepEqual(raids(richest, 0), [wall, strike(3, home)]);
  // Already drawn up as it likes: the order is not sent again.
  const drawn = withPlanet(richest, 0, {
    formation: RULES.combat.formations.wall!,
  });
  assert.deepEqual(raids(drawn, 0), [strike(3, home)]);
  // A planet whose military score is more than its odds allow is left alone, and the next richest is hit.
  const guarded = rocks(
    withPlanet(drawn, 3, {
      parts: { ...drawn.planets[3]!.parts, military: 727 },
    }),
    6,
    80,
  );
  assert.deepEqual(raids(guarded, 0), [strike(6, home)]);
  assert.deepEqual(raids(guarded, 0, { ...KEEN, oddsPercent: 61 }), [
    strike(3, home),
  ]);
  // One attack at a time.
  const busy: World = {
    ...drawn,
    fleets: [
      fleetOf(1, 0, 4, { mission: "attack", ships: ships({ fighter: 1 }) }),
    ],
  };
  assert.deepEqual(raids(busy, 0), []);
  // Too little at home for a strike: it waits.
  assert.deepEqual(
    raids(withPlanet(drawn, 0, { ships: ships({ destroyer: 5 }) }), 0),
    [],
  );
  // A teammate under attack comes before a scout, and a raid before both.
  const flagged: World = {
    ...withTeam(drawn, 0, { defencePriority: 2 }),
    fleets: [
      fleetOf(1, 1, 2, {
        mission: "attack",
        ships: ships({ fighter: 5 }),
        eta: 20,
      }),
    ],
  };
  assert.deepEqual(raids(flagged, 0), [strike(3, home)]);
  assert.deepEqual(
    raids(
      withPlanet(flagged, 0, { ships: ships({ destroyer: 5, probe: 1 }) }),
      0,
    ),
    [
      {
        type: "launchFleet",
        mission: "defend",
        target: 2,
        ships: ships({ destroyer: 5 }),
      },
    ],
  );
  assert.deepEqual(
    raids(
      withPlanet(drawn, 0, { ships: ships({ destroyer: 5, probe: 1 }) }),
      0,
    ),
    [scout(1)],
  );
});

test("a raider orders pods behind ships that can win them a battle, then the heaviest gunship it can build", () => {
  const yard = (patch: Parameters<typeof withPlanet>[2] = {}) =>
    equipped({
      research: { ...start().planets[0]!.research, hulls: 1 },
      formation: RULES.combat.formations.wall!,
      ...patch,
    });
  const bought = (world: World, config: RaiderConfig = KEEN) =>
    raids(world, 0, config).find((command) => command.type === "produceShips");
  // Nothing armed at home yet: gunships first.
  assert.deepEqual(bought(yard()), {
    type: "produceShips",
    shipClass: "corvette",
    count: 20,
  });
  const armed = yard({ ships: ships({ corvette: 4 }) });
  assert.deepEqual(bought(armed), {
    type: "produceShips",
    shipClass: "pod",
    count: 10,
  });
  // Pods at home, in its fleets and on order all count.
  const partly = yard({
    ships: ships({ corvette: 4, pod: 2 }),
    production: [{ shipClass: "pod", count: 3, remaining: 5 }],
  });
  const carrying = fleetOf(1, 0, 4, {
    mission: "attack",
    ships: ships({ pod: 1 }),
  });
  assert.deepEqual(bought({ ...partly, fleets: [carrying] }), {
    type: "produceShips",
    shipClass: "pod",
    count: 4,
  });
  assert.deepEqual(bought(armed, { ...KEEN, pods: 0 }), {
    type: "produceShips",
    shipClass: "corvette",
    count: 20,
  });
  // Past its share of its value in ships, it buys income instead.
  assert.equal(bought(armed, { ...KEEN, fleetPercent: 5 }), undefined);
});
