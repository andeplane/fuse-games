import test from "node:test";
import assert from "node:assert/strict";
import {
  NONE,
  SETUP_2V2,
  SETUP_3V3,
  createEnv,
  createWorld,
  distance,
  hashWorld,
  parseMatchLog,
  parseSetup,
  replay,
  setupProblem,
  type Command,
  type MatchLog,
  type MatchSetup,
  type Policy,
  type Rules,
} from "../src/engine/index.js";
import { RULES, from, idle, ships, start, tick, viewFor } from "./support.js";

const SHORT: Rules = { ...RULES, match: { tickLimit: 12 } };

const commands = (
  ...entries: readonly (readonly [number, readonly Command[]])[]
): ReadonlyMap<number, readonly Command[]> => new Map(entries);

const roid: Command = { type: "initiateAsteroid", resource: "metal" };

test("reset starts a match and shows every seat its view", () => {
  const env = createEnv({ rules: RULES });
  const first = env.reset(1, SETUP_2V2);
  assert.equal(first.tick, 0);
  assert.equal(first.done, false);
  assert.deepEqual(first.rewards, [0, 0, 0, 0]);
  assert.deepEqual(
    first.views.map((view) => view.self),
    [0, 1, 2, 3],
  );
  assert.deepEqual(first.views[2], viewFor(start(), 2));
  assert.equal(hashWorld(env.world()), hashWorld(start()));
  assert.equal(env.reset(1, SETUP_3V3).views.length, 6);
});

test("a step plays one tick from the seats' commands and rewards each seat with its score's change", () => {
  const env = createEnv({ rules: RULES });
  env.reset(1, SETUP_2V2);
  const step = env.step(
    commands(
      [0, [roid, roid]],
      [3, [{ type: "donate", resources: { metal: 400 } }]],
    ),
  );
  const expected = tick(start(), [
    ...from(0, roid, roid),
    ...from(3, { type: "donate", resources: { metal: 400 } }),
  ]);
  assert.equal(step.tick, 1);
  assert.equal(step.done, false);
  assert.equal(hashWorld(env.world()), hashWorld(expected));
  assert.deepEqual(
    step.rewards,
    [0, 1, 2, 3].map((seat) => expected.planets[seat]!.score - 562),
  );
  // Two asteroids are worth more than they cost; a donation leaves the planet.
  assert.ok(step.rewards[0]! > step.rewards[1]!);
  assert.ok(step.rewards[3]! < 0);
  assert.equal(step.views[0]!.planet.asteroids.metal, 3);
  assert.deepEqual(step.views[0]!.events, [
    { type: "asteroidInitiated", player: 0, resource: "metal" },
    { type: "asteroidInitiated", player: 0, resource: "metal" },
  ]);
  const idleStep = env.step(commands());
  assert.equal(idleStep.tick, 2);
  assert.equal(hashWorld(env.world()), hashWorld(tick(expected)));
});

test("commands are taken from seats only: a neutral planet is played by the policy or not at all", () => {
  const env = createEnv({ rules: RULES });
  env.reset(1, SETUP_2V2);
  env.step(commands([4, [roid]], [99, [roid]], [NONE, [roid]], [1, [roid]]));
  assert.equal(hashWorld(env.world()), hashWorld(tick(start(), from(1, roid))));
  assert.deepEqual(env.log().entries, [
    { tick: 1, submissions: [{ player: 1, command: roid }] },
  ]);

  const asked: number[] = [];
  const policy: Policy = (view, rules) => {
    asked.push(view.self);
    assert.equal(rules, RULES);
    return view.self === 5 && view.tick === 0 ? [roid] : [];
  };
  const played = createEnv({ rules: RULES, neutralPolicy: policy });
  played.reset(1, SETUP_2V2);
  played.step(commands([5, [roid, roid, roid]]));
  assert.deepEqual(asked, [4, 5, 6, 7, 8, 9]);
  assert.equal(
    played.world().planets[5]!.asteroids.metal,
    start().planets[5]!.asteroids.metal + 1,
  );
  assert.deepEqual(played.log().entries, [
    { tick: 1, submissions: [{ player: 5, command: roid }] },
  ]);
});

test("an environment must be reset before it is used", () => {
  const env = createEnv({ rules: RULES });
  const unready = { message: "reset the environment before using it" };
  assert.throws(() => env.step(commands()), unready);
  assert.throws(() => env.world(), unready);
  assert.throws(() => env.log(), unready);
  assert.throws(() => env.reset(1.5, SETUP_2V2), {
    name: "RangeError",
    message: "the seed must be a whole number",
  });
  assert.throws(() => env.reset(1, { ...SETUP_2V2, teams: 9 }), RangeError);
  // A refused reset leaves it unready.
  assert.throws(() => env.world(), unready);
});

test("the match is done at the tick limit, and a step after that changes nothing and is not logged", () => {
  const env = createEnv({ rules: SHORT });
  let step = env.reset(4, SETUP_2V2);
  let steps = 0;
  while (!step.done) {
    step = env.step(commands([2, steps === 3 ? [roid] : []]));
    steps += 1;
  }
  assert.equal(steps, 12);
  assert.equal(step.tick, 12);
  assert.equal(step.views[0]!.phase, "ended");
  assert.deepEqual(step.views[1]!.result, env.world().result);
  const ended = env.world();
  const log = env.log();

  const after = env.step(commands([0, [roid]]));
  assert.equal(after.done, true);
  assert.equal(after.tick, 12);
  assert.deepEqual(after.rewards, [0, 0, 0, 0]);
  assert.equal(env.world(), ended);
  assert.deepEqual(env.log(), log);
  assert.equal(log.ticks, 12);
  assert.deepEqual(log.entries, [
    { tick: 4, submissions: [{ player: 2, command: roid }] },
  ]);
});

test("the log names the rules, the seed and the setup, and a reset starts a new one", () => {
  const env = createEnv({ rules: RULES });
  const setup: MatchSetup = { teams: 2, teamSize: 1, neutrals: 2 };
  env.reset(77, setup);
  env.step(commands());
  env.step(commands([0, [roid]]));
  env.step(commands());
  const log = env.log();
  assert.deepEqual(log, {
    rulesVersion: RULES.version,
    seed: 77,
    setup,
    ticks: 3,
    entries: [{ tick: 2, submissions: [{ player: 0, command: roid }] }],
  });
  // A log handed out is not added to by later steps.
  env.step(commands([1, [roid]]));
  assert.equal(log.entries.length, 1);
  assert.equal(env.log().entries.length, 2);

  env.reset(78, SETUP_2V2);
  assert.deepEqual(env.log(), {
    rulesVersion: RULES.version,
    seed: 78,
    setup: SETUP_2V2,
    ticks: 0,
    entries: [],
  });
});

/** A short match with commands on some ticks, refusals among them, and a neutral planet that plays. */
function recorded(): { log: MatchLog; hash: string } {
  const neutral: Policy = (view) =>
    view.tick % 9 === view.self
      ? [{ type: "initiateAsteroid", resource: "crystal" }]
      : [];
  const env = createEnv({ rules: RULES, neutralPolicy: neutral });
  env.reset(21, SETUP_3V3);
  const script = new Map<number, ReadonlyMap<number, readonly Command[]>>([
    [0, commands([0, [roid]], [5, [{ type: "voteCommander", candidate: 5 }]])],
    [
      1,
      commands(
        [5, [{ type: "setTax", percent: 25 }]],
        [1, [{ type: "setTax", percent: 25 }]],
      ),
    ],
    [3, commands([2, [{ type: "buildStructure", structure: "shipyard" }]])],
    [
      50,
      commands([2, [{ type: "produceShips", shipClass: "fighter", count: 2 }]]),
    ],
    [
      75,
      commands([
        2,
        [
          {
            type: "launchFleet",
            mission: "observe",
            target: 1,
            ships: { probe: 1 },
          },
          {
            type: "launchFleet",
            mission: "defend",
            target: 0,
            ships: { fighter: 1 },
          },
        ],
      ]),
    ],
    [80, commands([2, [{ type: "recallFleet", fleet: 2 }]])],
  ]);
  for (let step = 0; step < 130; step++)
    env.step(script.get(step) ?? commands());
  const world = env.world();
  assert.equal(world.tick, 130);
  assert.equal(world.teams[1]!.taxPercent, 25);
  assert.equal(world.knowledge[2]!.reports.length, 1);
  assert.ok(world.planets[7]!.asteroids.crystal > 4);
  return { log: env.log(), hash: hashWorld(world) };
}

test("a match played again from its log ends in the same world, hash for hash", () => {
  const { log, hash } = recorded();
  assert.equal(hashWorld(replay(log, RULES)), hash);
  assert.ok(log.entries.length < log.ticks);

  // As a file would hold it.
  const stored: unknown = JSON.parse(JSON.stringify(log));
  const read = parseMatchLog(stored);
  assert.ok(read);
  assert.deepEqual(read, log);
  assert.equal(hashWorld(replay(read, RULES)), hash);

  // A shorter log is the same match stopped earlier, and one changed command is another match.
  const cut: MatchLog = { ...log, ticks: 60 };
  assert.equal(replay(cut, RULES).tick, 60);
  assert.notEqual(hashWorld(replay(cut, RULES)), hash);
  const altered: MatchLog = {
    ...log,
    entries: log.entries.map((entry) =>
      entry.tick === 1
        ? { ...entry, submissions: entry.submissions.slice(1) }
        : entry,
    ),
  };
  assert.notEqual(hashWorld(replay(altered, RULES)), hash);
  assert.notEqual(hashWorld(replay({ ...log, seed: 22 }, RULES)), hash);
});

test("a log is not replayed under other rules, past the tick limit or from a start the rules refuse", () => {
  const { log } = recorded();
  assert.throws(() => replay(log, { ...RULES, version: 4 }), {
    name: "RangeError",
    message: "the log was recorded under rules version 3, not 4",
  });
  assert.throws(() => replay(log, SHORT), {
    name: "RangeError",
    message: "the log is longer than a match can run",
  });
  assert.throws(() => replay({ ...log, seed: 0.5 }, RULES), {
    name: "RangeError",
    message: "the seed must be a whole number",
  });
  assert.throws(
    () => replay({ ...log, setup: { ...log.setup, neutrals: 13 } }, RULES),
    { name: "RangeError", message: "a match has 0 to 12 neutral planets" },
  );
  // Junk inside a log's commands is refused tick by tick, as it would have been live.
  const junk: MatchLog = {
    ...log,
    ticks: 2,
    entries: [
      {
        tick: 2,
        submissions: [
          { player: 0, command: "junk" },
          { player: 44, command: null },
        ],
      },
    ],
  };
  assert.deepEqual(
    replay(junk, RULES).events.map((event) => event.type),
    ["rejected", "rejected"],
  );
  assert.equal(
    hashWorld(replay({ ...log, ticks: 0, entries: [] }, RULES)),
    hashWorld(createWorld(21, SETUP_3V3, RULES)),
  );
});

test("what is not a match log is not read as one", () => {
  const good = {
    rulesVersion: 1,
    seed: 5,
    setup: { teams: 2, teamSize: 2, neutrals: 0 },
    ticks: 9,
    entries: [
      { tick: 2, submissions: [{ player: 0, command: { type: "x" } }] },
      { tick: 9, submissions: [] },
    ],
  };
  assert.deepEqual(parseMatchLog(good), good);
  assert.deepEqual(parseMatchLog({ ...good, entries: [], extra: true }), {
    ...good,
    entries: [],
  });
  const entry = (tick: unknown, submissions: unknown = []) => ({
    ...good,
    entries: [{ tick, submissions }],
  });
  const bad: readonly unknown[] = [
    undefined,
    null,
    "log",
    [],
    {},
    { ...good, rulesVersion: "1" },
    { ...good, seed: 1.5 },
    { ...good, seed: undefined },
    { ...good, setup: null },
    { ...good, setup: { teams: 2, teamSize: 2 } },
    { ...good, ticks: -1 },
    { ...good, ticks: "9" },
    { ...good, entries: {} },
    { ...good, entries: [null] },
    { ...good, entries: [[]] },
    entry(0),
    entry(10),
    entry(2.5),
    entry("2"),
    entry(2, "none"),
    entry(2, [null]),
    entry(2, [{ command: {} }]),
    entry(2, [{ player: "0", command: {} }]),
    // Out of order, or the same tick twice.
    { ...good, entries: [...good.entries].reverse() },
    { ...good, entries: [good.entries[0], good.entries[0]] },
  ];
  for (const value of bad)
    assert.equal(parseMatchLog(value), undefined, JSON.stringify(value));
});

test("a 2v2 starts with two teams of two facing each other and six neutral planets", () => {
  const world = start();
  assert.equal(world.tick, 0);
  assert.equal(world.phase, "running");
  assert.equal(world.result, null);
  assert.equal(world.rulesVersion, RULES.version);
  assert.equal(world.seed, 1);
  assert.equal(world.nextFleetId, 1);
  assert.deepEqual(world.fleets, []);
  assert.deepEqual(world.events, []);
  assert.deepEqual(
    world.knowledge,
    world.planets.map(() => ({ reports: [] })),
  );
  assert.deepEqual(
    world.planets
      .map(({ id, kind, team, x, y }) => [id, kind, team, x, y])
      .slice(0, 4),
    [
      [0, "seat", 0, 180, 410],
      [1, "seat", 1, 820, 410],
      [2, "seat", 0, 110, 560],
      [3, "seat", 1, 750, 560],
    ],
  );
  assert.deepEqual(world.teams, [
    {
      id: 0,
      members: [0, 2],
      fund: { metal: 0, crystal: 0, eonium: 0 },
      taxPercent: 0,
      commander: NONE,
      votes: [NONE, NONE],
      defencePriority: NONE,
    },
    {
      id: 1,
      members: [1, 3],
      fund: { metal: 0, crystal: 0, eonium: 0 },
      taxPercent: 0,
      commander: NONE,
      votes: [NONE, NONE],
      defencePriority: NONE,
    },
  ]);
  for (const seat of world.planets.slice(0, 4)) {
    assert.deepEqual(seat.resources, { metal: 800, crystal: 800, eonium: 400 });
    assert.deepEqual(seat.asteroids, { metal: 1, crystal: 1, eonium: 1 });
    assert.deepEqual(seat.ships, ships({ probe: 2 }));
    assert.equal(seat.score, 562);
    assert.equal(seat.value, 562);
  }
  // Each seat is as far from its opposite number as every other seat is from theirs.
  assert.equal(
    distance(world.planets[0]!, world.planets[1]!),
    distance(world.planets[2]!, world.planets[3]!),
  );
});

test("neutral planets are scattered by the seed, inside the map and apart from every other planet", () => {
  const { size, margin, minSeparation } = RULES.map;
  for (const seed of [1, 2, 3, 99, 2 ** 31, 2 ** 40 + 7]) {
    const world = start(seed, { teams: 2, teamSize: 3, neutrals: 12 });
    const neutrals = world.planets.slice(6);
    assert.equal(neutrals.length, 12);
    for (const planet of neutrals) {
      assert.equal(planet.kind, "neutral");
      assert.equal(planet.team, NONE);
      assert.ok(planet.x >= margin && planet.x <= size - margin);
      assert.ok(planet.y >= margin && planet.y <= size - margin);
      assert.deepEqual(planet.resources, RULES.neutral.resources);
      for (const resource of ["metal", "crystal", "eonium"] as const) {
        const extra =
          planet.asteroids[resource] - RULES.neutral.asteroids[resource];
        assert.ok(extra >= 0 && extra <= RULES.neutral.extraAsteroids);
      }
      for (const other of world.planets)
        if (other.id !== planet.id)
          assert.ok(
            distance(planet, other) >= minSeparation,
            `seed ${seed}: planets ${planet.id} and ${other.id}`,
          );
    }
    assert.deepEqual(start(seed, SETUP_3V3), start(seed, SETUP_3V3));
  }
  const spots = (seed: number) =>
    start(seed)
      .planets.slice(4)
      .map((planet) => `${planet.x},${planet.y}`)
      .join(" ");
  assert.notEqual(spots(1), spots(2));
  assert.equal(start(1).rng, start(1).rng);
  assert.notEqual(start(1).rng, start(2).rng);
});

test("a map too crowded for the separation still places every planet", () => {
  const crowded: Rules = {
    ...RULES,
    map: { ...RULES.map, minSeparation: 5000, placementAttempts: 3 },
  };
  const world = createWorld(1, SETUP_2V2, crowded);
  assert.equal(world.planets.length, 10);
  for (const planet of world.planets.slice(4))
    assert.ok(planet.x >= 60 && planet.x <= 940 && planet.y >= 60);
});

test("a match is two or three teams of up to three, six seats at most, with up to twelve neutral planets", () => {
  const three = start(1, { teams: 3, teamSize: 2, neutrals: 0 });
  assert.equal(three.planets.length, 6);
  assert.deepEqual(
    three.teams.map((team) => team.members),
    [
      [0, 3],
      [1, 4],
      [2, 5],
    ],
  );
  assert.deepEqual(
    three.planets.map((planet) => planet.team),
    [0, 1, 2, 0, 1, 2],
  );
  assert.equal(
    start(1, { teams: 2, teamSize: 1, neutrals: 0 }).planets.length,
    2,
  );
  assert.equal(start(1, SETUP_3V3).planets.length, 12);

  const problem = (setup: MatchSetup) => setupProblem(setup, RULES);
  assert.equal(problem(SETUP_2V2), undefined);
  assert.equal(problem(SETUP_3V3), undefined);
  assert.equal(problem({ teams: 3, teamSize: 2, neutrals: 12 }), undefined);
  for (const teams of [1, 4, 0, -2, 2.5, Number.NaN])
    assert.equal(
      problem({ teams, teamSize: 2, neutrals: 0 }),
      "a match has 2 to 3 teams",
    );
  for (const teamSize of [0, 4, -1, 1.5])
    assert.equal(
      problem({ teams: 2, teamSize, neutrals: 0 }),
      "a team has 1 to 3 seats",
    );
  assert.equal(
    problem({ teams: 3, teamSize: 3, neutrals: 0 }),
    "a match has at most 6 seats",
  );
  for (const neutrals of [13, -1, 0.5])
    assert.equal(
      problem({ teams: 2, teamSize: 2, neutrals }),
      "a match has 0 to 12 neutral planets",
    );
  assert.throws(() => start(1, { teams: 3, teamSize: 3, neutrals: 0 }), {
    name: "RangeError",
    message: "a match has at most 6 seats",
  });
  for (const seed of [0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60])
    assert.throws(() => start(seed), {
      name: "RangeError",
      message: "the seed must be a whole number",
    });
  assert.equal(start(0).seed, 0);
  assert.equal(start(-5).seed, -5);
});

test("a setup is read from untrusted data as three whole numbers", () => {
  assert.deepEqual(
    parseSetup({ teams: 2, teamSize: 3, neutrals: 6, host: "me" }),
    SETUP_3V3,
  );
  for (const value of [
    undefined,
    null,
    "2v2",
    [2, 2, 6],
    {},
    { teams: 2, teamSize: 2 },
    { teams: "2", teamSize: 2, neutrals: 6 },
    { teams: 2, teamSize: 2.5, neutrals: 6 },
    { teams: 2, teamSize: 2, neutrals: null },
  ])
    assert.equal(parseSetup(value), undefined);
  // Whether the numbers make a match is the rules' question, asked separately.
  assert.deepEqual(parseSetup({ teams: 40, teamSize: 0, neutrals: -3 }), {
    teams: 40,
    teamSize: 0,
    neutrals: -3,
  });
});

test("steps with no commands are idle ticks", () => {
  const env = createEnv({ rules: RULES });
  env.reset(1, SETUP_2V2);
  for (let step = 0; step < 5; step++) env.step(commands());
  assert.equal(hashWorld(env.world()), hashWorld(idle(start(), 5)));
});
