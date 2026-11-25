import test from "node:test";
import assert from "node:assert/strict";
import {
  NONE,
  SETUP_2V2V2,
  detailOf,
  roughCount,
  warningTicks,
  type Formation,
  type IncomingFleet,
  type ResearchLevels,
  type World,
} from "../src/engine/index.js";
import {
  LINE,
  RULES,
  eventsOf,
  fleetOf,
  homeFleet,
  idle,
  raid,
  reportOf,
  ships,
  start,
  tick,
  viewFor,
  withFleets,
  withPlanet,
  withTeam,
} from "./support.js";

const researched = (
  world: World,
  id: number,
  levels: Partial<ResearchLevels>,
): World =>
  withPlanet(world, id, {
    research: { ...world.planets[id]!.research, ...levels },
  });

const WALL: Readonly<Formation> = RULES.combat.formations.wall!;

test("detail is the observer's sensors against the target's jamming, within the rules' ends", () => {
  assert.equal(detailOf(0, 0, RULES), RULES.intel.baseDetail);
  assert.equal(detailOf(1, 0, RULES), 2);
  assert.equal(detailOf(2, 0, RULES), 3);
  assert.equal(detailOf(5, 0, RULES), RULES.intel.maxDetail);
  assert.equal(detailOf(3, 2, RULES), 2);
  assert.equal(detailOf(0, 5, RULES), RULES.intel.minDetail);
  // A rough count is the largest step reached.
  assert.deepEqual(
    [0, 1, 2, 3, 9, 10, 299, 300, 20000].map((count) =>
      roughCount(count, RULES),
    ),
    [0, 1, 1, 3, 3, 10, 100, 300, 10000],
  );
});

/** An attack by planet 1 on planet 0, this many ticks from landing. */
const incoming = (world: World, eta: number): World =>
  withFleets(
    world,
    raid(1, 1, 0, { fighter: 23, pod: 4 }, { eta, formation: WALL }),
  );

const warnings = (world: World, player: number): readonly IncomingFleet[] =>
  viewFor(world, player).incoming;

test("an attack is seen coming once it is within the target's warning time, by the target and its teammates", () => {
  assert.equal(
    warningTicks(start().planets[0]!, start().planets[1]!, RULES),
    60,
  );
  const far = incoming(start(), 61);
  assert.deepEqual(warnings(far, 0), []);
  const near = incoming(start(), 60);
  const seen: IncomingFleet = {
    fleet: 1,
    owner: 1,
    target: 0,
    eta: 60,
    detail: 1,
    ships: null,
    formation: null,
  };
  assert.deepEqual(warnings(near, 0), [seen]);
  assert.deepEqual(warnings(near, 2), [seen]);
  // The attacker's side does not get a warning of its own attack, and nobody else hears of it.
  assert.deepEqual(warnings(near, 1), []);
  assert.deepEqual(warnings(near, 3), []);
  assert.deepEqual(warnings(near, 4), []);

  // Seen in play: a tick later it is a tick closer.
  assert.equal(warnings(tick(far), 0)[0]?.eta, 60);
  assert.equal(warnings(tick(near), 0)[0]?.eta, 59);
});

test("sensors see an attack earlier and in more detail; the attacker's jamming hides it until later", () => {
  const seenBy = (sensors: number, jamming: number, eta: number) =>
    warnings(
      incoming(
        researched(researched(start(), 0, { sensors }), 1, {
          jamming,
        }),
        eta,
      ),
      0,
    )[0];

  // Each sensors level is ten ticks earlier.
  assert.equal(seenBy(1, 0, 71), undefined);
  const rough = seenBy(1, 0, 70);
  assert.equal(rough?.detail, 2);
  assert.deepEqual(rough?.ships, ships({ fighter: 10, pod: 3 }));
  assert.equal(rough?.formation, null);

  const exact = seenBy(2, 0, 80);
  assert.equal(exact?.detail, 3);
  assert.deepEqual(exact?.ships, ships({ fighter: 23, pod: 4 }));
  assert.deepEqual(exact?.formation, WALL);

  // Each jamming level is eight ticks later, never later than the rules' least warning.
  assert.equal(seenBy(0, 1, 53), undefined);
  assert.equal(seenBy(0, 1, 52)?.eta, 52);
  assert.equal(seenBy(0, 5, 31), undefined);
  assert.equal(seenBy(0, 5, RULES.intel.minWarningTicks)?.detail, 1);
  // Jamming takes detail away as well as time.
  assert.equal(seenBy(2, 1, 50)?.detail, 2);
});

test("only attacks on their way are warned of: not one that has landed, turned back or is not an attack", () => {
  const world = withFleets(
    start(),
    raid(1, 1, 0, { fighter: 1 }, { eta: 10, phase: "returning" }),
    raid(2, 1, 2, { fighter: 1 }, { eta: 0, phase: "fighting" }),
    fleetOf(3, 1, 0, { eta: 5 }),
    raid(4, 3, 2, { fighter: 2 }, { eta: 7 }),
  );
  assert.deepEqual(
    warnings(world, 0).map((seen) => [seen.fleet, seen.target]),
    [[4, 2]],
  );
});

test("probes in orbit report every tick, and a planet that notices them shoots one down a tick", () => {
  const orbiting = (world: World): World =>
    withFleets(
      world,
      fleetOf(1, 0, 1, {
        mission: "orbit",
        ships: ships({ probe: 3 }),
        eta: 1,
      }),
    );
  // On arrival: a report, a notice to the target, and the probes stay.
  let world = tick(orbiting(start()));
  assert.deepEqual(eventsOf(world, "probed"), [
    { type: "probed", player: 1, by: 0 },
  ]);
  assert.equal(world.fleets[0]!.phase, "stationed");
  assert.equal(world.fleets[0]!.eta, RULES.intel.orbitTicks);
  assert.equal(world.knowledge[0]!.reports[0]!.tick, 1);
  // Then each tick one is shot down, and the rest report again.
  world = tick(world);
  assert.equal(world.fleets[0]!.ships.probe, 2);
  assert.equal(world.knowledge[0]!.reports[0]!.tick, 2);
  world = tick(world);
  assert.equal(world.fleets[0]!.ships.probe, 1);
  world = tick(world);
  assert.deepEqual(world.fleets, []);
  assert.deepEqual(eventsOf(world, "fleetLost"), [
    { type: "fleetLost", player: 0, fleet: 1 },
  ]);
  // The last report is the one made before the probes were lost.
  assert.equal(world.knowledge[0]!.reports[0]!.tick, 3);

  // Sensors past the target's jamming by the rules' margin are not noticed: the orbit lasts its time and goes home.
  let unseen = tick(orbiting(researched(start(), 0, { sensors: 1 })));
  assert.deepEqual(eventsOf(unseen, "probed"), []);
  unseen = idle(unseen, RULES.intel.orbitTicks - 1);
  assert.equal(unseen.fleets[0]!.ships.probe, 3);
  assert.equal(unseen.fleets[0]!.phase, "stationed");
  assert.equal(unseen.knowledge[0]!.reports[0]!.tick, RULES.intel.orbitTicks);
  unseen = tick(unseen);
  assert.equal(unseen.fleets[0]!.phase, "returning");
  // Jamming that matches the sensors brings the notice back.
  const jammed = tick(
    orbiting(
      researched(researched(start(), 0, { sensors: 1 }), 1, { jamming: 1 }),
    ),
  );
  assert.equal(eventsOf(jammed, "probed").length, 1);
});

test("an orbit reports the ships of the fleets defending the planet with its own", () => {
  let world = homeFleet(researched(start(), 0, { sensors: 2 }), 1, {
    corvette: 4,
  });
  world = withFleets(
    world,
    fleetOf(1, 0, 1, { mission: "orbit", ships: ships({ probe: 1 }), eta: 1 }),
    fleetOf(2, 3, 1, {
      mission: "defend",
      ships: ships({ corvette: 6 }),
      phase: "stationed",
      eta: 90,
    }),
  );
  assert.deepEqual(
    tick(world).knowledge[0]!.reports[0]!.ships,
    ships({ corvette: 10 }),
  );
});

/**
 * Two worlds that differ only in what team 1 keeps to itself: its stock as it is split between kinds, its queues,
 * which of its ships are at home and which are out, how it draws up and shelters, its votes and flag, what it knows,
 * how its fund is split, and the random stream. Each holds the same worth, so the public scores agree.
 */
function twoSecrets(): readonly [World, World] {
  const base = withFleets(start(), fleetOf(9, 0, 4, { eta: 30 }));
  let a = homeFleet(base, 1, { probe: 2, fighter: 10, corvette: 3 });
  let b = homeFleet(base, 1, { probe: 2, fighter: 4, corvette: 3 }, WALL);
  a = withPlanet(a, 1, {
    resources: { metal: 900, crystal: 700, eonium: 400 },
  });
  b = withPlanet(b, 1, {
    resources: { metal: 500, crystal: 1100, eonium: 400 },
    sheltered: true,
    construction: [{ structure: "shipyard", remaining: 40 }],
    researchQueue: [{ branch: "jamming", level: 1, remaining: 40 }],
    production: [{ shipClass: "fighter", count: 50, remaining: 40 }],
  });
  b = withFleets(
    b,
    raid(10, 1, 4, { fighter: 6 }, { eta: 200 }),
    fleetOf(11, 3, 5, { mission: "orbit", eta: 20 }),
  );
  a = withTeam(a, 1, { fund: { metal: 200, crystal: 0, eonium: 0 } });
  b = withTeam(b, 1, {
    fund: { metal: 0, crystal: 100, eonium: 100 },
    votes: [3, 3],
    commander: 3,
    defencePriority: 1,
  });
  b = {
    ...b,
    rng: b.rng + 1,
    knowledge: b.knowledge.map((known, id) =>
      id === 1 ? { reports: [reportOf(0, 0, 1, { detail: 3 })] } : known,
    ),
  };
  // The probe at home in `a` is in orbit in `b`.
  b = withPlanet(b, 3, { ships: ships({ probe: 1 }) });
  return [tick(a), tick(b)];
}

test("a view shows nothing of another team beyond its scores, the reports about it and the attacks it sends", () => {
  const [a, b] = twoSecrets();
  // Both worlds are public in the same way: the same scores, planet by planet.
  assert.deepEqual(
    a.planets.map((planet) => [planet.score, planet.parts]),
    b.planets.map((planet) => [planet.score, planet.parts]),
  );
  for (const player of [0, 2, 4, 5])
    assert.equal(
      JSON.stringify(viewFor(a, player)),
      JSON.stringify(viewFor(b, player)),
      `planet ${player}`,
    );
  // The difference is real: team 1 sees it.
  for (const player of [1, 3])
    assert.notEqual(
      JSON.stringify(viewFor(a, player)),
      JSON.stringify(viewFor(b, player)),
    );
});

test("a battle is seen by those in it and their teammates, and by nobody else", () => {
  // In a 2v2v2, team 1 (planets 1 and 4) attacks team 2 (planets 2 and 5); team 0 (planets 0 and 3) is not in it.
  let world = start(1, SETUP_2V2V2);
  world = homeFleet(world, 2, { corvette: 5 });
  world = withFleets(world, raid(1, 1, 2, { fighter: 30 }, { eta: 1 }));
  const fought = tick(world);
  assert.equal(fought.battles.length, 1);
  const battles = (player: number) => viewFor(fought, player).battles;
  for (const player of [1, 4, 2, 5]) {
    assert.equal(battles(player).length, 1, `planet ${player}`);
    assert.ok(eventsOf(fought, "battleRound").length === 1);
    assert.equal(
      viewFor(fought, player).events.filter(
        (event) => event.type === "battleRound",
      ).length,
      1,
    );
  }
  for (const player of [0, 3, 6]) {
    assert.deepEqual(battles(player), [], `planet ${player}`);
    assert.deepEqual(
      viewFor(fought, player).events.filter(
        (event) => event.type === "battleRound",
      ),
      [],
    );
  }
  // Those who see it see every side as it stands.
  assert.deepEqual(battles(4)[0], {
    planet: 2,
    round: 1,
    attackers: [
      {
        owner: 1,
        fleet: 1,
        ships: fought.fleets[0]!.ships,
        formation: LINE,
      },
    ],
    defenders: [
      {
        owner: 2,
        fleet: NONE,
        ships: fought.planets[2]!.ships,
        formation: LINE,
      },
    ],
  });
});

test("the newest report a team holds wins, and of two from one tick the one that shows more", () => {
  const world: World = {
    ...start(),
    knowledge: start().knowledge.map((known, id) =>
      id === 0
        ? { reports: [reportOf(1, 5, 0, { detail: 1 })] }
        : id === 2
          ? { reports: [reportOf(1, 5, 2, { detail: 2 })] }
          : known,
    ),
  };
  assert.equal(viewFor(world, 0).reports[0]!.by, 2);
  assert.equal(viewFor(world, 2).reports[0]!.by, 2);
});
