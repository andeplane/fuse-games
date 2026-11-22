import test from "node:test";
import assert from "node:assert/strict";
import {
  NONE,
  affordableCount,
  asteroidCost,
  income,
  planetValue,
  productionTicks,
  researchCost,
  researchTicks,
  structureCost,
  teamScore,
  type Rules,
} from "../src/engine/index.js";
import {
  ceilDiv,
  clamp,
  div,
  imul,
  isqrt,
  percentOf,
} from "../src/engine/math.js";
import { fnv1a, next, roll, seedState } from "../src/engine/rng.js";
import {
  RICH,
  RULES,
  eventsOf,
  from,
  idle,
  reasons,
  refusal,
  rich,
  start,
  tick,
  withPlanet,
  withTeam,
} from "./support.js";

test("integer helpers round the way the rules say", () => {
  assert.equal(div(7, 2), 3);
  assert.equal(div(-7, 2), -3);
  assert.equal(ceilDiv(7, 2), 4);
  assert.equal(ceilDiv(8, 2), 4);
  assert.equal(percentOf(14, 10), 1);
  assert.equal(percentOf(250, 150), 375);
  assert.equal(clamp(5, 1, 3), 3);
  assert.equal(clamp(-2, 1, 3), 1);
  assert.equal(clamp(2, 1, 3), 2);
  for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 99, 100, 1_000_000, 2_000_001])
    assert.equal(isqrt(n), Math.floor(Math.sqrt(n)), `isqrt(${n})`);
  for (const [a, b] of [
    [0, 0],
    [3, 5],
    [0xffffffff, 0xffffffff],
    [0x6d2b79f5, 0x01000193],
    [-7, 123456789],
  ] as const)
    assert.equal(imul(a, b), Math.imul(a, b), `imul(${a}, ${b})`);
});

test("the random stream is a function of its state, and FNV-1a matches its published vectors", () => {
  const first = next(seedState(42));
  assert.deepEqual(next(seedState(42)), first);
  assert.notEqual(next(first.state).value, first.value);
  assert.equal(seedState(-1), 0xffffffff);

  const a = { rng: seedState(7) };
  const b = { rng: seedState(7) };
  const drawn = Array.from({ length: 200 }, () => roll(a, 6));
  assert.deepEqual(
    Array.from({ length: 200 }, () => roll(b, 6)),
    drawn,
  );
  assert.ok(drawn.every((value) => value >= 0 && value < 6));
  assert.equal(new Set(drawn).size, 6);

  assert.equal(fnv1a(""), 0x811c9dc5);
  assert.equal(fnv1a("a"), 0xe40c292c);
  assert.equal(fnv1a("foobar"), 0xbf9cf968);
});

test("a planet earns its base income plus every asteroid's yield each tick", () => {
  const world = start();
  assert.deepEqual(income(world.planets[0]!, RULES), {
    metal: 14,
    crystal: 14,
    eonium: 10,
  });
  const later = idle(world, 10);
  assert.deepEqual(later.planets[0]!.resources, {
    metal: 800 + 140,
    crystal: 800 + 140,
    eonium: 400 + 100,
  });
});

test("refineries and mining research raise income", () => {
  const planet = {
    ...start().planets[0]!,
    asteroids: { metal: 5, crystal: 0, eonium: 2 },
    structures: {
      metalRefinery: 2,
      crystalRefinery: 1,
      eoniumRefinery: 3,
      researchLab: 1,
      shipyard: 1,
    },
    research: { travel: 0, hulls: 0, sensors: 0, mining: 3, jamming: 0 },
  };
  // Asteroids yield 4 each, 30% more with mining 3; refineries add 6, 6 and 5.
  assert.deepEqual(income(planet, RULES), {
    metal: 10 + 26 + 12,
    crystal: 10 + 0 + 6,
    eonium: 6 + 10 + 15,
  });
});

test("a neutral planet earns half of what a seat would", () => {
  const world = start();
  const neutral = world.planets[4]!;
  assert.equal(neutral.kind, "neutral");
  const asSeat = income({ ...neutral, kind: "seat" }, RULES);
  assert.deepEqual(income(neutral, RULES), {
    metal: div(asSeat.metal, 2),
    crystal: div(asSeat.crystal, 2),
    eonium: div(asSeat.eonium, 2),
  });
});

test("the team's tax goes to its fund and the planet keeps the rest", () => {
  const world = tick(withTeam(start(), 0, { taxPercent: 10 }));
  // 10% of 14, 14 and 10, rounded down, from each of the two members.
  assert.deepEqual(world.teams[0]!.fund, { metal: 2, crystal: 2, eonium: 2 });
  assert.deepEqual(world.planets[0]!.resources, {
    metal: 813,
    crystal: 813,
    eonium: 409,
  });
  // The other team set no tax.
  assert.deepEqual(world.teams[1]!.fund, { metal: 0, crystal: 0, eonium: 0 });
  assert.equal(world.planets[1]!.resources.metal, 814);
});

test("no stock grows past the cap", () => {
  const rules: Rules = {
    ...RULES,
    limits: { ...RULES.limits, resourceCap: 820 },
  };
  const world = idle(
    withTeam(start(), 0, {
      taxPercent: 30,
      fund: { metal: 819, crystal: 0, eonium: 0 },
    }),
    5,
    rules,
  );
  assert.equal(world.planets[0]!.resources.metal, 820);
  assert.equal(world.teams[0]!.fund.metal, 820);
  assert.equal(world.planets[0]!.resources.eonium, 400 + 5 * 7);
});

test("an asteroid costs Planetarion's quadratic in how many of that resource the planet mines", () => {
  // 25/2 × (n² + 3n + 2) of metal and of crystal.
  assert.deepEqual(
    [0, 1, 2, 3, 10].map((owned) => asteroidCost(owned, RULES).metal),
    [25, 75, 150, 250, 1650],
  );
  for (let owned = 0; owned < 40; owned++) {
    const cost = asteroidCost(owned, RULES);
    assert.equal(cost.metal, div(25 * (owned * owned + 3 * owned + 2), 2));
    assert.equal(cost.crystal, cost.metal);
    assert.equal(cost.eonium, 0);
  }
});

test("initiating an asteroid is paid at once and mines from the same tick", () => {
  const world = tick(
    start(),
    from(0, { type: "initiateAsteroid", resource: "eonium" }),
  );
  const planet = world.planets[0]!;
  assert.deepEqual(planet.asteroids, { metal: 1, crystal: 1, eonium: 2 });
  assert.deepEqual(planet.resources, {
    metal: 800 - 75 + 14,
    crystal: 800 - 75 + 14,
    eonium: 400 + 14,
  });
  assert.deepEqual(eventsOf(world, "asteroidInitiated"), [
    { type: "asteroidInitiated", player: 0, resource: "eonium" },
  ]);
  // The price depends on that resource's count alone.
  assert.equal(
    refusal(
      withPlanet(world, 0, {
        resources: { metal: 75, crystal: 75, eonium: 0 },
      }),
      0,
      { type: "initiateAsteroid", resource: "metal" },
    ),
    undefined,
  );
  assert.equal(
    refusal(
      withPlanet(world, 0, {
        resources: { metal: 149, crystal: 150, eonium: 0 },
      }),
      0,
      { type: "initiateAsteroid", resource: "eonium" },
    ),
    "not enough resources",
  );
});

test("a planet mines no more asteroids of a resource than the rules allow", () => {
  const world = withPlanet(start(), 0, {
    resources: RICH,
    asteroids: { metal: 100, crystal: 99, eonium: 0 },
  });
  assert.equal(
    refusal(world, 0, { type: "initiateAsteroid", resource: "metal" }),
    "the planet already mines the most metal asteroids it can",
  );
  assert.equal(
    refusal(world, 0, { type: "initiateAsteroid", resource: "crystal" }),
    undefined,
  );
});

test("a structure is paid for when ordered and stands when its build time has passed", () => {
  let world = tick(
    start(),
    from(0, { type: "buildStructure", structure: "metalRefinery" }),
  );
  assert.equal(world.planets[0]!.resources.metal, 800 - 300 + 14);
  assert.equal(world.planets[0]!.resources.crystal, 800 - 100 + 14);
  assert.deepEqual(world.planets[0]!.construction, [
    { structure: "metalRefinery", remaining: 29 },
  ]);
  world = idle(world, 28);
  assert.equal(world.planets[0]!.structures.metalRefinery, 0);
  world = tick(world);
  assert.equal(world.tick, RULES.structures.metalRefinery.buildTicks);
  assert.equal(world.planets[0]!.structures.metalRefinery, 1);
  assert.deepEqual(world.planets[0]!.construction, []);
  assert.deepEqual(eventsOf(world, "structureBuilt"), [
    { type: "structureBuilt", player: 0, structure: "metalRefinery" },
  ]);
  // The refinery's income starts the tick after it is finished.
  assert.equal(
    tick(world).planets[0]!.resources.metal - world.planets[0]!.resources.metal,
    20,
  );
});

test("one structure is built at a time, with one more waiting, and each copy costs more", () => {
  const build = (structure: "metalRefinery" | "shipyard") =>
    ({ type: "buildStructure", structure }) as const;
  let world = tick(
    rich(start()),
    from(0, build("metalRefinery"), build("metalRefinery"), build("shipyard")),
  );
  assert.deepEqual(reasons(world), ["the construction queue is full"]);
  // 300/100 for the first copy, half as much again for the second.
  assert.equal(world.planets[0]!.resources.metal, RICH.metal - 300 - 450 + 14);
  assert.equal(
    world.planets[0]!.resources.crystal,
    RICH.crystal - 100 - 150 + 14,
  );
  assert.deepEqual(world.planets[0]!.construction, [
    { structure: "metalRefinery", remaining: 29 },
    { structure: "metalRefinery", remaining: 30 },
  ]);
  // Copies built and copies ordered both count towards the next price.
  assert.deepEqual(structureCost(world.planets[0]!, "metalRefinery", RULES), {
    metal: 600,
    crystal: 200,
    eonium: 0,
  });
  world = idle(world, 29);
  assert.equal(world.planets[0]!.structures.metalRefinery, 1);
  assert.deepEqual(world.planets[0]!.construction, [
    { structure: "metalRefinery", remaining: 30 },
  ]);
  world = idle(world, 30);
  assert.equal(world.planets[0]!.structures.metalRefinery, 2);
});

test("a planet builds no more copies of a structure than the rules allow", () => {
  const world = withPlanet(rich(start()), 0, {
    structures: { ...start().planets[0]!.structures, shipyard: 4 },
    construction: [{ structure: "shipyard", remaining: 3 }],
  });
  assert.equal(
    refusal(world, 0, { type: "buildStructure", structure: "shipyard" }),
    "no more of that structure can be built",
  );
  assert.equal(
    refusal(world, 0, { type: "buildStructure", structure: "researchLab" }),
    undefined,
  );
  assert.equal(
    refusal(start(), 0, { type: "buildStructure", structure: "shipyard" }),
    undefined,
  );
  assert.equal(
    refusal(
      withPlanet(start(), 0, {
        resources: { metal: 500, crystal: 300, eonium: 99 },
      }),
      0,
      { type: "buildStructure", structure: "shipyard" },
    ),
    "not enough resources",
  );
});

const withLab = (labs = 1) =>
  withPlanet(rich(start()), 0, {
    structures: { ...start().planets[0]!.structures, researchLab: labs },
  });

test("research needs a lab, is paid when ordered and raises the branch when its time has passed", () => {
  assert.equal(
    refusal(rich(start()), 0, { type: "startResearch", branch: "mining" }),
    "research needs a researchLab",
  );
  let world = tick(
    withLab(),
    from(0, { type: "startResearch", branch: "mining" }),
  );
  assert.equal(world.planets[0]!.resources.metal, RICH.metal - 300 + 14);
  assert.equal(world.planets[0]!.resources.eonium, RICH.eonium - 100 + 10);
  assert.deepEqual(world.planets[0]!.researchQueue, [
    { branch: "mining", level: 1, remaining: 59 },
  ]);
  world = idle(world, 58);
  assert.equal(world.planets[0]!.research.mining, 0);
  world = tick(world);
  assert.equal(world.planets[0]!.research.mining, 1);
  assert.deepEqual(eventsOf(world, "researchDone"), [
    { type: "researchDone", player: 0, branch: "mining", level: 1 },
  ]);
  // Mining 1 adds a tenth to the asteroids' yield: 4 becomes 4.4, rounded down, so nothing yet with one asteroid.
  assert.equal(income(world.planets[0]!, RULES).metal, 14);
});

test("each research level costs more and takes longer, one is worked on at a time, and more labs are faster", () => {
  const research = (branch: "mining" | "hulls" | "travel") =>
    ({ type: "startResearch", branch }) as const;
  let world = tick(
    withLab(),
    from(0, research("mining"), research("mining"), research("hulls")),
  );
  assert.deepEqual(reasons(world), ["the research queue is full"]);
  // Level 2 costs 60% more than level 1 and takes 40% longer.
  assert.equal(world.planets[0]!.resources.metal, RICH.metal - 300 - 480 + 14);
  assert.deepEqual(world.planets[0]!.researchQueue, [
    { branch: "mining", level: 1, remaining: 59 },
    { branch: "mining", level: 2, remaining: 84 },
  ]);
  assert.deepEqual(researchCost(world.planets[0]!, "mining", RULES), {
    metal: 660,
    crystal: 660,
    eonium: 220,
  });
  world = idle(world, 59);
  assert.equal(world.planets[0]!.research.mining, 1);
  assert.equal(world.planets[0]!.researchQueue[0]!.remaining, 84);
  world = idle(world, 84);
  assert.equal(world.planets[0]!.research.mining, 2);

  // Each lab past the first makes research 15% faster, up to 60%.
  assert.equal(researchTicks(withLab(1).planets[0]!, "travel", RULES), 60);
  assert.equal(researchTicks(withLab(2).planets[0]!, "travel", RULES), 52);
  assert.equal(researchTicks(withLab(5).planets[0]!, "travel", RULES), 37);
  assert.equal(
    researchTicks(withLab(9).planets[0]!, "travel", RULES),
    researchTicks(withLab(5).planets[0]!, "travel", RULES),
  );
});

test("a branch stops at its highest level, counting what is queued", () => {
  const world = withPlanet(withLab(), 0, {
    research: { travel: 5, hulls: 4, sensors: 0, mining: 0, jamming: 0 },
    researchQueue: [{ branch: "hulls", level: 5, remaining: 9 }],
  });
  for (const branch of ["travel", "hulls"] as const)
    assert.equal(
      refusal(world, 0, { type: "startResearch", branch }),
      "that branch is at its highest level",
    );
  assert.equal(
    refusal(world, 0, { type: "startResearch", branch: "sensors" }),
    undefined,
  );
  assert.equal(
    refusal(
      withPlanet(world, 0, {
        resources: { metal: 199, crystal: 300, eonium: 300 },
      }),
      0,
      { type: "startResearch", branch: "sensors" },
    ),
    "not enough resources",
  );
});

const withYard = (yards = 1, hulls = 0) =>
  withPlanet(rich(start()), 0, {
    structures: { ...start().planets[0]!.structures, shipyard: yards },
    research: { travel: 0, hulls, sensors: 0, mining: 0, jamming: 0 },
  });

test("ships need a shipyard and the hulls research their class asks for", () => {
  assert.equal(
    refusal(rich(start()), 0, {
      type: "produceShips",
      shipClass: "fighter",
      count: 3,
    }),
    "ship production needs a shipyard",
  );
  assert.equal(
    refusal(withYard(), 0, {
      type: "produceShips",
      shipClass: "corvette",
      count: 1,
    }),
    "that class needs hulls research level 1",
  );
  assert.equal(
    refusal(withYard(1, 4), 0, {
      type: "produceShips",
      shipClass: "battleship",
      count: 1,
    }),
    "that class needs hulls research level 5",
  );
  assert.equal(
    refusal(withYard(1, 5), 0, {
      type: "produceShips",
      shipClass: "battleship",
      count: 1,
    }),
    undefined,
  );
});

test("an order of ships is paid for whole and delivered together; orders run side by side", () => {
  let world = tick(
    withYard(1, 1),
    from(
      0,
      { type: "produceShips", shipClass: "fighter", count: 10 },
      { type: "produceShips", shipClass: "corvette", count: 2 },
    ),
  );
  assert.equal(world.planets[0]!.resources.metal, RICH.metal - 600 - 240 + 14);
  assert.equal(world.planets[0]!.resources.eonium, RICH.eonium - 20 + 10);
  assert.deepEqual(world.planets[0]!.production, [
    { shipClass: "fighter", count: 10, remaining: 19 },
    { shipClass: "corvette", count: 2, remaining: 29 },
  ]);
  world = idle(world, 19);
  assert.equal(world.planets[0]!.ships.fighter, 10);
  assert.equal(world.planets[0]!.ships.corvette, 0);
  assert.deepEqual(eventsOf(world, "shipsBuilt"), [
    { type: "shipsBuilt", player: 0, shipClass: "fighter", count: 10 },
  ]);
  world = idle(world, 10);
  assert.equal(world.planets[0]!.ships.corvette, 2);
  assert.deepEqual(world.planets[0]!.production, []);
});

test("ship orders are bounded in number, size and price, and more shipyards are faster", () => {
  const order = (count: number) =>
    ({ type: "produceShips", shipClass: "fighter", count }) as const;
  const world = tick(
    withYard(),
    from(0, order(1), order(1), order(1), order(1), order(1)),
  );
  assert.deepEqual(reasons(world), ["the production queue is full"]);
  assert.equal(world.planets[0]!.production.length, 4);

  assert.equal(
    refusal(withYard(), 0, order(1001)),
    "an order holds at most 1000 ships",
  );
  for (const count of [0, -1, 1.5, Number.NaN])
    assert.equal(
      refusal(withYard(), 0, order(count)),
      "count must be a whole number of at least 1",
    );
  const poor = withPlanet(withYard(), 0, {
    resources: { metal: 179, crystal: 60, eonium: 0 },
  });
  assert.equal(refusal(poor, 0, order(3)), "not enough resources");
  assert.equal(refusal(poor, 0, order(2)), undefined);
  assert.equal(
    affordableCount(poor.planets[0]!.resources, RULES.ships.fighter.cost, 1000),
    2,
  );
  assert.equal(affordableCount(RICH, RULES.ships.fighter.cost, 1000), 1000);

  assert.equal(productionTicks(withYard(1).planets[0]!, "cruiser", RULES), 80);
  assert.equal(productionTicks(withYard(3).planets[0]!, "cruiser", RULES), 61);
  assert.equal(productionTicks(withYard(5).planets[0]!, "cruiser", RULES), 50);
});

test("value counts asteroids, structures, research, ships and stock; score is value", () => {
  const world = start();
  // 2000 resources at 20 a point, and three asteroids at 150.
  assert.equal(world.planets[0]!.value, 100 + 450);
  assert.equal(world.planets[0]!.score, 550);

  const planet = {
    ...world.planets[0]!,
    resources: { metal: 39, crystal: 0, eonium: 0 },
    asteroids: { metal: 2, crystal: 0, eonium: 0 },
    structures: {
      metalRefinery: 1,
      crystalRefinery: 0,
      eoniumRefinery: 0,
      researchLab: 2,
      shipyard: 0,
    },
    research: { travel: 0, hulls: 3, sensors: 0, mining: 1, jamming: 0 },
    ships: { ...world.planets[0]!.ships, fighter: 10, battleship: 1 },
  };
  assert.equal(
    planetValue(planet, 1000, RULES),
    1000 + (80 + 500) + 1 + 300 + (40 + 180) + (330 + 70),
  );
});

test("a planet's value follows what it buys, tick by tick", () => {
  const world = tick(
    start(),
    from(0, { type: "initiateAsteroid", resource: "metal" }),
  );
  const planet = world.planets[0]!;
  assert.equal(planet.asteroids.metal, 2);
  assert.equal(planet.value, planetValue(planet, 0, RULES));
  assert.equal(planet.value, 4 * 150 + div(743 + 739 + 410, 20));
  assert.equal(planet.score, planet.value);
});

test("a team's score is its members' scores and what its fund is worth", () => {
  const world = withTeam(start(), 1, {
    fund: { metal: 100, crystal: 100, eonium: 219 },
  });
  assert.equal(teamScore(world.teams[0]!, world.planets, RULES), 1100);
  assert.equal(teamScore(world.teams[1]!, world.planets, RULES), 1100 + 20);
});

const SHORT: Rules = { ...RULES, match: { tickLimit: 3 } };

test("the match ends at the tick limit and the team with the higher score wins", () => {
  let world = tick(
    start(1, undefined, SHORT),
    from(3, { type: "initiateAsteroid", resource: "metal" }),
    SHORT,
  );
  world = idle(world, 1, SHORT);
  assert.equal(world.phase, "running");
  assert.equal(world.result, null);
  world = tick(world, [], SHORT);
  assert.equal(world.tick, 3);
  assert.equal(world.phase, "ended");
  assert.ok(world.result);
  assert.equal(world.result.winner, 1);
  assert.equal(world.result.tick, 3);
  assert.deepEqual(
    world.result.teamScores,
    world.teams.map((team) => teamScore(team, world.planets, SHORT)),
  );
  assert.ok(world.result.teamScores[1]! > world.result.teamScores[0]!);
  assert.deepEqual(eventsOf(world, "matchEnded"), [
    { type: "matchEnded", winner: 1 },
  ]);
});

test("teams level on score draw", () => {
  const world = idle(start(1, undefined, SHORT), 3, SHORT);
  assert.equal(world.phase, "ended");
  assert.equal(world.result?.winner, NONE);
  assert.deepEqual(eventsOf(world, "matchEnded"), [
    { type: "matchEnded", winner: NONE },
  ]);

  // Three teams: the two in front are level, so nobody wins; then the third pulls ahead of both.
  const three = { teams: 3, teamSize: 1, neutrals: 0 };
  const level = idle(
    withPlanet(start(1, three, SHORT), 2, {
      resources: { metal: 0, crystal: 0, eonium: 0 },
    }),
    3,
    SHORT,
  );
  assert.equal(level.result?.winner, NONE);
  const ahead = idle(
    withPlanet(start(1, three, SHORT), 2, { resources: RICH }),
    3,
    SHORT,
  );
  assert.equal(ahead.result?.winner, 2);
});

test("an ended match stays as it is and refuses whatever is sent", () => {
  const ended = idle(start(1, undefined, SHORT), 3, SHORT);
  assert.equal(tick(ended, [], SHORT), ended);
  const after = tick(
    ended,
    [
      ...from(0, { type: "initiateAsteroid", resource: "metal" }),
      { player: 99, command: null },
      { player: 0.5, command: { type: "donate" } },
    ],
    SHORT,
  );
  assert.equal(after.tick, 3);
  assert.deepEqual(after.planets, ended.planets);
  assert.deepEqual(after.result, ended.result);
  assert.deepEqual(after.events, [
    {
      type: "rejected",
      player: 0,
      command: "initiateAsteroid",
      reason: "the match has ended",
    },
    {
      type: "rejected",
      player: NONE,
      command: "malformed",
      reason: "the match has ended",
    },
    {
      type: "rejected",
      player: NONE,
      command: "donate",
      reason: "the match has ended",
    },
  ]);
});
