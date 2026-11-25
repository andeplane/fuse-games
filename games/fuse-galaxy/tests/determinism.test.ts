import test from "node:test";
import assert from "node:assert/strict";
import {
  SETUP_3V3,
  applyTick,
  hashWorld,
  type UntrustedSubmission,
  type World,
} from "../src/engine/index.js";
import {
  RULES,
  from,
  frozen,
  idle,
  reasons,
  rich,
  start,
  tick,
} from "./support.js";

/** A short match with a bit of everything: asteroids, building, research, ships, fleets, team play and refusals. */
const SCRIPT: readonly (readonly UntrustedSubmission[])[] = [
  [
    ...from(
      0,
      { type: "initiateAsteroid", resource: "metal" },
      { type: "buildStructure", structure: "researchLab" },
      { type: "voteCommander", candidate: 0 },
    ),
    ...from(1, { type: "buildStructure", structure: "shipyard" }),
    ...from(2, { type: "voteCommander", candidate: 0 }),
    ...from(3, { type: "donate", resources: { metal: 100, eonium: 5 } }),
  ],
  [
    ...from(0, { type: "setTax", percent: 20 }),
    ...from(3, { type: "voteCommander", candidate: 3 }),
    ...from(4, { type: "initiateAsteroid", resource: "crystal" }),
    { player: 1, command: { type: "teleport" } },
  ],
  ...Array.from({ length: 50 }, () => []),
  [
    ...from(
      0,
      { type: "startResearch", branch: "sensors" },
      { type: "setDefencePriority", planet: 2 },
    ),
    ...from(1, { type: "produceShips", shipClass: "fighter", count: 4 }),
    ...from(3, { type: "grant", to: 1, resources: { metal: 50 } }),
  ],
  ...Array.from({ length: 30 }, () => []),
  [
    ...from(
      1,
      {
        type: "launchFleet",
        mission: "observe",
        target: 0,
        ships: { probe: 1 },
      },
      {
        type: "launchFleet",
        mission: "defend",
        target: 3,
        ships: { fighter: 2 },
      },
      {
        type: "launchFleet",
        mission: "attack",
        target: 0,
        ships: { fighter: 1 },
      },
    ),
  ],
  ...Array.from({ length: 20 }, () => []),
  from(1, { type: "recallFleet", fleet: 2 }),
  // Long enough for the attack to arrive and be fought out.
  ...Array.from({ length: 140 }, () => []),
];

const play = (seed: number): World =>
  SCRIPT.reduce<World>(
    (world, submissions) => applyTick(world, submissions, RULES),
    start(seed),
  );

test("the same seed and the same commands give the same world, hash for hash", () => {
  const first = play(11);
  const second = play(11);
  assert.notEqual(first, second);
  assert.deepEqual(second, first);
  assert.equal(hashWorld(second), hashWorld(first));
  assert.match(hashWorld(first), /^[0-9a-f]{16}$/);
  // The script did what it set out to do, so the hash covers every part of the state.
  assert.equal(first.tick, SCRIPT.length);
  assert.equal(first.planets[0]!.structures.researchLab, 1);
  assert.equal(first.planets[0]!.research.sensors, 1);
  assert.equal(first.teams[0]!.commander, 0);
  assert.equal(first.teams[0]!.taxPercent, 20);
  assert.equal(first.teams[1]!.commander, 3);
  assert.equal(first.knowledge[1]!.reports.length, 1);
  assert.equal(first.nextFleetId, 4);
  // The defending fleet was recalled and is home; the attack found nobody to fight and is on its way back.
  assert.equal(first.planets[1]!.ships.fighter, 3);
  assert.deepEqual(
    first.fleets.map(({ id, mission, phase }) => [id, mission, phase]),
    [[3, "attack", "returning"]],
  );
  assert.deepEqual(first.battles, []);
});

test("a different seed gives a different world, and so does one different command", () => {
  assert.notEqual(hashWorld(play(12)), hashWorld(play(11)));
  assert.notEqual(hashWorld(start(1)), hashWorld(start(2)));
  assert.equal(hashWorld(start(2)), hashWorld(start(2)));

  const base = idle(start(), 3);
  const changed = idle(
    tick(start(), from(2, { type: "donate", resources: { eonium: 1 } })),
    2,
  );
  assert.notEqual(hashWorld(changed), hashWorld(base));
});

test("a recorded match hashes to its pinned value", () => {
  // Changing this on purpose means the rules changed: bump `Rules.version` in the same change.
  assert.deepEqual(
    {
      start: hashWorld(start(1)),
      start3v3: hashWorld(start(1, SETUP_3V3)),
      played: hashWorld(play(11)),
    },
    {
      start: "e9e17e89d0849452",
      start3v3: "7c4266e0eb2b03ef",
      played: "1fb6c200a89308cf",
    },
  );
});

test("the order players' commands arrive in does not matter, only each player's own order", () => {
  const world = rich(start());
  const zero = from(
    0,
    { type: "voteCommander", candidate: 2 },
    { type: "initiateAsteroid", resource: "metal" },
  );
  const two = from(
    2,
    { type: "voteCommander", candidate: 2 },
    { type: "setTax", percent: 5 },
    { type: "donate", resources: { crystal: 9 } },
  );
  const five = from(5, { type: "buildStructure", structure: "shipyard" });
  const sorted = tick(world, [...zero, ...two, ...five]);
  const shuffled = tick(world, [
    five[0]!,
    two[0]!,
    zero[0]!,
    two[1]!,
    zero[1]!,
    two[2]!,
  ]);
  assert.deepEqual(reasons(sorted), []);
  assert.equal(sorted.teams[0]!.taxPercent, 5);
  assert.equal(hashWorld(shuffled), hashWorld(sorted));

  // Within one player the order sent is the order applied: the tax is set before the vote that would allow it.
  const tooEarly = tick(world, [two[1]!, two[0]!]);
  assert.deepEqual(reasons(tooEarly), [
    "only the team's commander can do that",
  ]);
});

test("a world is frozen all the way down, from the first to the last, so a tick cannot change the one it was given", () => {
  let world = start(5);
  const first = world;
  const before = hashWorld(first);
  assert.ok(frozen(first));
  for (const submissions of SCRIPT) {
    world = applyTick(world, submissions, RULES);
    assert.ok(frozen(world), `tick ${world.tick}`);
  }
  assert.ok(world.fleets.length + world.knowledge[1]!.reports.length > 0);
  assert.equal(hashWorld(first), before);
  assert.equal(hashWorld(world), hashWorld(play(5)));
  assert.equal(first.tick, 0);
});

test("a world built by hand is played like any other, and what comes back is frozen", () => {
  const thawed: World = JSON.parse(JSON.stringify(play(5))) as World;
  assert.ok(!Object.isFrozen(thawed));
  const next = applyTick(thawed, [], RULES);
  assert.ok(frozen(next));
  assert.equal(hashWorld(next), hashWorld(applyTick(play(5), [], RULES)));
});

/**
 * A log is replayed after a trip through JSON, which turns NaN and the infinities into null, negative zero into zero
 * and drops what is undefined. The engine reads a command the way JSON would leave it, so the trip changes nothing.
 */
test("commands that JSON cannot carry are read as JSON would leave them, so a saved log replays hash for hash", () => {
  const odd: readonly (readonly unknown[])[] = [
    [
      { player: 0, command: { type: "voteCommander", candidate: -0 } },
      { player: 2, command: { type: "voteCommander", candidate: 0 } },
      {
        player: 1,
        command: { type: "produceShips", shipClass: "fighter", count: NaN },
      },
      {
        player: 3,
        command: {
          type: "donate",
          resources: { metal: 5, crystal: undefined, eonium: -0 },
        },
      },
    ],
    [
      { player: 0, command: { type: "setTax", percent: -0 } },
      { player: 0, command: { type: "setTax", percent: Infinity } },
      { player: 0, command: { type: "setDefencePriority", planet: -0 } },
      {
        player: 1,
        command: { type: "donate", resources: { metal: -Infinity } },
      },
      {
        player: 3,
        command: {
          type: "launchFleet",
          mission: "observe",
          target: NaN,
          ships: { fighter: undefined },
        },
      },
      { player: 2, command: { type: "recallFleet", fleet: undefined } },
      { player: -0, command: { type: "initiateAsteroid", resource: "metal" } },
    ],
  ];
  const stored: unknown = JSON.parse(JSON.stringify(odd));
  assert.ok(Array.isArray(stored));
  const run = (script: readonly (readonly unknown[])[]): World[] => {
    const worlds: World[] = [];
    let world = start(8);
    for (const submissions of script)
      worlds.push((world = applyTick(world, submissions, RULES)));
    return worlds;
  };
  const live = run(odd);
  const replayed = run(stored);
  assert.deepEqual(live.map(hashWorld), replayed.map(hashWorld));
  assert.deepEqual(
    live.map((world) => world.events),
    replayed.map((world) => world.events),
  );
  // What the odd numbers were read as: a zero where one was meant, a refusal where nothing was.
  const last = live[1]!;
  assert.equal(last.teams[0]!.commander, 0);
  assert.equal(last.planets[0]!.asteroids.metal, 2);
  assert.ok(Object.is(last.teams[0]!.taxPercent, 0));
  assert.ok(Object.is(last.teams[0]!.defencePriority, 0));
  assert.ok(last.teams[0]!.votes.every((vote) => Object.is(vote, 0)));
  assert.equal(live[0]!.teams[1]!.fund.metal, 5);
  assert.deepEqual(reasons(live[0]!), [
    "the command's count is missing or malformed",
  ]);
  assert.deepEqual(reasons(last), [
    "the command's percent is missing or malformed",
    "the command's resources is missing or malformed",
    "the command's fleet is missing or malformed",
    "the command's target is missing or malformed",
  ]);
  const zeros: number[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "number" && Object.is(value, -0)) zeros.push(value);
    else if (typeof value === "object" && value !== null)
      Object.values(value).forEach(collect);
  };
  live.forEach(collect);
  assert.deepEqual(zeros, []);
});

test("what is not a submission at all is refused as sent by nobody, and the tick still runs", () => {
  const junk: readonly unknown[] = [
    null,
    undefined,
    7,
    "donate",
    [],
    [{ player: 0, command: { type: "donate", resources: { metal: 1 } } }],
    {},
    { command: { type: "donate", resources: { metal: 1 } } },
    { player: "0", command: { type: "donate", resources: { metal: 1 } } },
    { player: 0, command: { type: "donate", resources: { metal: 1 } } },
  ];
  const after = applyTick(start(), junk, RULES);
  assert.equal(after.tick, 1);
  assert.deepEqual(after.events, [
    {
      type: "rejected",
      player: -1,
      command: "malformed",
      reason: "unknown player",
    },
  ]);
  // The one real submission among them was carried out.
  assert.equal(after.teams[0]!.fund.metal, 1);
});

test("the hash reads what a world holds, not the order it was built in", () => {
  const world = play(11);
  // The same content with keys in another order, as a world read back from storage might have them.
  const { tick: ticks, planets, ...others } = world;
  const rebuilt: World = {
    ...others,
    planets: planets.map(({ id, resources, ...rest }) => ({
      ...rest,
      resources: {
        eonium: resources.eonium,
        crystal: resources.crystal,
        metal: resources.metal,
      },
      id,
    })),
    tick: ticks,
  };
  assert.notEqual(JSON.stringify(rebuilt), JSON.stringify(world));
  assert.deepEqual(rebuilt, world);
  assert.equal(hashWorld(rebuilt), hashWorld(world));
});

test("worlds are whole numbers all the way down, so they survive JSON unchanged", () => {
  const world = play(11);
  const numbers: number[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "number") numbers.push(value);
    else if (typeof value === "object" && value !== null)
      Object.values(value).forEach(collect);
  };
  collect(world);
  assert.ok(numbers.length > 200);
  assert.ok(numbers.every((value) => Number.isSafeInteger(value)));
  assert.deepEqual(JSON.parse(JSON.stringify(world)), world);
});
