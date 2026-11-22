import test from "node:test";
import assert from "node:assert/strict";
import {
  NONE,
  RESOURCE_IDS,
  SHIP_CLASSES,
  captureCap,
  createEnv,
  fightRound,
  hashWorld,
  income,
  noResources,
  noShips,
  parseMatchLog,
  replay,
  shipsValue,
  taxOn,
  type Command,
  type DeepReadonly,
  type Force,
  type Formation,
  type GameEvent,
  type Resources,
  type Rules,
  type ShipCounts,
  type World,
} from "../src/engine/index.js";
import {
  LINE,
  RULES,
  eventsOf,
  fleetOf,
  frozen,
  from,
  homeFleet,
  raid,
  reasons,
  ships,
  start,
  tick,
  viewFor,
  withFleets,
  withPlanet,
} from "./support.js";

/** The cells of the battle grid by name: the line, then the column. */
const CELL = {
  frontLeft: 0,
  frontCentre: 1,
  frontRight: 2,
  middleLeft: 3,
  middleCentre: 4,
  middleRight: 5,
  rearLeft: 6,
  rearCentre: 7,
  rearRight: 8,
} as const;

/** A force for `fightRound`: these ships, standing where `cells` says and elsewhere as in the line formation. */
const force = (
  counts: Partial<ShipCounts>,
  cells: Partial<Formation> = {},
  owner = 0,
  fleet = 1,
): Force => ({
  owner,
  fleet,
  formation: { ...LINE, ...cells },
  ships: ships(counts),
  damage: noShips(),
});

/** Whether any of these forces still has a ship that fights. */
const standing = (forces: readonly Force[]): boolean =>
  forces.some((one) =>
    SHIP_CLASSES.some(
      (shipClass) => one.ships[shipClass] > 0 && !RULES.ships[shipClass].probe,
    ),
  );

/** A whole battle between two forces through `fightRound`, as many rounds as the rules allow. Returns the rounds. */
function fightOut(attacker: Force, defender: Force, rules: Rules = RULES) {
  let rounds = 0;
  while (
    rounds < rules.combat.rounds &&
    standing([attacker]) &&
    standing([defender])
  ) {
    fightRound([attacker], [defender], rules);
    rounds += 1;
  }
  return rounds;
}

/** What a set of ships cost to build. */
const costOf = (counts: Readonly<ShipCounts>): Resources => {
  const cost = noResources();
  for (const shipClass of SHIP_CLASSES)
    for (const resource of RESOURCE_IDS)
      cost[resource] +=
        counts[shipClass] * RULES.ships[shipClass].cost[resource];
  return cost;
};

const add = (a: Readonly<Resources>, b: Readonly<Resources>): Resources => ({
  metal: a.metal + b.metal,
  crystal: a.crystal + b.crystal,
  eonium: a.eonium + b.eonium,
});

const share = (stock: Readonly<Resources>, percent: number): Resources => ({
  metal: Math.floor((stock.metal * percent) / 100),
  crystal: Math.floor((stock.crystal * percent) / 100),
  eonium: Math.floor((stock.eonium * percent) / 100),
});

type Round = Extract<DeepReadonly<GameEvent>, { type: "battleRound" }>;
type Ended = Extract<DeepReadonly<GameEvent>, { type: "battleEnded" }>;

const onlyRound = (world: World): Round => {
  const rounds = eventsOf(world, "battleRound");
  assert.equal(rounds.length, 1);
  return rounds[0]!;
};

const onlyEnd = (world: World): Ended => {
  const ends = eventsOf(world, "battleEnded");
  assert.equal(ends.length, 1);
  return ends[0]!;
};

const fleetIn = (world: World, id: number) =>
  world.fleets.find((one) => one.id === id);

// ---------------------------------------------------------------------------------------------------------------
// The formation rule, one round at a time.

test("a short gun cannot reach past the enemy's front line: what stands behind it is screened", () => {
  // A fighter (range 1) faces a corvette in the front of its column with a pod behind it. Fighters prefer pods to
  // corvettes, so a hit on the corvette means the pod could not be reached.
  const attacker = force({ fighter: 1 }, { fighter: CELL.frontLeft });
  const defender = force(
    { corvette: 1, pod: 1 },
    { corvette: CELL.frontLeft, pod: CELL.middleLeft },
  );
  fightRound([attacker], [defender], RULES);
  assert.equal(defender.damage.corvette, RULES.ships.fighter.attack);
  assert.equal(defender.damage.pod, 0);
  assert.equal(defender.ships.pod, 1);
});

test("an empty front line leaves what is behind it in the front", () => {
  // The same pod with nothing in front of it in its column: depth 0, so the fighter reaches it first.
  const attacker = force({ fighter: 1 }, { fighter: CELL.frontLeft });
  const defender = force(
    { corvette: 1, pod: 1 },
    { corvette: CELL.frontCentre, pod: CELL.middleLeft },
  );
  fightRound([attacker], [defender], RULES);
  assert.equal(defender.damage.pod, RULES.ships.fighter.attack);
  assert.equal(defender.damage.corvette, 0);
});

test("a column with no enemy in it turns the flank: the target's depth stops counting, the shooter's does not", () => {
  const defender = () =>
    force(
      { corvette: 1, pod: 1 },
      { corvette: CELL.frontLeft, pod: CELL.middleLeft },
    );
  // On the right, where the defender has nobody, the fighter reaches the screened pod.
  const flanked = defender();
  fightRound(
    [force({ fighter: 1 }, { fighter: CELL.frontRight })],
    [flanked],
    RULES,
  );
  assert.equal(flanked.damage.pod, RULES.ships.fighter.attack);
  assert.equal(flanked.damage.corvette, 0);

  // Behind a pod of its own it is at depth 1, and a range-1 gun fires from the front only, flank or not.
  const screened = defender();
  fightRound(
    [
      force(
        { fighter: 1, pod: 1 },
        { fighter: CELL.middleRight, pod: CELL.frontRight },
      ),
    ],
    [screened],
    RULES,
  );
  assert.deepEqual(screened.damage, noShips());
});

test("range counts lines: a gun reaches as deep as its range less its own depth", () => {
  assert.equal(RULES.ships.cruiser.range, 3);
  // A cruiser in the rear of a full column is at depth 2: it reaches the enemy's front, not the line behind it.
  const rear = force(
    { pod: 1, fighter: 1, cruiser: 1 },
    { pod: CELL.frontLeft, fighter: CELL.middleLeft, cruiser: CELL.rearLeft },
  );
  const target = () =>
    force(
      { corvette: 1, pod: 1 },
      { corvette: CELL.frontLeft, pod: CELL.middleLeft },
      1,
      2,
    );
  const far = target();
  const outcome = fightRound([rear], [far], RULES);
  // The cruiser prefers the pod but can only reach the corvette, and one heavy shot destroys it.
  assert.equal(outcome.lost[1].corvette, 1);
  assert.equal(far.ships.pod, 1);
  assert.equal(far.damage.pod, 0);
  // The fighter at depth 1 never fired: nothing else was hit.
  assert.deepEqual(far.damage, noShips());

  // One line further forward it reaches the pod.
  const near = target();
  fightRound(
    [
      force(
        { pod: 1, cruiser: 1 },
        { pod: CELL.frontLeft, cruiser: CELL.middleLeft },
      ),
    ],
    [near],
    RULES,
  );
  assert.equal(near.ships.pod, 0);
  assert.equal(near.ships.corvette, 1);
});

test("the lowest initiative fires first, and what it destroys does not fire back", () => {
  assert.ok(RULES.ships.cruiser.initiative < RULES.ships.fighter.initiative);
  const cruiser = force({ cruiser: 1 }, { cruiser: CELL.frontLeft }, 1);
  const outcome = fightRound(
    [force({ fighter: 3 }, { fighter: CELL.frontLeft })],
    [cruiser],
    RULES,
  );
  // One shot destroys one fighter however heavy it is, and that fighter never fired.
  assert.equal(outcome.lost[0].fighter, 1);
  // The two left fired at the cruiser.
  assert.equal(cruiser.damage.cruiser, 2 * RULES.ships.fighter.attack);
});

test("classes with the same initiative fire together: what one destroys still fires back", () => {
  assert.equal(RULES.ships.corvette.initiative, RULES.ships.fighter.initiative);
  const corvettes = force({ corvette: 2 }, { corvette: CELL.frontLeft }, 1);
  const outcome = fightRound(
    [force({ fighter: 1 }, { fighter: CELL.frontLeft })],
    [corvettes],
    RULES,
  );
  assert.equal(outcome.lost[0].fighter, 1);
  assert.equal(corvettes.damage.corvette, RULES.ships.fighter.attack);
  // Damage short of a ship's armour is carried, not lost.
  assert.equal(outcome.lost[1].corvette, 0);
  assert.equal(corvettes.ships.corvette, 2);
});

test("damage a squadron carries is pooled and lasts from round to round", () => {
  const corvettes = force({ corvette: 1 }, { corvette: CELL.frontLeft }, 1);
  const fighters = force({ fighter: 6 }, { fighter: CELL.frontLeft });
  fightRound([fighters], [corvettes], RULES);
  assert.equal(corvettes.damage.corvette, 60);
  // One corvette does 24 a round to a squadron of 40-armour fighters: none destroyed yet, 24 carried.
  assert.equal(fighters.damage.fighter, 24);
  fightRound([fighters], [corvettes], RULES);
  assert.equal(fighters.ships.fighter, 5);
  assert.equal(fighters.damage.fighter, 8);
  assert.equal(corvettes.ships.corvette, 0);
  assert.equal(corvettes.damage.corvette, 0);
});

test("a freezing shot destroys nothing: for each armour's worth, one ship of the target does not fire this round", () => {
  assert.equal(RULES.ships.frigate.effect, "freeze");
  const shoot = (frigates: number) => {
    const target = force({ cruiser: 1 }, { cruiser: CELL.frontLeft });
    const defender = force(
      { frigate: frigates },
      { frigate: CELL.frontLeft },
      1,
    );
    return {
      outcome: fightRound([target], [defender], RULES),
      target,
      defender,
    };
  };
  // Six frigates freeze 900 of the cruiser's 800 armour: it does not fire, and nothing is destroyed.
  const enough = shoot(6);
  assert.deepEqual(enough.outcome.frozen, [1, 0]);
  assert.deepEqual(enough.outcome.lost, [noShips(), noShips()]);
  assert.deepEqual(enough.target.damage, noShips());
  assert.deepEqual(enough.defender.damage, noShips());

  // Five freeze 750: not enough, so it fires and destroys a frigate.
  const short = shoot(5);
  assert.deepEqual(short.outcome.frozen, [0, 0]);
  assert.equal(short.outcome.lost[1].frigate, 1);

  // A freeze lasts one round: the next round starts thawed.
  const again = fightRound([enough.target], [enough.defender], RULES);
  assert.deepEqual(again.frozen, [1, 0]);

  // A frigate freezes only the classes on its list: a fighter fires on.
  assert.ok(!RULES.ships.frigate.targets.includes("fighter"));
  const fighter = force({ fighter: 1 }, { fighter: CELL.frontLeft });
  const frigates = force({ frigate: 6 }, { frigate: CELL.frontLeft }, 1);
  const unfrozen = fightRound([fighter], [frigates], RULES);
  assert.deepEqual(unfrozen.frozen, [0, 0]);
  assert.equal(frigates.damage.frigate, RULES.ships.fighter.attack);
});

test("a ship frozen by a class that fires with it has already fired, and is not counted as frozen", () => {
  // Frigates freeze frigates, at the same initiative: both sides' frigates fire before any freeze lands.
  // Each side puts 300 of freeze into the other side's 240-armour frigates, but every one of them had fired.
  const attackers = force({ frigate: 2 }, { frigate: CELL.frontLeft });
  const defenders = force({ frigate: 2 }, { frigate: CELL.frontLeft }, 1);
  const outcome = fightRound([attackers], [defenders], RULES);
  assert.deepEqual(outcome.frozen, [0, 0]);
  assert.deepEqual(outcome.lost, [noShips(), noShips()]);
});

test("freezing stops once every ship of the target is frozen and moves on to the next class", () => {
  // Frigates prefer battleships to cruisers. Forty of them hold 6000: 4500 of it freezes the battleship and the rest
  // the cruiser behind it in their list.
  const many = force({ frigate: 40 }, { frigate: CELL.frontLeft }, 1);
  const target = force(
    { battleship: 1, cruiser: 1 },
    { battleship: CELL.frontLeft, cruiser: CELL.frontCentre },
  );
  const outcome = fightRound([target], [many], RULES);
  // 40 × 150 = 6000: 4500 freezes the battleship (30 shots) and the other 10 shots freeze 1500 of the cruiser's 800.
  assert.deepEqual(outcome.frozen, [2, 0]);
  assert.deepEqual(outcome.lost, [noShips(), noShips()]);
});

// ---------------------------------------------------------------------------------------------------------------
// The counter triangle.

/** Three fleets of about the same price. */
const SWARM: Partial<ShipCounts> = { fighter: 1000 };
const LINE_SHIPS: Partial<ShipCounts> = { corvette: 200, destroyer: 40 };
const ARTILLERY: Partial<ShipCounts> = { cruiser: 36 };

const priceOf = (counts: Partial<ShipCounts>): number => {
  const cost = costOf(ships(counts));
  return cost.metal + cost.crystal + cost.eonium;
};

test("the counter triangle: the line beats the swarm, artillery beats the line, the swarm beats artillery", () => {
  const prices = [SWARM, LINE_SHIPS, ARTILLERY].map(priceOf);
  // Within a twentieth of each other: no side wins by being bigger.
  for (const price of prices)
    assert.ok(
      Math.abs(price - prices[0]!) * 20 <= prices[0]!,
      `${price} against ${prices[0]}`,
    );

  const pairs = [
    ["line", LINE_SHIPS, "swarm", SWARM],
    ["artillery", ARTILLERY, "line", LINE_SHIPS],
    ["swarm", SWARM, "artillery", ARTILLERY],
  ] as const;
  for (const [winnerName, winner, loserName, loser] of pairs)
    // Whichever side attacks, both in the formation every planet starts with.
    for (const winnerAttacks of [true, false]) {
      const a = force(winnerAttacks ? winner : loser);
      const d = force(winnerAttacks ? loser : winner, {}, 1, 2);
      const rounds = fightOut(a, d);
      const [won, lost] = winnerAttacks ? [a, d] : [d, a];
      const label = `${winnerName} against ${loserName}, ${winnerAttacks ? "attacking" : "defending"}`;
      assert.equal(shipsValue(lost.ships, RULES), 0, label);
      // It wins with most of its worth left, inside the rules' rounds.
      assert.ok(
        shipsValue(won.ships, RULES) * 4 >= shipsValue(ships(winner), RULES),
        label,
      );
      assert.ok(rounds <= RULES.combat.rounds, label);
      // A fleet facing its counter still lasts a few rounds.
      assert.ok(rounds >= 3, `${label}: ${rounds} rounds`);
    }
});

// ---------------------------------------------------------------------------------------------------------------
// Battles in the world.

test("an attack on a planet with nothing to fight takes asteroids at once, up to the cap, and spends the pods that carry them", () => {
  let world = withPlanet(start(), 1, {
    asteroids: { metal: 40, crystal: 40, eonium: 40 },
    score: 5000,
  });
  world = withPlanet(world, 0, { score: 5000 });
  world = withFleets(world, raid(1, 0, 1, { pod: 50 }));
  const next = tick(world);
  // A quarter of 120.
  assert.equal(onlyEnd(next).captured, 30);
  assert.equal(onlyEnd(next).rounds, 0);
  assert.deepEqual(eventsOf(next, "battleRound"), []);
  // The planet gives up whichever kind it has most of, one at a time.
  assert.deepEqual(next.planets[1]!.asteroids, {
    metal: 30,
    crystal: 30,
    eonium: 30,
  });
  assert.deepEqual(next.planets[0]!.asteroids, {
    metal: 11,
    crystal: 11,
    eonium: 11,
  });
  assert.deepEqual(eventsOf(next, "asteroidsCaptured"), [
    {
      type: "asteroidsCaptured",
      player: 0,
      fleet: 1,
      from: 1,
      asteroids: { metal: 10, crystal: 10, eonium: 10 },
    },
  ]);
  // Each pod is spent on what it carries; the rest fly home.
  const fleet = fleetIn(next, 1)!;
  assert.equal(fleet.ships.pod, 20);
  assert.equal(fleet.phase, "returning");
  assert.equal(fleet.eta, fleet.travelTicks);
  assert.equal(next.planets[0]!.xp, 30 * RULES.xp.perAsteroid);
  assert.deepEqual(next.battles, []);

  // Fewer pods than the cap take what they carry, and a fleet with nothing left is lost.
  const short = tick({
    ...world,
    fleets: [raid(1, 0, 1, { pod: 12 })],
  });
  assert.equal(onlyEnd(short).captured, 12);
  assert.equal(fleetIn(short, 1), undefined);
  assert.deepEqual(eventsOf(short, "fleetLost"), [
    { type: "fleetLost", player: 0, fleet: 1 },
  ]);
});

test("the capture cap: a share of the asteroids, scaled down for a target much smaller than the attacker, never below the minimum", () => {
  assert.equal(RULES.capture.maxPercent, 25);
  assert.equal(RULES.capture.fullRatioPercent, 60);
  assert.equal(captureCap(120, 1000, 1000, RULES), 30);
  assert.equal(captureCap(120, 600, 1000, RULES), 30);
  // At 30% of the attacker's score, half of 60%: half the cap.
  assert.equal(captureCap(120, 300, 1000, RULES), 15);
  assert.equal(captureCap(120, 0, 1000, RULES), 1);
  // A larger target is never worth more than the cap.
  assert.equal(captureCap(120, 9000, 1000, RULES), 30);
  // The minimum, but never more than the planet has.
  assert.equal(captureCap(3, 1000, 1000, RULES), 1);
  assert.equal(captureCap(0, 1000, 1000, RULES), 0);
  // An attacker with no score at all does not divide by zero.
  assert.equal(captureCap(120, 1000, 0, RULES), 30);

  // The world reads the scores the planets had when the battle ended, the largest attacker's counting.
  let world = withPlanet(start(), 1, {
    asteroids: { metal: 40, crystal: 40, eonium: 40 },
    score: 300,
  });
  world = withPlanet(world, 0, { score: 1000 });
  world = withPlanet(world, 2, { score: 100 });
  world = withFleets(
    world,
    raid(1, 2, 1, { pod: 50 }),
    raid(2, 0, 1, { pod: 1 }),
  );
  assert.equal(onlyEnd(tick(world)).captured, 15);
});

test("attackers share the asteroids by the worth of their fleets, as far as their pods carry", () => {
  let world = withPlanet(start(), 1, {
    asteroids: { metal: 40, crystal: 40, eonium: 40 },
  });
  for (const id of [0, 1, 2]) world = withPlanet(world, id, { score: 5000 });

  const taken = (next: World) =>
    Object.fromEntries(
      eventsOf(next, "asteroidsCaptured").map((event) => [
        event.fleet,
        event.asteroids.metal +
          event.asteroids.crystal +
          event.asteroids.eonium,
      ]),
    );

  // 30 to share, three to one by worth: 22 and 7, and the one left over to the worthier fleet.
  const byWorth = tick(
    withFleets(world, raid(1, 0, 1, { pod: 30 }), raid(2, 2, 1, { pod: 10 })),
  );
  assert.equal(onlyEnd(byWorth).captured, 30);
  assert.deepEqual(taken(byWorth), { 1: 23, 2: 7 });

  // A worthy fleet with two pods takes two; the rest goes to the fleet that can carry it.
  const shortHanded = tick(
    withFleets(
      world,
      raid(1, 0, 1, { pod: 2, fighter: 1000 }),
      raid(2, 2, 1, { pod: 20 }),
    ),
  );
  assert.equal(onlyEnd(shortHanded).captured, 22);
  assert.deepEqual(taken(shortHanded), { 1: 2, 2: 20 });
  // A fleet whose pods are spent keeps its other ships; one with only pods spent is lost.
  assert.deepEqual(fleetIn(shortHanded, 1)!.ships, ships({ fighter: 1000 }));
  assert.equal(fleetIn(shortHanded, 2), undefined);

  // Fleets of equal worth: the lower fleet id takes what is left over.
  const level = tick(
    withFleets(world, raid(1, 0, 1, { pod: 15 }), raid(2, 2, 1, { pod: 15 })),
  );
  assert.deepEqual(taken(level), { 1: 15, 2: 15 });
  const odd = tick(
    withFleets(
      withPlanet(world, 1, {
        asteroids: { metal: 40, crystal: 40, eonium: 36 },
      }),
      raid(1, 0, 1, { pod: 15 }),
      raid(2, 2, 1, { pod: 15 }),
    ),
  );
  assert.deepEqual(taken(odd), { 1: 15, 2: 14 });

  // What is captured past the rules' most asteroids of a kind is lost.
  const full = tick(
    withFleets(
      withPlanet(world, 0, {
        asteroids: {
          metal: RULES.asteroid.maxPerResource,
          crystal: 1,
          eonium: 1,
        },
      }),
      raid(1, 0, 1, { pod: 30 }),
    ),
  );
  assert.equal(full.planets[0]!.asteroids.metal, RULES.asteroid.maxPerResource);
  assert.equal(full.planets[0]!.asteroids.crystal, 11);
});

test("the planet's owner salvages a share of everything destroyed at it, and defending earns military score", () => {
  // Five fighters against ten corvettes: all five are destroyed in the first round.
  let world = homeFleet(start(), 1, { corvette: 10 });
  world = withFleets(world, raid(1, 0, 1, { fighter: 5, pod: 0 }));
  const before = world.planets[1]!;
  const next = tick(world);
  const round = onlyRound(next);
  assert.deepEqual(round.attackersLost, ships({ fighter: 5 }));
  assert.deepEqual(round.defendersLost, noShips());
  assert.deepEqual(round.parties, [0, 1]);

  const end = onlyEnd(next);
  assert.equal(end.rounds, 1);
  assert.equal(end.captured, 0);
  const wreck = costOf(ships({ fighter: 5 }));
  assert.deepEqual(end.salvage, share(wreck, RULES.combat.salvagePercent));
  // The salvage lands in the planet's stock with the tick's income.
  const gross = income(before, RULES);
  const tax = taxOn(gross, next.teams[1]!.taxPercent);
  for (const resource of RESOURCE_IDS)
    assert.equal(
      next.planets[1]!.resources[resource],
      before.resources[resource] +
        gross[resource] -
        tax[resource] +
        end.salvage[resource],
    );
  assert.equal(
    next.planets[1]!.xp,
    (5 * RULES.ships.fighter.value * RULES.xp.defendPercent) / 100,
  );
  assert.equal(fleetIn(next, 1), undefined);
  assert.deepEqual(eventsOf(next, "fleetLost"), [
    { type: "fleetLost", player: 0, fleet: 1 },
  ]);
  assert.deepEqual(next.battles, []);
});

test("an attacker earns more for hitting a planet larger than itself, within the rules' bounds", () => {
  const xpAgainst = (targetScore: number, ownScore: number) => {
    let world = homeFleet(start(), 1, { fighter: 1 });
    world = withPlanet(world, 1, { score: targetScore });
    world = withPlanet(world, 0, { score: ownScore });
    // Two cruisers destroy the fighter before it fires.
    return tick(withFleets(world, raid(1, 0, 1, { cruiser: 2 }))).planets[0]!
      .xp;
  };
  // A fighter is worth 8: half of it at an equal target, doubled at most and halved at least.
  assert.equal(xpAgainst(1000, 1000), 4);
  assert.equal(xpAgainst(5000, 1000), 8);
  assert.equal(xpAgainst(100, 1000), 2);
});

/** Planet 1 holding off a fleet of twenty fighters and a pod with two corvettes: a battle that lasts. */
function battleUnderWay(): World {
  let world = homeFleet(start(), 1, { corvette: 2 });
  world = withFleets(world, raid(1, 0, 1, { fighter: 20, pod: 1 }));
  return tick(world);
}

test("a battle under way is frozen with the rest of the world: its wounds, wreck and the fleets' formations", () => {
  const fought = battleUnderWay();
  assert.ok(frozen(fought));
  const battle = fought.battles[0]!;
  assert.ok(Object.isFrozen(battle.wounds[0]!.damage));
  assert.ok(Object.isFrozen(battle.wreck));
  assert.ok(Object.isFrozen(fought.fleets[0]!.formation));
  assert.ok(Object.isFrozen(fought.planets[1]!.formation));
  assert.throws(() => {
    Object.assign(battle.wreck, { metal: 1 });
  }, TypeError);
  assert.throws(() => {
    Object.assign(fought.planets[1]!.formation, { pod: 0 });
  }, TypeError);
});

test("a fleet recalled from a battle leaves a share of every class behind as wreckage", () => {
  const fought = battleUnderWay();
  // Round one: the corvettes' six shots destroy one fighter and leave 8 damage; twenty fighters destroy a corvette.
  assert.deepEqual(fleetIn(fought, 1)!.ships, ships({ fighter: 19, pod: 1 }));
  assert.equal(fought.planets[1]!.ships.corvette, 1);
  assert.deepEqual(fought.battles[0]!.wounds, [
    { fleet: 1, damage: ships({ fighter: 8 }) },
    { fleet: NONE, damage: ships({ corvette: 80 }) },
  ]);

  const recalled = tick(fought, from(0, { type: "recallFleet", fleet: 1 }));
  // 15% of each class, rounded up: three of nineteen fighters and the only pod.
  const left = ships({ fighter: 3, pod: 1 });
  const fleet = fleetIn(recalled, 1)!;
  assert.deepEqual(fleet.ships, ships({ fighter: 16 }));
  assert.equal(fleet.phase, "returning");
  assert.equal(fleet.eta, fleet.travelTicks - 1);
  // With no attacker left the battle is over, and the planet salvages what was destroyed and left behind.
  const end = onlyEnd(recalled);
  assert.equal(end.rounds, 1);
  assert.equal(end.captured, 0);
  const wreck = add(costOf(ships({ fighter: 1, corvette: 1 })), costOf(left));
  assert.deepEqual(end.salvage, share(wreck, RULES.combat.salvagePercent));
  assert.deepEqual(recalled.battles, []);

  // A fleet of one ship leaves it behind, and is lost.
  let lone = homeFleet(start(), 1, { corvette: 1 });
  lone = tick(withFleets(lone, raid(1, 0, 1, { pod: 1 })));
  assert.equal(lone.battles.length, 1);
  const gone = tick(lone, from(0, { type: "recallFleet", fleet: 1 }));
  assert.equal(fleetIn(gone, 1), undefined);
  assert.deepEqual(eventsOf(gone, "fleetLost"), [
    { type: "fleetLost", player: 0, fleet: 1 },
  ]);
});

test("a defender recalled from a battle pays the same price; one recalled from a quiet planet does not", () => {
  // Planet 3 stands with its teammate 1 against pods that cannot fire, so the battle runs on.
  let world = homeFleet(start(), 1, { pod: 1 });
  world = withFleets(
    world,
    raid(1, 0, 1, { pod: 5 }),
    fleetOf(2, 3, 1, {
      mission: "defend",
      ships: ships({ corvette: 20 }),
      phase: "stationed",
      eta: 50,
    }),
  );
  const fought = tick(world);
  assert.equal(fought.battles.length, 1);
  const recalled = tick(fought, from(3, { type: "recallFleet", fleet: 2 }));
  assert.deepEqual(fleetIn(recalled, 2)!.ships, ships({ corvette: 17 }));
  assert.equal(fleetIn(recalled, 2)!.phase, "returning");

  const quiet = tick(
    withFleets(
      start(),
      fleetOf(2, 3, 1, {
        mission: "defend",
        ships: ships({ corvette: 20 }),
        phase: "stationed",
        eta: 50,
      }),
    ),
    from(3, { type: "recallFleet", fleet: 2 }),
  );
  assert.deepEqual(fleetIn(quiet, 2)!.ships, ships({ corvette: 20 }));
});

test("sheltering the home fleet in a battle costs what a retreat does, and leaves the planet to the attackers", () => {
  let world = homeFleet(start(), 1, { corvette: 10 });
  world = withFleets(world, raid(1, 0, 1, { fighter: 40, pod: 5 }));
  const fought = tick(world);
  const home = fought.planets[1]!.ships.corvette;
  assert.equal(fought.battles.length, 1);

  const sheltered = tick(
    fought,
    from(1, { type: "setShelter", sheltered: true }),
  );
  assert.equal(sheltered.planets[1]!.sheltered, true);
  assert.equal(
    sheltered.planets[1]!.ships.corvette,
    home - Math.ceil((home * RULES.combat.retreatLossPercent) / 100),
  );
  // No round is fought: nobody defends, so the battle ends and the pods capture.
  assert.deepEqual(eventsOf(sheltered, "battleRound"), []);
  assert.ok(onlyEnd(sheltered).captured > 0);
  assert.equal(viewFor(sheltered, 1).battles.length, 0);

  // A planet sheltered before the attack lands loses nothing.
  const before = tick(
    withFleets(
      withPlanet(homeFleet(start(), 1, { corvette: 10 }), 1, {
        sheltered: true,
      }),
      raid(1, 0, 1, { fighter: 40, pod: 5 }),
    ),
  );
  assert.equal(before.planets[1]!.ships.corvette, 10);
  assert.ok(onlyEnd(before).captured > 0);
  // Coming back out of shelter is allowed at any time.
  assert.deepEqual(
    reasons(tick(before, from(1, { type: "setShelter", sheltered: false }))),
    [],
  );
});

test("fleets that arrive during a battle join it on the tick they land, on their own side", () => {
  // Pods against a pod: nobody can fire, so the battle runs until help arrives.
  let world = homeFleet(start(), 1, { pod: 1 });
  world = withFleets(
    world,
    raid(1, 0, 1, { pod: 10 }),
    fleetOf(2, 3, 1, {
      mission: "defend",
      ships: ships({ corvette: 10 }),
      eta: 3,
    }),
    raid(3, 2, 1, { fighter: 30 }, { eta: 4 }),
  );
  const first = tick(world);
  assert.deepEqual(onlyRound(first).parties, [0, 1]);
  assert.deepEqual(onlyRound(first).attackersLost, noShips());
  const second = tick(first);
  assert.equal(onlyRound(second).round, 2);

  // The defenders' reinforcement lands and fires in the round of its arrival.
  const third = tick(second);
  assert.equal(onlyRound(third).round, 3);
  assert.deepEqual(onlyRound(third).parties, [0, 1, 3]);
  // Thirty corvette shots of 8: not yet a pod destroyed, but damage carried.
  assert.deepEqual(third.battles[0]!.wounds[0], {
    fleet: 1,
    damage: ships({ pod: 240 }),
  });
  assert.equal(fleetIn(third, 2)!.phase, "stationed");
  const seen = viewFor(third, 3).battles;
  assert.deepEqual(
    seen.map((battle) => battle.defenders.map((one) => one.fleet)),
    [[NONE, 2]],
  );

  // And so does the attackers'.
  const fourth = tick(third);
  assert.equal(onlyRound(fourth).round, 4);
  assert.deepEqual(onlyRound(fourth).parties, [0, 1, 2, 3]);
  assert.deepEqual(
    viewFor(fourth, 2).battles[0]!.attackers.map((one) => one.fleet),
    [1, 3],
  );
});

test("a defender's watch does not run down while its planet is fought over", () => {
  let world = homeFleet(start(), 1, { pod: 1 });
  world = withFleets(
    world,
    raid(1, 0, 1, { pod: 1 }),
    fleetOf(2, 3, 1, {
      mission: "defend",
      ships: ships({ pod: 1 }),
      phase: "stationed",
      eta: 1,
    }),
  );
  const fought = tick(tick(world));
  assert.equal(fleetIn(fought, 2)!.phase, "stationed");
  assert.equal(fleetIn(fought, 2)!.eta, 1);
});

test("a battle ends after the rules' rounds even when both sides stand, and pods that survive still capture", () => {
  let world = homeFleet(start(), 1, { pod: 1 });
  world = withFleets(world, raid(1, 0, 1, { pod: 5 }));
  for (let round = 1; round < RULES.combat.rounds; round++) {
    world = tick(world);
    assert.equal(onlyRound(world).round, round);
    assert.deepEqual(eventsOf(world, "battleEnded"), []);
  }
  world = tick(world);
  assert.equal(onlyRound(world).round, RULES.combat.rounds);
  const end = onlyEnd(world);
  assert.equal(end.rounds, RULES.combat.rounds);
  assert.equal(end.captured, 1);
  assert.deepEqual(world.battles, []);
  assert.equal(fleetIn(world, 1)!.phase, "returning");
  assert.equal(fleetIn(world, 1)!.ships.pod, 4);
});

test("a battle at one planet leaves another alone, and two run side by side", () => {
  let world = homeFleet(start(), 1, { pod: 1 });
  world = homeFleet(world, 3, { pod: 1 });
  world = withFleets(
    world,
    raid(1, 0, 1, { pod: 1 }),
    raid(2, 2, 3, { pod: 1 }, { eta: 2 }),
  );
  const first = tick(world);
  assert.deepEqual(
    first.battles.map((battle) => battle.planet),
    [1],
  );
  const second = tick(first);
  assert.deepEqual(
    second.battles.map((battle) => [battle.planet, battle.round]),
    [
      [1, 2],
      [3, 1],
    ],
  );
});

test("the bash limit is checked at launch: a fleet already on its way lands whatever the scores do", () => {
  let world = withPlanet(start(), 0, {
    ships: ships({ fighter: 5 }),
    score: 1000,
  });
  world = withPlanet(world, 1, { score: 250 });
  const attack: Command = {
    type: "launchFleet",
    mission: "attack",
    target: 1,
    ships: { fighter: 5 },
  };
  assert.deepEqual(reasons(tick(world, from(0, attack))), []);
  assert.deepEqual(
    reasons(tick(withPlanet(world, 1, { score: 249 }), from(0, attack))),
    ["the target is too small for this planet to attack"],
  );
  const landing = withFleets(
    withPlanet(world, 1, { score: 1 }),
    raid(1, 0, 1, { fighter: 5 }),
  );
  assert.equal(onlyEnd(tick(landing)).planet, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// Replays.

/** The default rules with fleets at home from the start, so a battle can be fought from a recorded match. */
const ARMED: Rules = {
  ...RULES,
  start: {
    ...RULES.start,
    ships: ships({ probe: 2, fighter: 60, corvette: 12, frigate: 4, pod: 10 }),
  },
};

/** A 2v2 of hand-written commands with two battles, one of them against a sheltered planet. */
function recordBattles() {
  const env = createEnv({ rules: ARMED });
  env.reset(7, { teams: 2, teamSize: 2, neutrals: 2 });
  const script = new Map<number, Map<number, Command[]>>([
    [
      1,
      new Map([
        [
          0,
          [
            {
              type: "launchFleet",
              mission: "attack",
              target: 1,
              ships: { fighter: 60, frigate: 4, pod: 10 },
            },
          ],
        ],
        [1, [{ type: "setFormation", fleet: NONE, arrangement: "wall" }]],
        [
          2,
          [
            {
              type: "launchFleet",
              mission: "attack",
              target: 3,
              ships: { corvette: 12, pod: 5 },
            },
          ],
        ],
        [3, [{ type: "setShelter", sheltered: true }]],
      ]),
    ],
    [
      20,
      new Map([
        [
          0,
          [
            {
              type: "setFormation",
              fleet: 1,
              arrangement: { fighter: CELL.frontRight, pod: CELL.rearLeft },
            },
          ],
        ],
        [
          3,
          [
            {
              type: "launchFleet",
              mission: "defend",
              target: 1,
              ships: { corvette: 12 },
            },
          ],
        ],
      ]),
    ],
  ]);
  let rounds = 0,
    captured = 0;
  for (let step = 1; step <= 260; step++) {
    const result = env.step(script.get(step) ?? new Map());
    for (const view of result.views)
      for (const event of view.events)
        if (event.type === "rejected")
          assert.fail(`tick ${step}: ${JSON.stringify(event)}`);
    rounds += eventsOf(env.world(), "battleRound").length;
    captured += eventsOf(env.world(), "asteroidsCaptured").length;
  }
  return { log: env.log(), world: env.world(), rounds, captured };
}

test("a recorded match with battles in it plays again from its seed and commands, hash for hash", () => {
  const { log, world, rounds, captured } = recordBattles();
  // The battles were fought over several rounds and asteroids changed hands.
  assert.ok(rounds > 2, `${rounds} rounds`);
  assert.ok(captured > 0);
  assert.deepEqual(world.battles, []);

  const hash = hashWorld(world);
  assert.equal(hashWorld(replay(log, ARMED)), hash);
  const stored = parseMatchLog(JSON.parse(JSON.stringify(log)));
  assert.ok(stored);
  assert.equal(hashWorld(replay(stored, ARMED)), hash);
  // A second recording is the same match.
  assert.equal(hashWorld(recordBattles().world), hash);
  // Changing the formation the defender chose changes the outcome.
  const otherFormation = {
    ...log,
    entries: log.entries.map((entry) => ({
      ...entry,
      submissions: entry.submissions.map((submission) =>
        submission.player === 1
          ? {
              ...submission,
              command: {
                type: "setFormation",
                fleet: NONE,
                arrangement: "column",
              },
            }
          : submission,
      ),
    })),
  };
  assert.notEqual(hashWorld(replay(otherFormation, ARMED)), hash);
  // Changing this on purpose means the rules changed: bump `Rules.version` in the same change.
  assert.equal(hash, "2696700669db2c79");
});
