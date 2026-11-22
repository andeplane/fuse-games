import test from "node:test";
import assert from "node:assert/strict";
import {
  distance,
  travelTicks,
  type Command,
  type ShipCounts,
  type World,
} from "../src/engine/index.js";
import {
  RULES,
  eventsOf,
  from,
  idle,
  reasons,
  refusal,
  start,
  tick,
  withPlanet,
} from "./support.js";

/** The world with these ships at home on one planet. */
const armed = (world: World, id: number, ships: Partial<ShipCounts>): World =>
  withPlanet(world, id, { ships: { ...world.planets[id]!.ships, ...ships } });

const send = (
  mission: "defend" | "observe",
  target: number,
  ships: Partial<ShipCounts>,
): Command => ({ type: "launchFleet", mission, target, ships });

/** A player's reports, read afresh: an assertion on them does not narrow what a later one sees. */
const reportsOf = (world: World, id: number) => world.knowledge[id]!.reports;

// In a 2v2 seat 0 is at (180, 410), its teammate seat 2 at (110, 560) and its opponent seat 1 at (820, 410).
const TO_ENEMY = 37;
const TO_ALLY = 17;

test("distance is the straight line rounded down, and a fleet flies at its slowest ship's speed", () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(distance({ x: 7, y: 7 }, { x: 7, y: 7 }), 0);
  assert.equal(distance({ x: 10, y: 0 }, { x: 0, y: 10 }), 14);
  const world = start();
  assert.equal(distance(world.planets[0]!, world.planets[1]!), 640);
  assert.equal(distance(world.planets[0]!, world.planets[2]!), 165);

  const a = { x: 0, y: 0 };
  const b = { x: 300, y: 400 };
  // Ten ticks to launch, then 500 of distance at 24 a tick, rounded up.
  assert.equal(travelTicks(a, b, { fighter: 1 }, 0, RULES), 31);
  assert.equal(travelTicks(a, b, { fighter: 900 }, 0, RULES), 31);
  assert.equal(travelTicks(a, b, { fighter: 9, battleship: 1 }, 0, RULES), 73);
  assert.equal(travelTicks(a, b, { battleship: 1, fighter: 0 }, 0, RULES), 73);
  // Each travel level is a tenth faster.
  assert.equal(travelTicks(a, b, { fighter: 1 }, 5, RULES), 24);
  assert.equal(travelTicks(a, a, { fighter: 1 }, 0, RULES), 10);
  assert.equal(travelTicks(a, b, {}, 0, RULES), 510);
});

test("an observing fleet flies out, reports what it sees on arrival and flies home", () => {
  let world = tick(
    armed(start(), 0, { fighter: 3 }),
    from(0, send("observe", 1, { fighter: 1 })),
  );
  assert.equal(world.planets[0]!.ships.fighter, 2);
  assert.deepEqual(world.fleets, [
    {
      id: 1,
      owner: 0,
      mission: "observe",
      target: 1,
      ships: { ...start().planets[0]!.ships, fighter: 1 },
      phase: "outbound",
      eta: TO_ENEMY - 1,
      travelTicks: TO_ENEMY,
    },
  ]);
  assert.equal(world.nextFleetId, 2);

  world = idle(world, TO_ENEMY - 2);
  assert.deepEqual(world.knowledge[0]!.reports, []);
  assert.equal(world.fleets[0]!.eta, 1);
  world = tick(world);
  assert.equal(world.tick, TO_ENEMY);
  assert.deepEqual(eventsOf(world, "fleetArrived"), [
    {
      type: "fleetArrived",
      player: 0,
      fleet: 1,
      target: 1,
      mission: "observe",
    },
  ]);
  assert.deepEqual(world.knowledge[0]!.reports, [
    {
      target: 1,
      tick: TO_ENEMY,
      by: 0,
      detail: 1,
      resources: world.planets[1]!.resources,
      asteroids: world.planets[1]!.asteroids,
      structures: null,
      research: null,
      ships: null,
    },
  ]);
  assert.equal(world.fleets[0]!.phase, "returning");
  assert.equal(world.fleets[0]!.eta, TO_ENEMY);

  world = idle(world, TO_ENEMY - 1);
  assert.equal(world.fleets.length, 1);
  assert.equal(world.planets[0]!.ships.fighter, 2);
  world = tick(world);
  assert.deepEqual(world.fleets, []);
  assert.equal(world.planets[0]!.ships.fighter, 3);
  assert.deepEqual(eventsOf(world, "fleetReturned"), [
    { type: "fleetReturned", player: 0, fleet: 1 },
  ]);
  // The report stays, dated, and does not follow what the planet does afterwards.
  const [report] = reportsOf(world, 0);
  assert.equal(report?.tick, TO_ENEMY);
  assert.notDeepEqual(report?.resources, world.planets[1]!.resources);
});

test("how much a report shows depends on the observer's sensors and the target's jamming", () => {
  const observed = (sensors: number, jamming: number) => {
    let world = armed(start(), 0, { fighter: 1 });
    world = withPlanet(world, 0, {
      research: { ...world.planets[0]!.research, sensors },
    });
    world = withPlanet(armed(world, 1, { frigate: 4 }), 1, {
      research: { ...world.planets[1]!.research, jamming },
      structures: { ...world.planets[1]!.structures, shipyard: 2 },
    });
    world = idle(
      tick(world, from(0, send("observe", 1, { fighter: 1 }))),
      TO_ENEMY - 1,
    );
    return {
      report: world.knowledge[0]!.reports[0]!,
      target: world.planets[1]!,
    };
  };

  const plain = observed(0, 0);
  assert.equal(plain.report.detail, 1);
  assert.deepEqual(plain.report.asteroids, plain.target.asteroids);
  assert.equal(plain.report.structures, null);
  assert.equal(plain.report.research, null);
  assert.equal(plain.report.ships, null);

  const better = observed(1, 0);
  assert.equal(better.report.detail, 2);
  assert.deepEqual(better.report.structures, better.target.structures);
  assert.deepEqual(better.report.research, better.target.research);
  assert.equal(better.report.ships, null);

  const best = observed(2, 0);
  assert.equal(best.report.detail, 3);
  assert.deepEqual(best.report.ships, best.target.ships);
  assert.equal(best.report.ships?.frigate, 4);

  // Jamming takes detail away again, and neither goes past the ends of the scale.
  assert.equal(observed(5, 3).report.detail, 3);
  assert.equal(observed(5, 4).report.detail, 2);
  assert.equal(observed(5, 5).report.detail, 1);
  assert.equal(observed(0, 5).report.detail, 1);
  assert.equal(observed(5, 0).report.detail, 3);
});

test("a new report on a planet replaces the old one, and reports are kept by target", () => {
  let world = tick(
    armed(start(), 0, { fighter: 3 }),
    from(
      0,
      send("observe", 3, { fighter: 1 }),
      send("observe", 1, { fighter: 1 }),
    ),
  );
  world = idle(world, 60);
  assert.deepEqual(
    world.knowledge[0]!.reports.map((report) => report.target),
    [1, 3],
  );
  const first = world.knowledge[0]!.reports[0]!;
  world = idle(
    tick(world, from(0, send("observe", 1, { fighter: 1 }))),
    TO_ENEMY,
  );
  assert.deepEqual(
    world.knowledge[0]!.reports.map((report) => report.target),
    [1, 3],
  );
  // Launched on tick 62, so it arrived on tick 98.
  assert.equal(world.knowledge[0]!.reports[0]!.tick, 61 + TO_ENEMY);
  assert.ok(world.knowledge[0]!.reports[0]!.tick > first.tick);
  // Nobody else learned anything.
  assert.deepEqual(world.knowledge[2]!.reports, []);
  assert.deepEqual(world.knowledge[1]!.reports, []);
});

test("a defending fleet stays at its teammate's planet for its watch, then flies home", () => {
  let world = tick(
    armed(start(), 0, { fighter: 4, corvette: 2 }),
    from(0, send("defend", 2, { fighter: 4, corvette: 1 })),
  );
  // Corvettes are slower than fighters: 165 of distance at 20 a tick.
  const out = 10 + 9;
  assert.equal(world.fleets[0]!.travelTicks, out);
  world = idle(world, out - 1);
  assert.deepEqual(eventsOf(world, "fleetArrived"), [
    { type: "fleetArrived", player: 0, fleet: 1, target: 2, mission: "defend" },
  ]);
  assert.equal(world.fleets[0]!.phase, "stationed");
  assert.equal(world.fleets[0]!.eta, RULES.fleet.defendTicks);
  assert.deepEqual(world.knowledge[0]!.reports, []);

  world = idle(world, RULES.fleet.defendTicks - 1);
  assert.equal(world.fleets[0]!.phase, "stationed");
  world = tick(world);
  assert.equal(world.fleets[0]!.phase, "returning");
  assert.equal(world.fleets[0]!.eta, out);
  world = idle(world, out);
  assert.deepEqual(world.fleets, []);
  assert.equal(world.tick, out + RULES.fleet.defendTicks + out);
  assert.deepEqual(world.planets[0]!.ships, {
    ...start().planets[0]!.ships,
    fighter: 4,
    corvette: 2,
  });
  // The ships were the sender's all along: the teammate never held them.
  assert.equal(world.planets[2]!.ships.fighter, 0);
});

test("ships in a fleet still count towards their owner's value", () => {
  const home = tick(armed(start(), 0, { fighter: 10 }));
  const away = tick(
    armed(start(), 0, { fighter: 10 }),
    from(0, send("observe", 1, { fighter: 10 })),
  );
  assert.equal(away.planets[0]!.ships.fighter, 0);
  assert.equal(away.planets[0]!.value, home.planets[0]!.value);
  assert.equal(
    home.planets[0]!.value - tick(start()).planets[0]!.value,
    10 * RULES.ships.fighter.value,
  );
});

test("a recalled fleet flies back as far as it had come", () => {
  const launched = tick(
    armed(start(), 0, { fighter: 2 }),
    from(0, send("observe", 1, { fighter: 2 })),
  );
  // Five ticks out, recalled on the sixth: home five ticks after it turned.
  let world = tick(
    idle(launched, 4),
    from(0, { type: "recallFleet", fleet: 1 }),
  );
  assert.equal(world.tick, 6);
  assert.equal(world.fleets[0]!.phase, "returning");
  assert.equal(world.fleets[0]!.eta, 4);
  world = idle(world, 3);
  assert.equal(world.fleets.length, 1);
  world = tick(world);
  assert.deepEqual(world.fleets, []);
  assert.equal(world.planets[0]!.ships.fighter, 2);
  // It never arrived, so it saw nothing.
  assert.deepEqual(world.knowledge[0]!.reports, []);

  // Launched and recalled in one tick, it is home at once.
  const atOnce = tick(
    armed(start(), 0, { fighter: 2 }),
    from(0, send("observe", 1, { fighter: 2 }), {
      type: "recallFleet",
      fleet: 1,
    }),
  );
  assert.deepEqual(reasons(atOnce), []);
  assert.deepEqual(atOnce.fleets, []);
  assert.equal(atOnce.planets[0]!.ships.fighter, 2);
  assert.deepEqual(eventsOf(atOnce, "fleetReturned"), [
    { type: "fleetReturned", player: 0, fleet: 1 },
  ]);
});

test("a stationed fleet can be recalled early; a returning one, or someone else's, cannot", () => {
  let world = tick(
    armed(armed(start(), 0, { fighter: 1 }), 2, { fighter: 1 }),
    [
      ...from(0, send("defend", 2, { fighter: 1 })),
      ...from(2, send("defend", 0, { fighter: 1 })),
    ],
  );
  world = idle(world, TO_ALLY + 20);
  assert.equal(world.fleets[0]!.phase, "stationed");
  // A teammate's fleet is not yours to recall, and nor is a fleet that does not exist.
  for (const fleet of [2, 3, 0, -1, 1.5])
    assert.equal(
      refusal(world, 0, { type: "recallFleet", fleet }),
      "unknown fleet",
    );
  assert.equal(
    refusal(world, 1, { type: "recallFleet", fleet: 1 }),
    "unknown fleet",
  );

  world = tick(world, from(0, { type: "recallFleet", fleet: 1 }));
  assert.deepEqual(reasons(world), []);
  assert.equal(world.fleets[0]!.phase, "returning");
  assert.equal(world.fleets[0]!.eta, TO_ALLY - 1);
  assert.equal(
    refusal(world, 0, { type: "recallFleet", fleet: 1 }),
    "the fleet is already on its way home",
  );
  world = idle(world, TO_ALLY - 1);
  assert.equal(world.planets[0]!.ships.fighter, 1);
  assert.deepEqual(
    world.fleets.map((fleet) => fleet.id),
    [2],
  );
});

test("a fleet is refused when its target, mission or ships are wrong", () => {
  const world = armed(start(), 0, { fighter: 3, cruiser: 1 });
  const cases: readonly (readonly [Command, string | undefined])[] = [
    [send("observe", 1, { fighter: 1 }), undefined],
    [send("observe", 4, { fighter: 3, cruiser: 1 }), undefined],
    [send("defend", 2, { cruiser: 1 }), undefined],
    [send("observe", 10, { fighter: 1 }), "unknown target planet"],
    [send("observe", -1, { fighter: 1 }), "unknown target planet"],
    [send("observe", 1.5, { fighter: 1 }), "unknown target planet"],
    [
      send("observe", Number.NaN, { fighter: 1 }),
      "the command's target is missing or malformed",
    ],
    [
      send("observe", 0, { fighter: 1 }),
      "a fleet cannot target its own planet",
    ],
    [send("defend", 0, { fighter: 1 }), "a fleet cannot target its own planet"],
    [send("defend", 1, { fighter: 1 }), "a fleet can only defend a teammate"],
    [send("defend", 4, { fighter: 1 }), "a fleet can only defend a teammate"],
    [
      send("observe", 2, { fighter: 1 }),
      "there is nothing to observe on a teammate's planet",
    ],
    [
      send("observe", 1, { fighter: -1 }),
      "ship counts must be whole numbers of 0 or more",
    ],
    [
      send("observe", 1, { fighter: 0.5 }),
      "ship counts must be whole numbers of 0 or more",
    ],
    [
      send("observe", 1, { fighter: Number.POSITIVE_INFINITY }),
      "the command's ships is missing or malformed",
    ],
    [send("observe", 1, { fighter: 4 }), "not enough ships at home"],
    [send("observe", 1, { corvette: 1 }), "not enough ships at home"],
    [send("observe", 1, {}), "a fleet needs at least one ship"],
    [send("observe", 1, { fighter: 0 }), "a fleet needs at least one ship"],
  ];
  for (const [command, reason] of cases)
    assert.equal(refusal(world, 0, command), reason, JSON.stringify(command));

  // A neutral planet has no teammates: it may observe anyone and defend no one.
  const neutral = armed(start(), 4, { fighter: 1 });
  assert.equal(
    refusal(neutral, 4, send("observe", 0, { fighter: 1 })),
    undefined,
  );
  assert.equal(
    refusal(neutral, 4, send("observe", 5, { fighter: 1 })),
    undefined,
  );
  assert.equal(
    refusal(neutral, 4, send("defend", 5, { fighter: 1 })),
    "a fleet can only defend a teammate",
  );
});

test("a planet has only so many fleets out at once, and fleet numbers are never used twice", () => {
  const one = send("observe", 1, { fighter: 1 });
  let world = tick(
    armed(start(), 0, { fighter: 9 }),
    from(0, one, one, one, one),
  );
  assert.equal(RULES.fleet.maxFleets, 3);
  assert.deepEqual(reasons(world), [
    "the planet already has the most fleets it can send",
  ]);
  assert.deepEqual(
    world.fleets.map((fleet) => fleet.id),
    [1, 2, 3],
  );
  assert.equal(world.planets[0]!.ships.fighter, 6);
  // Someone else's fleets do not count against it.
  assert.equal(
    refusal(
      armed(world, 2, { fighter: 1 }),
      2,
      send("defend", 0, { fighter: 1 }),
    ),
    undefined,
  );

  world = tick(world, from(0, { type: "recallFleet", fleet: 2 }));
  assert.deepEqual(
    world.fleets.map((fleet) => fleet.id),
    [1, 3],
  );
  world = tick(world, from(0, one));
  assert.deepEqual(
    world.fleets.map((fleet) => fleet.id),
    [1, 3, 4],
  );
  assert.equal(world.nextFleetId, 5);
});
