import test from "node:test";
import assert from "node:assert/strict";
import {
  NONE,
  commandProblem,
  contextOf,
  parseCommand,
  type Command,
  type Rules,
  type UntrustedSubmission,
} from "../src/engine/index.js";
import {
  RULES,
  viewFor,
  from,
  idle,
  reasons,
  refusal,
  rejections,
  rich,
  start,
  tick,
  withPlanet,
  withTeam,
} from "./support.js";

const VALID: readonly Command[] = [
  { type: "initiateAsteroid", resource: "crystal" },
  { type: "buildStructure", structure: "shipyard" },
  { type: "startResearch", branch: "jamming" },
  { type: "produceShips", shipClass: "frigate", count: 3 },
  {
    type: "launchFleet",
    mission: "observe",
    target: 4,
    ships: { fighter: 1, cruiser: 2 },
  },
  { type: "launchFleet", mission: "attack", target: 1, ships: {} },
  { type: "recallFleet", fleet: 7 },
  { type: "voteCommander", candidate: 2 },
  { type: "setTax", percent: 12 },
  { type: "grant", to: 2, resources: { metal: 5 } },
  { type: "setDefencePriority", planet: NONE },
  { type: "donate", resources: { metal: 1, crystal: 2, eonium: 3 } },
];

test("a well-formed command of every type is read as itself", () => {
  for (const command of VALID) {
    assert.deepEqual(parseCommand(command), { ok: true, command });
    // Through JSON too, as a command arrives from another machine.
    assert.deepEqual(parseCommand(JSON.parse(JSON.stringify(command))), {
      ok: true,
      command,
    });
  }
  assert.equal(new Set(VALID.map((command) => command.type)).size, 11);
});

test("fields a command does not have are dropped when it is read", () => {
  assert.deepEqual(
    parseCommand({
      type: "setTax",
      percent: 3,
      player: 2,
      __proto__: { admin: true },
    }),
    { ok: true, command: { type: "setTax", percent: 3 } },
  );
});

test("what is not a command is refused as malformed, without throwing", () => {
  for (const junk of [
    undefined,
    null,
    0,
    "initiateAsteroid",
    [],
    [{ type: "setTax", percent: 1 }],
    {},
    { type: 3 },
    { type: null },
    () => ({ type: "setTax" }),
  ])
    assert.deepEqual(parseCommand(junk), {
      ok: false,
      type: "malformed",
      reason: "the command is malformed",
    });
  for (const type of [
    "",
    "attack",
    "InitiateAsteroid",
    "__proto__",
    "toString",
  ])
    assert.deepEqual(parseCommand({ type }), {
      ok: false,
      type: "malformed",
      reason: "unknown command type",
    });
});

test("a command with a field missing or of the wrong kind names the field", () => {
  const cases: readonly (readonly [Record<string, unknown>, string])[] = [
    [{ type: "initiateAsteroid" }, "resource"],
    [{ type: "initiateAsteroid", resource: "gold" }, "resource"],
    [{ type: "initiateAsteroid", resource: 0 }, "resource"],
    [{ type: "buildStructure", structure: "deathStar" }, "structure"],
    [{ type: "startResearch", branch: ["mining"] }, "branch"],
    [{ type: "produceShips", shipClass: "titan", count: 1 }, "shipClass"],
    [{ type: "produceShips", shipClass: "fighter", count: "1" }, "count"],
    [{ type: "produceShips", shipClass: "fighter" }, "count"],
    [{ type: "launchFleet", mission: "raid", target: 1, ships: {} }, "mission"],
    [
      { type: "launchFleet", mission: "observe", target: "1", ships: {} },
      "target",
    ],
    [{ type: "launchFleet", mission: "observe", target: 1 }, "ships"],
    [
      { type: "launchFleet", mission: "observe", target: 1, ships: [1] },
      "ships",
    ],
    [
      {
        type: "launchFleet",
        mission: "observe",
        target: 1,
        ships: { titan: 1 },
      },
      "ships",
    ],
    [
      {
        type: "launchFleet",
        mission: "observe",
        target: 1,
        ships: { fighter: "1" },
      },
      "ships",
    ],
    [{ type: "recallFleet", fleet: null }, "fleet"],
    [{ type: "voteCommander" }, "candidate"],
    [{ type: "setTax", percent: "10" }, "percent"],
    [{ type: "grant", to: "2", resources: {} }, "to"],
    [{ type: "grant", to: 2, resources: null }, "resources"],
    [{ type: "grant", to: 2, resources: { gold: 1 } }, "resources"],
    [{ type: "setDefencePriority", planet: "none" }, "planet"],
    [{ type: "donate" }, "resources"],
    [{ type: "donate", resources: { metal: true } }, "resources"],
  ];
  for (const [command, field] of cases)
    assert.deepEqual(
      parseCommand(command),
      {
        ok: false,
        type: command.type,
        reason: `the command's ${field} is missing or malformed`,
      },
      JSON.stringify(command),
    );
});

test("a malformed command is refused in the tick and changes nothing", () => {
  const world = start();
  const junk: UntrustedSubmission[] = [
    { player: 0, command: null },
    { player: 0, command: { type: "teleport" } },
    { player: 0, command: { type: "setTax", percent: "all of it" } },
    { player: 1, command: "initiateAsteroid" },
  ];
  const after = tick(world, junk);
  assert.deepEqual(after.events, [
    {
      type: "rejected",
      player: 0,
      command: "malformed",
      reason: "the command is malformed",
    },
    {
      type: "rejected",
      player: 0,
      command: "malformed",
      reason: "unknown command type",
    },
    {
      type: "rejected",
      player: 0,
      command: "setTax",
      reason: "the command's percent is missing or malformed",
    },
    {
      type: "rejected",
      player: 1,
      command: "malformed",
      reason: "the command is malformed",
    },
  ]);
  assert.deepEqual(after.planets, tick(world).planets);
  assert.deepEqual(after.teams, world.teams);
});

test("commands sent as nobody are refused together, once", () => {
  const command = { type: "initiateAsteroid", resource: "metal" };
  const after = tick(start(), [
    { player: 10, command },
    { player: -1, command },
    { player: 1.5, command },
    { player: Number.NaN, command },
    { player: Number.POSITIVE_INFINITY, command: null },
    { player: 2 ** 60, command },
    ...from(3, { type: "initiateAsteroid", resource: "metal" }),
  ]);
  assert.deepEqual(after.events, [
    {
      type: "rejected",
      player: NONE,
      command: "initiateAsteroid",
      reason: "unknown player",
    },
    { type: "asteroidInitiated", player: 3, resource: "metal" },
  ]);
  assert.deepEqual(
    after.planets.map((planet) => planet.asteroids.metal),
    [1, 1, 1, 2, ...after.planets.slice(4).map((p) => p.asteroids.metal)],
  );
});

test("a player's commands past the tick's limit are refused together, once, and others' still apply", () => {
  const donate = { type: "donate", resources: { metal: 1 } } as const;
  const flood = Array.from({ length: 40 }, () => donate);
  const after = tick(start(), [...from(0, ...flood), ...from(2, donate)]);
  assert.equal(RULES.limits.commandsPerPlayerPerTick, 16);
  assert.deepEqual(rejections(after), [
    {
      type: "rejected",
      player: 0,
      command: "donate",
      reason: "too many commands in one tick",
    },
  ]);
  assert.equal(after.teams[0]!.fund.metal, 17);

  // A refused command counts towards the limit like any other.
  const tight: Rules = {
    ...RULES,
    limits: { ...RULES.limits, commandsPerPlayerPerTick: 2 },
  };
  const squeezed = tick(
    start(),
    [
      { player: 0, command: null },
      ...from(0, donate),
      { player: 0, command: "what is left is not even read" },
    ],
    tight,
  );
  assert.deepEqual(reasons(squeezed), [
    "the command is malformed",
    "too many commands in one tick",
  ]);
  assert.equal(rejections(squeezed)[1]!.command, "malformed");
  assert.equal(squeezed.teams[0]!.fund.metal, 1);
});

test("each command is checked against what the commands before it left", () => {
  const roid = { type: "initiateAsteroid", resource: "metal" } as const;
  // 800 metal buys the second, third and fourth metal asteroid (75 + 150 + 250) and not the fifth (375).
  const after = tick(start(), from(0, roid, roid, roid, roid));
  assert.deepEqual(reasons(after), ["not enough resources"]);
  assert.equal(after.planets[0]!.asteroids.metal, 4);
  assert.equal(after.planets[0]!.resources.metal, 800 - 475 + 10 + 16);

  // A vote makes the commander whose next command the same tick is then allowed.
  const led = tick(
    start(),
    from(
      1,
      { type: "setTax", percent: 5 },
      { type: "voteCommander", candidate: 1 },
      { type: "setTax", percent: 7 },
    ),
  );
  assert.deepEqual(reasons(led), ["only the team's commander can do that"]);
  assert.equal(led.teams[1]!.taxPercent, 7);
});

test("a refused command leaves the world as an idle tick would", () => {
  const world = start();
  const refused = tick(
    world,
    from(
      0,
      { type: "startResearch", branch: "mining" },
      { type: "produceShips", shipClass: "fighter", count: 1 },
      { type: "setTax", percent: 10 },
      { type: "recallFleet", fleet: 1 },
      { type: "launchFleet", mission: "observe", target: 1, ships: {} },
    ),
  );
  assert.deepEqual(reasons(refused), [
    "research needs a researchLab",
    "ship production needs a shipyard",
    "only the team's commander can do that",
    "unknown fleet",
    "a fleet needs at least one ship",
  ]);
  assert.deepEqual({ ...refused, events: [] }, tick(world));
});

test("an attack is refused on a seat far smaller than the attacker, and never on a neutral planet", () => {
  const armed = withPlanet(start(), 0, {
    ships: { ...start().planets[0]!.ships, fighter: 5 },
  });
  const attack = (target: number): Command => ({
    type: "launchFleet",
    mission: "attack",
    target,
    ships: { fighter: 5 },
  });
  assert.equal(RULES.capture.bashLimitPercent, 25);
  assert.equal(armed.planets[0]!.score, 562);
  // A quarter of 562 is 140.5: a seat scoring 141 can be attacked and one scoring 140 cannot.
  assert.equal(
    refusal(withPlanet(armed, 1, { score: 141 }), 0, attack(1)),
    undefined,
  );
  assert.equal(
    refusal(withPlanet(armed, 1, { score: 140 }), 0, attack(1)),
    "the target is too small for this planet to attack",
  );
  assert.equal(
    refusal(withPlanet(armed, 4, { score: 1 }), 0, attack(4)),
    undefined,
  );
  assert.equal(
    refusal(armed, 0, attack(2)),
    "a fleet cannot attack a teammate",
  );
});

test("the engine's check reads a view as it reads the world", () => {
  let world = withTeam(rich(start()), 0, {
    commander: 2,
    votes: [2, 2],
    fund: { metal: 40, crystal: 0, eonium: 0 },
  });
  world = withPlanet(world, 2, {
    ships: { ...world.planets[2]!.ships, corvette: 3 },
    structures: { ...world.planets[2]!.structures, shipyard: 1 },
  });
  const commands: readonly Command[] = [
    ...VALID,
    { type: "grant", to: 0, resources: { metal: 41 } },
    { type: "grant", to: 0, resources: { metal: 40 } },
    {
      type: "launchFleet",
      mission: "defend",
      target: 0,
      ships: { corvette: 3 },
    },
    {
      type: "launchFleet",
      mission: "defend",
      target: 1,
      ships: { corvette: 1 },
    },
    { type: "setTax", percent: 31 },
    { type: "produceShips", shipClass: "fighter", count: 2 },
  ];
  for (const player of [0, 2, 1, 4]) {
    const view = viewFor(world, player);
    for (const command of commands)
      assert.equal(
        commandProblem(contextOf(view), command, RULES),
        refusal(world, player, command),
        `${player}: ${JSON.stringify(command)}`,
      );
  }
  const ended = idle(start(), RULES.match.tickLimit);
  assert.equal(
    commandProblem(contextOf(viewFor(ended, 0)), VALID[0]!, RULES),
    "the match has ended",
  );
});
