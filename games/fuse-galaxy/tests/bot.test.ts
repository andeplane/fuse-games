import test from "node:test";
import assert from "node:assert/strict";
import {
  NONE,
  SETUP_2V2,
  SETUP_3V3,
  noShips,
  shipTotal,
  totalOf,
  viewFor,
  type Command,
  type Fleet,
  type MatchSetup,
  type Rules,
  type ScoutReport,
  type World,
} from "../src/engine/index.js";
import {
  DEFAULT_BOT_CONFIG,
  createEconomyBot,
  type BotConfig,
} from "../src/bots/economy-bot.js";
import { runBotMatch, type Clock } from "../src/cli/bot-match.js";
import {
  RICH,
  RULES,
  from,
  idle,
  reasons,
  rich,
  start,
  tick,
  withPlanet,
  withTeam,
} from "./support.js";

/** A bot that decides on every tick, so a test does not have to wait for its turn. */
const EAGER: BotConfig = { ...DEFAULT_BOT_CONFIG, thinkEvery: 1 };

/** What the bot sends from this world, after checking that the engine carries all of it out. */
function decide(
  world: World,
  player: number,
  config: BotConfig = EAGER,
  rules: Rules = RULES,
): readonly Command[] {
  const commands = createEconomyBot(config)(viewFor(world, player), rules);
  assert.deepEqual(
    reasons(tick(world, from(player, ...commands), rules)),
    [],
    JSON.stringify(commands),
  );
  return commands;
}

const still: Clock = { now: () => 0 };

const vote: Command = { type: "voteCommander", candidate: 0 };

/** Seat 0 as its team's commander, with the vote, the tax and the flag already as the bot wants them. */
const settled = (world: World): World =>
  withTeam(world, 0, {
    commander: 0,
    votes: [0, 0],
    taxPercent: 10,
    defencePriority: 0,
  });

function playedByBots(seed: number, setup: MatchSetup) {
  const result = runBotMatch({
    seed,
    setup,
    rules: RULES,
    policy: createEconomyBot(),
    clock: still,
  });
  return result;
}

for (const [name, seed, setup] of [
  ["2v2", 1, SETUP_2V2],
  ["3v3", 2, SETUP_3V3],
] as const)
  test(`bots play a whole ${name} through views and legal commands, and nothing they send is refused`, () => {
    const { world, rejected, commands, replayMatches, ticks } = playedByBots(
      seed,
      setup,
    );
    assert.equal(ticks, RULES.match.tickLimit);
    assert.equal(world.phase, "ended");
    assert.equal(rejected, 0);
    assert.ok(commands > 1000);
    assert.equal(replayMatches, true);
    assert.ok(world.result);
    assert.equal(world.result.teamScores.length, 2);

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
      assert.ok(team.members.includes(team.defencePriority));
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

test("a bot keeps nothing between turns: the same view gets the same answer, and the same seed the same match", () => {
  const world = idle(rich(start(3)), 5);
  const view = viewFor(world, 0);
  const first = createEconomyBot()(view, RULES);
  assert.ok(first.length > 0);
  assert.deepEqual(createEconomyBot()(view, RULES), first);
  const bot = createEconomyBot();
  bot(viewFor(start(9), 0), RULES);
  assert.deepEqual(bot(view, RULES), first);

  const short: Rules = { ...RULES, match: { tickLimit: 400 } };
  const play = (seed: number) =>
    runBotMatch({
      seed,
      setup: SETUP_2V2,
      rules: short,
      policy: createEconomyBot(),
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
});

test("a bot's first move is a vote for the team's first seat and the cheapest income there is", () => {
  const roid: Command = { type: "initiateAsteroid", resource: "metal" };
  assert.deepEqual(decide(start(), 0), [vote, roid]);
  assert.deepEqual(decide(start(), 2), [vote, roid]);
  assert.deepEqual(decide(start(), 3), [
    { type: "voteCommander", candidate: 1 },
    roid,
  ]);
  // A neutral planet has no team to vote in. Planet 4 mines twelve asteroids, so its lab is due.
  assert.deepEqual(decide(start(), 4), [
    { type: "buildStructure", structure: "researchLab" },
  ]);
  // With nothing to spend, the vote is all there is.
  const broke = withPlanet(start(), 0, {
    resources: { metal: 0, crystal: 0, eonium: 0 },
  });
  assert.deepEqual(decide(broke, 0), [vote]);
  assert.deepEqual(decide(settled(broke), 0), []);
});

test("a bot says nothing once the match has ended", () => {
  const ended = idle(start(), RULES.match.tickLimit);
  for (const planet of ended.planets)
    assert.deepEqual(decide(ended, planet.id), []);
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
  const bought = (world: World) =>
    decide(world, 0).filter((command) => command.type !== "launchFleet");
  assert.deepEqual(bought(mined), [
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
  assert.deepEqual(bought(researched), [
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

const equipped = (patch: Parameters<typeof withPlanet>[2] = {}): World =>
  withPlanet(settled(start()), 0, {
    asteroids: { metal: 3, crystal: 3, eonium: 3 },
    structures: {
      ...start().planets[0]!.structures,
      researchLab: 1,
      shipyard: 1,
    },
    resources: RICH,
    value: 1000,
    ...patch,
  });

test("it keeps a share of its value in ships, of the heaviest class it can build", () => {
  const ships = (world: World, config: BotConfig = EAGER) =>
    decide(world, 0, config)[0];
  assert.deepEqual(ships(equipped()), {
    type: "produceShips",
    shipClass: "fighter",
    count: 5,
  });
  const hulls2 = { ...start().planets[0]!.research, hulls: 2 };
  assert.deepEqual(ships(equipped({ research: hulls2 })), {
    type: "produceShips",
    shipClass: "frigate",
    count: 5,
  });
  // No more than it can pay for, and no more than its batch.
  assert.deepEqual(
    ships(
      equipped({
        research: hulls2,
        resources: { metal: 600, crystal: 400, eonium: 150 },
      }),
    ),
    { type: "produceShips", shipClass: "frigate", count: 2 },
  );
  assert.deepEqual(ships(equipped(), { ...EAGER, shipBatch: 1 }), {
    type: "produceShips",
    shipClass: "fighter",
    count: 1,
  });

  // 19 fighters are worth 152, past 15% of a value of 1000: research comes next.
  const armed = equipped({ ships: { ...noShips(), fighter: 19 } });
  assert.deepEqual(ships(armed), { type: "startResearch", branch: "mining" });
  assert.deepEqual(ships(equipped({ ships: { ...noShips(), fighter: 18 } })), {
    type: "produceShips",
    shipClass: "fighter",
    count: 5,
  });
  // Ships out in its own fleets count, and a teammate's do not.
  const away = (owner: number): Fleet => ({
    id: 1,
    owner,
    mission: "observe",
    target: 1,
    ships: { ...noShips(), fighter: 19 },
    phase: "outbound",
    eta: 5,
    travelTicks: 30,
  });
  assert.deepEqual(ships({ ...equipped(), fleets: [away(0)] }), {
    type: "startResearch",
    branch: "mining",
  });
  assert.deepEqual(ships({ ...equipped(), fleets: [away(2)] }), {
    type: "produceShips",
    shipClass: "fighter",
    count: 5,
  });
  assert.deepEqual(ships(equipped(), { ...EAGER, fleetPercent: 0 }), {
    type: "startResearch",
    branch: "mining",
  });
});

test("it researches one level at a time, the lowest branch first and its favourites before the rest", () => {
  const research = (
    levels: Partial<World["planets"][number]["research"]>,
    config: BotConfig = { ...EAGER, fleetPercent: 0 },
  ) =>
    decide(
      equipped({ research: { ...start().planets[0]!.research, ...levels } }),
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
        fleetPercent: 0,
        researchOrder: ["jamming", "travel", "sensors", "hulls", "mining"],
      },
    ),
    { type: "startResearch", branch: "jamming" },
  );
  // With a level in the works it invests instead of queueing another.
  const busy = equipped({
    researchQueue: [{ branch: "mining", level: 1, remaining: 9 }],
  });
  assert.deepEqual(decide(busy, 0, { ...EAGER, fleetPercent: 0 }), [
    { type: "buildStructure", structure: "metalRefinery" },
  ]);
  // Everything researched: the same.
  const done = equipped({
    research: { travel: 5, hulls: 5, sensors: 5, mining: 5, jamming: 5 },
  });
  assert.deepEqual(decide(done, 0, { ...EAGER, fleetPercent: 0 }), [
    { type: "buildStructure", structure: "metalRefinery" },
  ]);
});

const seen = (target: number, at: number): ScoutReport => ({
  target,
  tick: at,
  by: 0,
  detail: 1,
  resources: { metal: 0, crystal: 0, eonium: 0 },
  asteroids: { metal: 1, crystal: 1, eonium: 1 },
  structures: null,
  research: null,
  ships: null,
});

test("it scouts with its lightest ship: planets it has no report on first, then the stalest", () => {
  const armed = withPlanet(settled(start()), 0, {
    resources: { metal: 0, crystal: 0, eonium: 0 },
    ships: { ...noShips(), corvette: 2, cruiser: 1 },
  });
  const scout = (target: number): Command => ({
    type: "launchFleet",
    mission: "observe",
    target,
    ships: { corvette: 1 },
  });
  assert.deepEqual(decide(armed, 0), [scout(1)]);

  const knowing = (world: World, reports: readonly ScoutReport[]): World => ({
    ...world,
    knowledge: world.knowledge.map((known, id) =>
      id === 2 ? { reports } : known,
    ),
  });
  // A teammate's report counts: planet 1 is known, planet 3 is next.
  assert.deepEqual(decide(knowing(armed, [seen(1, 0)]), 0), [scout(3)]);
  // A scout already on its way there counts too.
  const sent: Fleet = {
    id: 1,
    owner: 0,
    mission: "observe",
    target: 1,
    ships: { ...noShips(), corvette: 1 },
    phase: "outbound",
    eta: 5,
    travelTicks: 30,
  };
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
  assert.deepEqual(decide(knowing(late, fresh), 0), []);
  assert.deepEqual(decide(knowing(late, stale), 0), [scout(7)]);
  assert.deepEqual(
    decide(knowing(late, stale), 0, { ...EAGER, rescoutTicks: 1000 }),
    [],
  );
  // Exactly as old as the limit is old enough.
  assert.deepEqual(
    decide(
      knowing(
        late,
        fresh.map((report) => (report.target === 5 ? seen(5, 100) : report)),
      ),
      0,
    ),
    [scout(5)],
  );
});

test("it sends everything but one scout to the teammate its commander flagged", () => {
  const armed = (ships: Partial<ReturnType<typeof noShips>>, flag: number) =>
    withPlanet(
      withTeam(start(), 0, {
        commander: 0,
        votes: [0, 0],
        taxPercent: 10,
        defencePriority: flag,
      }),
      2,
      {
        resources: { metal: 0, crystal: 0, eonium: 0 },
        ships: { ...noShips(), ...ships },
      },
    );
  assert.deepEqual(decide(armed({ fighter: 3, frigate: 2 }, 0), 2), [
    {
      type: "launchFleet",
      mission: "defend",
      target: 0,
      ships: { ...noShips(), fighter: 2, frigate: 2 },
    },
  ]);
  const scout: Command = {
    type: "launchFleet",
    mission: "observe",
    target: 1,
    ships: { fighter: 1 },
  };
  // One ship is the scout; nobody defends themselves; no flag, no help.
  assert.deepEqual(decide(armed({ fighter: 1 }, 0), 2), [scout]);
  assert.deepEqual(decide(armed({ fighter: 3 }, 2), 2), [scout]);
  assert.deepEqual(decide(armed({ fighter: 3 }, NONE), 2), [scout]);
  // Help already there is not sent twice.
  const helping: Fleet = {
    id: 1,
    owner: 2,
    mission: "defend",
    target: 0,
    ships: { ...noShips(), fighter: 4 },
    phase: "stationed",
    eta: 50,
    travelTicks: 17,
  };
  assert.deepEqual(
    decide({ ...armed({ fighter: 3 }, 0), fleets: [helping] }, 2),
    [scout],
  );
});

test("as commander it sets the tax, flags the member furthest behind and pays the fund out to them", () => {
  const voted = withTeam(start(), 0, { commander: 0, votes: [0, 0] });
  const broke = (world: World) =>
    withPlanet(world, 0, { resources: { metal: 0, crystal: 0, eonium: 0 } });
  assert.deepEqual(decide(broke(voted), 0), [
    { type: "setTax", percent: 10 },
    { type: "setDefencePriority", planet: 0 },
  ]);
  // Not the commander: none of that is theirs to do.
  assert.deepEqual(
    decide(withPlanet(voted, 2, { resources: start().teams[0]!.fund }), 2),
    [],
  );
  // The rules may allow less tax than it would like.
  assert.deepEqual(
    decide(broke(voted), 0, EAGER, { ...RULES, team: { maxTaxPercent: 4 } }),
    [
      { type: "setTax", percent: 4 },
      { type: "setDefencePriority", planet: 0 },
    ],
  );
  assert.deepEqual(decide(broke(voted), 0, { ...EAGER, taxPercent: 0 }), [
    { type: "setDefencePriority", planet: 0 },
  ]);

  const behind = withPlanet(broke(settled(start())), 2, { score: 100 });
  const fund = { metal: 300, crystal: 0, eonium: 300 };
  assert.deepEqual(decide(withTeam(behind, 0, { fund }), 0), [
    { type: "setDefencePriority", planet: 2 },
    { type: "grant", to: 2, resources: fund },
  ]);
  assert.deepEqual(
    decide(withTeam(behind, 0, { fund: { ...fund, metal: 299 } }), 0),
    [{ type: "setDefencePriority", planet: 2 }],
  );
  assert.deepEqual(
    decide(
      withTeam(behind, 0, { fund: { ...fund, metal: 1 }, defencePriority: 2 }),
      0,
      { ...EAGER, grantAt: 301 },
    ),
    [{ type: "grant", to: 2, resources: { ...fund, metal: 1 } }],
  );
  // The commander may be the one furthest behind.
  const self = withPlanet(broke(settled(start())), 0, { score: 100 });
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
