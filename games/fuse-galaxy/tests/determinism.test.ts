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
  deepFreeze,
  from,
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
        ships: { fighter: 1 },
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
  ...Array.from({ length: 60 }, () => []),
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
  assert.equal(first.planets[1]!.ships.fighter, 4);
  assert.equal(first.knowledge[1]!.reports.length, 1);
  assert.equal(first.nextFleetId, 3);
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
      start: "44e366d5a6d0a234",
      start3v3: "73f40a1eca7f3dcd",
      played: "903a0f9d1a363112",
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

test("a tick never changes the world it was given", () => {
  let world = deepFreeze(start(5));
  const before = hashWorld(world);
  const first = world;
  for (const submissions of SCRIPT)
    world = deepFreeze(applyTick(world, submissions, RULES));
  assert.equal(hashWorld(first), before);
  assert.equal(hashWorld(world), hashWorld(play(5)));
  assert.equal(first.tick, 0);
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
