import test from "node:test";
import assert from "node:assert/strict";
import {
  NONE,
  SETUP_3V3,
  commandProblemFor,
  createEnv,
  hashWorld,
  legalCommands,
  minimalCommand,
  noShips,
  type Command,
  type CommandOption,
  type DeepReadonly,
  type GameEvent,
  type World,
} from "../src/engine/index.js";
import { createRoster } from "../src/bots/roster.js";
import {
  RICH,
  RULES,
  fleetOf as fleet,
  from,
  idle,
  knowing,
  reasons,
  refusal,
  reportOf as report,
  rich,
  ships,
  start,
  tick,
  viewFor,
  withPlanet,
  withTeam,
} from "./support.js";

test("a player sees their own planet, their teammates' and their team's record in full", () => {
  const world = tick(start(), from(2, { type: "voteCommander", candidate: 2 }));
  const view = viewFor(world, 0);
  assert.equal(view.self, 0);
  assert.equal(view.tick, 1);
  assert.equal(view.phase, "running");
  assert.equal(view.result, null);
  assert.deepEqual(view.planet, world.planets[0]);
  assert.deepEqual(view.allies, [world.planets[2]]);
  assert.deepEqual(view.team, world.teams[0]);
  assert.deepEqual(viewFor(world, 3).allies, [world.planets[1]]);
  assert.deepEqual(viewFor(world, 3).team, world.teams[1]);

  const three = viewFor(start(1, SETUP_3V3), 2);
  assert.deepEqual(
    three.allies.map((ally) => ally.id),
    [0, 4],
  );
});

// A view shares the world's own objects, so they must be ones that cannot be written to.
test("a bot cannot change the match through what its view hands it", () => {
  const world = tick(start(), from(2, { type: "voteCommander", candidate: 2 }));
  const before = hashWorld(world);
  const view = viewFor(world, 0);
  const writes: readonly (() => unknown)[] = [
    () => Object.assign(view.planet.resources, { metal: 1_000_000 }),
    () => Object.assign(view.planet, { score: 1_000_000 }),
    () => Object.assign(view.allies[0]!.ships, { battleship: 99 }),
    () => Object.assign(view.team!, { commander: 0 }),
    () => Object.assign(view.team!.fund, { metal: 1_000_000 }),
    () => Object.assign(view.team!.votes, { 0: 0 }),
  ];
  for (const write of writes) assert.throws(write, TypeError);
  assert.equal(hashWorld(world), before);
  assert.equal(world.planets[0]!.resources.metal, view.planet.resources.metal);
});

test("every planet is on the map with its place, its side and its score, and nothing more", () => {
  const world = idle(start(), 3);
  const view = viewFor(world, 1);
  assert.equal(view.planets.length, 10);
  for (const [id, planet] of view.planets.entries()) {
    const full = world.planets[id]!;
    assert.deepEqual(planet, {
      id,
      kind: full.kind,
      team: full.team,
      x: full.x,
      y: full.y,
      score: full.score,
    });
  }
  assert.deepEqual(
    view.planets.map((planet) => planet.team),
    [0, 1, 0, 1, NONE, NONE, NONE, NONE, NONE, NONE],
  );
});

/** A world where everything team 0 must not see carries a number that appears nowhere else. */
function secretive(): World {
  let world = start(7770015);
  for (const id of [1, 3, 4])
    world = withPlanet(world, id, {
      resources: { metal: 7770001, crystal: 7770002, eonium: 7770003 },
      ships: { ...noShips(), cruiser: 7770004 },
      research: { ...world.planets[id]!.research, jamming: 7770005 },
      structures: { ...world.planets[id]!.structures, shipyard: 7770006 },
      formation: { ...world.planets[id]!.formation, cruiser: 3 },
      sheltered: true,
      xp: 7770007,
      construction: [{ structure: "shipyard", remaining: 7770008 }],
      researchQueue: [{ branch: "hulls", level: 1, remaining: 7770016 }],
      production: [{ shipClass: "fighter", count: 7770017, remaining: 3 }],
      value: 7770009,
    });
  world = withTeam(world, 1, {
    fund: { metal: 7770010, crystal: 0, eonium: 0 },
    taxPercent: 7770011,
    commander: 3,
    votes: [3, 3],
    defencePriority: 3,
  });
  const events: GameEvent[] = [
    { type: "rejected", player: 1, command: "setTax", reason: "s-7770014" },
    { type: "shipsBuilt", player: 3, shipClass: "fighter", count: 7770018 },
    { type: "structureBuilt", player: 4, structure: "shipyard" },
  ];
  return {
    ...knowing(world, {
      1: [report(0, 7770013, 1)],
      4: [report(2, 7770019, 4)],
    }),
    fleets: [
      fleet(1, 1, 0, { eta: 7770012 }),
      fleet(2, 4, 2, { eta: 7770020 }),
    ],
    events,
  };
}

test("what another team or a neutral planet holds, plans and knows is not in the view", () => {
  const world = secretive();
  for (const player of [0, 2]) {
    const view = viewFor(world, player);
    const shown = JSON.stringify(view);
    assert.doesNotMatch(shown, /77700\d\d/);
    assert.doesNotMatch(shown, /shipyard":77|"cruiser":77/);
    assert.deepEqual(view.fleets, []);
    assert.deepEqual(view.reports, []);
    assert.deepEqual(view.events, []);
    // Nothing of the world's own bookkeeping either: the seed and the random stream would give the map away.
    assert.ok(!shown.includes(String(world.rng)));
    for (const key of ["rng", "seed", "knowledge", "teams", "nextFleetId"])
      assert.ok(!(key in view), key);
  }
  // The same numbers are there for those they belong to, so the check above has something to miss.
  for (const player of [1, 3])
    for (const secret of [7770001, 7770010, 7770012, 7770013])
      assert.ok(JSON.stringify(viewFor(world, player)).includes(`${secret}`));
  const neutral = JSON.stringify(viewFor(world, 4));
  assert.ok(neutral.includes("7770001") && neutral.includes("7770019"));
  assert.ok(!neutral.includes("7770010") && !neutral.includes("7770013"));
});

test("a player sees their team's fleets and nobody else's", () => {
  const fleets = [
    fleet(1, 0, 1),
    fleet(2, 2, 0, { mission: "defend", phase: "stationed" }),
    fleet(3, 1, 0),
    fleet(4, 4, 0),
    fleet(5, 3, 1, { mission: "defend" }),
  ];
  const world: World = { ...start(), fleets };
  const ids = (player: number) =>
    viewFor(world, player).fleets.map((seen) => seen.id);
  assert.deepEqual(ids(0), [1, 2]);
  assert.deepEqual(ids(2), [1, 2]);
  assert.deepEqual(ids(1), [3, 5]);
  assert.deepEqual(ids(3), [3, 5]);
  assert.deepEqual(ids(4), [4]);
  assert.deepEqual(ids(5), []);
  assert.deepEqual(viewFor(world, 0).fleets[1], fleets[1]);
});

test("a player hears what concerns them: their own refusals, their team's news, the match's end", () => {
  const events: GameEvent[] = [
    { type: "rejected", player: 0, command: "setTax", reason: "zero" },
    { type: "rejected", player: 2, command: "setTax", reason: "two" },
    { type: "rejected", player: NONE, command: "donate", reason: "nobody" },
    { type: "asteroidInitiated", player: 2, resource: "metal" },
    { type: "asteroidInitiated", player: 1, resource: "metal" },
    { type: "structureBuilt", player: 2, structure: "shipyard" },
    { type: "researchDone", player: 3, branch: "mining", level: 1 },
    { type: "shipsBuilt", player: 0, shipClass: "fighter", count: 2 },
    { type: "shipsBuilt", player: 4, shipClass: "fighter", count: 1 },
    {
      type: "fleetArrived",
      player: 1,
      fleet: 3,
      target: 0,
      mission: "observe",
    },
    { type: "fleetReturned", player: 2, fleet: 2 },
    { type: "commanderChanged", team: 0, commander: 2 },
    { type: "commanderChanged", team: 1, commander: 3 },
    { type: "matchEnded", winner: 1 },
  ];
  const world: World = { ...start(), events };
  const heard = (player: number) =>
    viewFor(world, player).events.map((event) => world.events.indexOf(event));
  assert.deepEqual(heard(0), [0, 5, 7, 10, 11, 13]);
  assert.deepEqual(heard(2), [1, 3, 5, 7, 10, 11, 13]);
  assert.deepEqual(heard(1), [4, 6, 9, 12, 13]);
  assert.deepEqual(heard(3), [6, 9, 12, 13]);
  assert.deepEqual(heard(4), [8, 13]);
  assert.deepEqual(heard(5), [13]);
});

test("a team shares its scout reports: the latest on each planet, in planet order", () => {
  const sharper = { detail: 3, ships: { ...noShips(), corvette: 2 } };
  const world = knowing(start(), {
    0: [
      report(3, 10, 0),
      report(1, 5, 0),
      report(6, 4, 0),
      report(7, 4, 0, sharper),
    ],
    2: [
      report(1, 9, 2, { detail: 3, ships: { ...noShips(), frigate: 4 } }),
      report(5, 2, 2),
      report(3, 10, 2),
      report(6, 4, 2, sharper),
      report(7, 4, 2),
    ],
    1: [report(0, 7, 1)],
    4: [report(0, 8, 4)],
  });
  for (const player of [0, 2])
    assert.deepEqual(viewFor(world, player).reports, [
      report(1, 9, 2, { detail: 3, ships: { ...noShips(), frigate: 4 } }),
      // Both saw planet 3 equally well on the same tick: the lower planet's report is the one kept.
      report(3, 10, 0),
      report(5, 2, 2),
      // Both saw planets 6 and 7 on the same tick: the report that shows more is kept, whoever made it.
      report(6, 4, 2, sharper),
      report(7, 4, 0, sharper),
    ]);
  assert.deepEqual(viewFor(world, 1).reports, [report(0, 7, 1)]);
  assert.deepEqual(viewFor(world, 3).reports, [report(0, 7, 1)]);
  assert.deepEqual(viewFor(world, 4).reports, [report(0, 8, 4)]);
  assert.deepEqual(viewFor(world, 5).reports, []);
});

test("a report gathered in play reaches the teammate's view and not the planet it describes", () => {
  // Sensors two levels above the target's jammers: the report shows everything and the target is not told.
  let world = withPlanet(start(), 0, {
    research: { ...start().planets[0]!.research, sensors: 2 },
  });
  world = tick(
    world,
    from(0, {
      type: "launchFleet",
      mission: "observe",
      target: 1,
      ships: { probe: 1 },
    }),
  );
  assert.equal(viewFor(world, 2).fleets.length, 1);
  assert.equal(viewFor(world, 1).fleets.length, 0);
  world = idle(world, world.fleets[0]!.eta);
  assert.deepEqual(
    viewFor(world, 2).reports.map(({ target, by }) => ({ target, by })),
    [{ target: 1, by: 0 }],
  );
  assert.deepEqual(viewFor(world, 2).reports[0]!.resources, {
    metal: world.planets[1]!.resources.metal,
    crystal: world.planets[1]!.resources.crystal,
    eonium: world.planets[1]!.resources.eonium,
  });
  assert.deepEqual(viewFor(world, 1).reports, []);
  assert.deepEqual(viewFor(world, 1).events, []);
});

test("a neutral planet's view has no team, and a view of no planet is an error", () => {
  const world = start();
  const view = viewFor(world, 4);
  assert.equal(view.team, null);
  assert.deepEqual(view.allies, []);
  assert.deepEqual(view.planet, world.planets[4]);
  for (const id of [10, -1, 0.5, Number.NaN])
    assert.throws(() => viewFor(world, id), {
      name: "RangeError",
      message: `no planet has the id ${id}`,
    });
});

test("the view shows the result once the match has ended", () => {
  const ended = idle(start(), RULES.match.tickLimit);
  const view = viewFor(ended, 3);
  assert.equal(view.phase, "ended");
  assert.deepEqual(view.result, ended.result);
  assert.deepEqual(view.events, [{ type: "matchEnded", winner: NONE }]);
  assert.deepEqual(legalCommands(view, RULES), []);
});

const types = (options: readonly CommandOption[]) =>
  options.map((option) => option.type);

test("at the start a seat may mine, build, vote and donate, and is told what each costs", () => {
  const options = legalCommands(viewFor(start(), 0), RULES);
  assert.deepEqual(options, [
    {
      type: "initiateAsteroid",
      resource: "metal",
      cost: { metal: 75, crystal: 75, eonium: 0 },
    },
    {
      type: "initiateAsteroid",
      resource: "crystal",
      cost: { metal: 75, crystal: 75, eonium: 0 },
    },
    {
      type: "initiateAsteroid",
      resource: "eonium",
      cost: { metal: 75, crystal: 75, eonium: 0 },
    },
    {
      type: "buildStructure",
      structure: "metalRefinery",
      cost: { metal: 300, crystal: 100, eonium: 0 },
      ticks: 30,
    },
    {
      type: "buildStructure",
      structure: "crystalRefinery",
      cost: { metal: 100, crystal: 300, eonium: 0 },
      ticks: 30,
    },
    {
      type: "buildStructure",
      structure: "eoniumRefinery",
      cost: { metal: 200, crystal: 200, eonium: 0 },
      ticks: 30,
    },
    {
      type: "buildStructure",
      structure: "researchLab",
      cost: { metal: 400, crystal: 400, eonium: 100 },
      ticks: 45,
    },
    {
      type: "buildStructure",
      structure: "shipyard",
      cost: { metal: 500, crystal: 300, eonium: 100 },
      ticks: 45,
    },
    // Two probes at home: a fly-past or an orbit of every planet that is not a teammate's.
    ...[1, 3, 4, 5, 6, 7, 8, 9].flatMap((target): CommandOption[] => [
      {
        type: "launchFleet",
        mission: "observe",
        target,
        maxShips: ships({ probe: 2 }),
      },
      {
        type: "launchFleet",
        mission: "orbit",
        target,
        maxShips: ships({ probe: 2 }),
      },
    ]),
    {
      type: "setFormation",
      fleet: NONE,
      formations: ["line", "wall", "column", "wings"],
    },
    { type: "setShelter", sheltered: true },
    { type: "voteCommander", candidate: 0 },
    { type: "voteCommander", candidate: 2 },
    { type: "donate", max: { metal: 800, crystal: 800, eonium: 400 } },
  ]);
  // A neutral planet has the same economy, warships to attack with and no team.
  assert.deepEqual(
    [...new Set(types(legalCommands(viewFor(start(), 4), RULES)))],
    [
      "initiateAsteroid",
      "buildStructure",
      "launchFleet",
      "setFormation",
      "setShelter",
    ],
  );
});

test("a planet with nothing may still vote, and a rich commander with a fleet out may do everything", () => {
  const broke = withPlanet(start(), 0, {
    resources: { metal: 0, crystal: 0, eonium: 0 },
    ships: noShips(),
  });
  assert.deepEqual(types(legalCommands(viewFor(broke, 0), RULES)), [
    "setFormation",
    "setShelter",
    "voteCommander",
    "voteCommander",
  ]);

  let world = withTeam(rich(start()), 0, {
    commander: 0,
    votes: [0, 0],
    fund: { metal: 0, crystal: 30, eonium: 0 },
  });
  world = withPlanet(world, 0, {
    structures: {
      ...world.planets[0]!.structures,
      researchLab: 1,
      shipyard: 1,
    },
    research: { ...world.planets[0]!.research, hulls: 2 },
    ships: { ...noShips(), fighter: 3, frigate: 2 },
  });
  world = { ...world, fleets: [fleet(6, 0, 1), fleet(7, 2, 1)] };
  const options = legalCommands(viewFor(world, 0), RULES);
  const count = (type: CommandOption["type"]) =>
    options.filter((option) => option.type === type).length;
  assert.equal(count("initiateAsteroid"), 3);
  assert.equal(count("buildStructure"), 5);
  assert.equal(count("startResearch"), 5);
  // Probe, fighter, corvette, frigate and pod: what hulls level 2 allows.
  assert.equal(count("produceShips"), 5);
  // Every other planet: one teammate to defend, eight to attack. Nothing to observe with: it has no probe.
  assert.equal(count("launchFleet"), 9);
  assert.equal(count("recallFleet"), 1);
  // The home fleet's and the one fleet of its own.
  assert.equal(count("setFormation"), 2);
  assert.equal(count("setShelter"), 1);
  assert.equal(count("voteCommander"), 2);
  assert.equal(count("setTax"), 1);
  assert.equal(count("grant"), 2);
  assert.equal(count("setDefencePriority"), 3);
  assert.equal(count("donate"), 1);

  const find = <T extends CommandOption["type"]>(type: T) =>
    options.find(
      (option): option is Extract<CommandOption, { type: T }> =>
        option.type === type,
    )!;
  assert.deepEqual(find("startResearch"), {
    type: "startResearch",
    branch: "travel",
    level: 1,
    cost: { metal: 300, crystal: 300, eonium: 200 },
    ticks: 60,
  });
  const yard = options.filter((option) => option.type === "produceShips");
  assert.deepEqual(
    yard.map((option) => option.shipClass),
    ["probe", "fighter", "corvette", "frigate", "pod"],
  );
  assert.deepEqual(yard[1], {
    type: "produceShips",
    shipClass: "fighter",
    maxCount: 1000,
    unitCost: { metal: 60, crystal: 20, eonium: 0 },
    ticks: 20,
  });
  assert.deepEqual(
    options.filter((option) => option.type === "launchFleet").slice(0, 2),
    [
      {
        type: "launchFleet",
        mission: "attack",
        target: 1,
        maxShips: { ...noShips(), fighter: 3, frigate: 2 },
      },
      {
        type: "launchFleet",
        mission: "defend",
        target: 2,
        maxShips: { ...noShips(), fighter: 3, frigate: 2 },
      },
    ],
  );
  assert.deepEqual(find("recallFleet"), { type: "recallFleet", fleet: 6 });
  assert.deepEqual(
    options.filter((option) => option.type === "setFormation"),
    [NONE, 6].map((id) => ({
      type: "setFormation",
      fleet: id,
      formations: ["line", "wall", "column", "wings"],
    })),
  );
  assert.deepEqual(find("setTax"), { type: "setTax", maxPercent: 30 });
  assert.deepEqual(find("grant"), {
    type: "grant",
    to: 0,
    max: { metal: 0, crystal: 30, eonium: 0 },
  });
  assert.deepEqual(find("donate"), { type: "donate", max: RICH });
  assert.deepEqual(
    options
      .filter((option) => option.type === "setDefencePriority")
      .map((option) => option.planet),
    [0, 2, NONE],
  );
});

test("the smallest command of each option is the one the engine is asked about", () => {
  const cases: readonly (readonly [CommandOption, Command])[] = [
    [
      { type: "initiateAsteroid", resource: "eonium", cost: RICH },
      { type: "initiateAsteroid", resource: "eonium" },
    ],
    [
      { type: "buildStructure", structure: "shipyard", cost: RICH, ticks: 4 },
      { type: "buildStructure", structure: "shipyard" },
    ],
    [
      {
        type: "startResearch",
        branch: "jamming",
        level: 3,
        cost: RICH,
        ticks: 9,
      },
      { type: "startResearch", branch: "jamming" },
    ],
    [
      {
        type: "produceShips",
        shipClass: "cruiser",
        maxCount: 40,
        unitCost: RICH,
        ticks: 9,
      },
      { type: "produceShips", shipClass: "cruiser", count: 1 },
    ],
    [
      {
        type: "launchFleet",
        mission: "defend",
        target: 2,
        maxShips: { ...noShips(), destroyer: 5, battleship: 2 },
      },
      {
        type: "launchFleet",
        mission: "defend",
        target: 2,
        ships: { destroyer: 1 },
      },
    ],
    [
      {
        type: "launchFleet",
        mission: "observe",
        target: 1,
        maxShips: noShips(),
      },
      { type: "launchFleet", mission: "observe", target: 1, ships: {} },
    ],
    [
      { type: "recallFleet", fleet: 12 },
      { type: "recallFleet", fleet: 12 },
    ],
    [
      { type: "setFormation", fleet: NONE, formations: ["wall", "line"] },
      { type: "setFormation", fleet: NONE, arrangement: "wall" },
    ],
    [
      { type: "setFormation", fleet: 4, formations: [] },
      { type: "setFormation", fleet: 4, arrangement: "" },
    ],
    [
      { type: "setShelter", sheltered: false },
      { type: "setShelter", sheltered: false },
    ],
    [
      { type: "voteCommander", candidate: 2 },
      { type: "voteCommander", candidate: 2 },
    ],
    [
      { type: "setTax", maxPercent: 30 },
      { type: "setTax", percent: 0 },
    ],
    [
      { type: "grant", to: 2, max: { metal: 0, crystal: 0, eonium: 9 } },
      { type: "grant", to: 2, resources: { eonium: 1 } },
    ],
    [
      { type: "grant", to: 2, max: { metal: 0, crystal: 0, eonium: 0 } },
      { type: "grant", to: 2, resources: {} },
    ],
    [
      { type: "setDefencePriority", planet: NONE },
      { type: "setDefencePriority", planet: NONE },
    ],
    [
      { type: "donate", max: { metal: 4, crystal: 4, eonium: 0 } },
      { type: "donate", resources: { metal: 1 } },
    ],
  ];
  for (const [option, command] of cases)
    assert.deepEqual(minimalCommand(option), command);
});

/** The most an option allows. */
function maximalCommand(option: CommandOption): Command {
  switch (option.type) {
    case "produceShips":
      return {
        type: option.type,
        shipClass: option.shipClass,
        count: option.maxCount,
      };
    case "launchFleet":
      return {
        type: option.type,
        mission: option.mission,
        target: option.target,
        ships: option.maxShips,
      };
    case "setTax":
      return { type: option.type, percent: option.maxPercent };
    case "grant":
      return { type: option.type, to: option.to, resources: option.max };
    case "donate":
      return { type: option.type, resources: option.max };
    default:
      return minimalCommand(option);
  }
}

/** Every command with no amounts to choose, legal or not, that the player could send. */
function simpleCommands(world: World): Command[] {
  const planets = [...world.planets.map((planet) => planet.id), NONE];
  return [
    ...(["metal", "crystal", "eonium"] as const).map((resource): Command => ({
      type: "initiateAsteroid",
      resource,
    })),
    ...(
      [
        "metalRefinery",
        "crystalRefinery",
        "eoniumRefinery",
        "researchLab",
        "shipyard",
      ] as const
    ).map((structure): Command => ({ type: "buildStructure", structure })),
    ...(["travel", "hulls", "sensors", "mining", "jamming"] as const).map(
      (branch): Command => ({ type: "startResearch", branch }),
    ),
    ...(
      [
        "fighter",
        "corvette",
        "frigate",
        "destroyer",
        "cruiser",
        "battleship",
        "probe",
        "pod",
      ] as const
    ).map((shipClass): Command => ({
      type: "produceShips",
      shipClass,
      count: 1,
    })),
    ...world.fleets.flatMap((flying): Command[] => [
      { type: "recallFleet", fleet: flying.id },
      { type: "setFormation", fleet: flying.id, arrangement: "line" },
    ]),
    { type: "setFormation", fleet: NONE, arrangement: "line" },
    { type: "setShelter", sheltered: true },
    { type: "setShelter", sheltered: false },
    ...planets.flatMap((planet): Command[] => [
      { type: "voteCommander", candidate: planet },
      { type: "setDefencePriority", planet },
    ]),
    { type: "setTax", percent: 0 },
  ];
}

/** Worlds from a match the bots played, taken every so often, so the checks below meet states nobody wrote by hand. */
function sampledWorlds(): World[] {
  const bot = createRoster("mixed");
  const env = createEnv({ rules: RULES, neutralPolicy: bot });
  let step = env.reset(3, SETUP_3V3);
  const worlds: World[] = [];
  while (!step.done && step.tick < 1400) {
    const commands = new Map<number, readonly Command[]>();
    for (const view of step.views) commands.set(view.self, bot(view, RULES));
    step = env.step(commands);
    if (step.tick % 127 === 0) worlds.push(env.world());
  }
  return worlds;
}

test("what the mask offers the engine carries out, at its least and at its most; what it leaves out the engine refuses", () => {
  const worlds = sampledWorlds();
  assert.ok(worlds.length >= 10);
  const seen = new Set<string>();
  let offered = 0;
  for (const world of worlds)
    for (const { id: player } of world.planets) {
      const view = viewFor(world, player);
      const options = legalCommands(view, RULES);
      const least = new Set<string>();
      for (const option of options) {
        seen.add(option.type);
        offered += 1;
        least.add(JSON.stringify(minimalCommand(option)));
        for (const command of [minimalCommand(option), maximalCommand(option)])
          assert.equal(
            refusal(world, player, command),
            undefined,
            `tick ${world.tick}, planet ${player}: ${JSON.stringify(command)}`,
          );
      }
      for (const command of simpleCommands(world)) {
        const problem = refusal(world, player, command);
        assert.equal(
          least.has(JSON.stringify(command)),
          problem === undefined,
          `tick ${world.tick}, planet ${player}: ${JSON.stringify(command)} (${problem})`,
        );
        assert.equal(commandProblemFor(view, command, RULES), problem);
      }
    }
  assert.ok(offered > 1000);
  // The bots' match reached every kind of option.
  assert.deepEqual([...seen].sort(), [
    "buildStructure",
    "donate",
    "grant",
    "initiateAsteroid",
    "launchFleet",
    "produceShips",
    "recallFleet",
    "setDefencePriority",
    "setFormation",
    "setShelter",
    "setTax",
    "startResearch",
    "voteCommander",
  ]);
});

test("the view's check answers as the engine does for a command with amounts", () => {
  const world = withPlanet(start(), 0, {
    ships: ships({ probe: 2, fighter: 2 }),
  });
  const view = viewFor(world, 0);
  const launch = (
    mission: "attack" | "defend" | "observe" | "orbit",
    target: number,
    sent: Partial<Record<"probe" | "fighter", number>>,
  ): Command => ({ type: "launchFleet", mission, target, ships: sent });
  const commands: readonly Command[] = [
    { type: "donate", resources: { metal: 801 } },
    { type: "donate", resources: { metal: 800 } },
    launch("observe", 1, { probe: 3 }),
    launch("observe", 1, { probe: 2 }),
    launch("attack", 1, { fighter: 1 }),
    launch("defend", 1, { fighter: 1 }),
    launch("observe", 2, { probe: 1 }),
    launch("orbit", 1, { fighter: 1 }),
    launch("attack", 1, { fighter: 1, probe: 1 }),
    launch("attack", 2, { fighter: 1 }),
  ];
  assert.deepEqual(
    commands.map((command) => commandProblemFor(view, command, RULES)),
    [
      "not enough resources",
      undefined,
      "not enough ships at home",
      undefined,
      undefined,
      "a fleet can only defend a teammate",
      "there is nothing to observe on a teammate's planet",
      "only probes fly an observing mission",
      "probes fly observing missions only",
      "a fleet cannot attack a teammate",
    ],
  );
  for (const command of commands)
    assert.equal(
      commandProblemFor(view, command, RULES),
      refusal(world, 0, command),
    );
  assert.deepEqual(
    reasons(tick(world, from(0, commands[1]!, commands[3]!))),
    [],
  );
});
