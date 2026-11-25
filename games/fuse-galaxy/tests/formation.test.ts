import test from "node:test";
import assert from "node:assert/strict";
import {
  CELLS,
  NONE,
  columnOf,
  formationName,
  hashWorld,
  lineOf,
  namedFormation,
  parseCommand,
  type Arrangement,
  type Command,
} from "../src/engine/index.js";
import {
  LINE,
  RULES,
  fleetOf,
  from,
  idle,
  reasons,
  refusal,
  ships,
  start,
  tick,
  withFleets,
  withPlanet,
} from "./support.js";

const WALL = RULES.combat.formations.wall!;

test("the grid is three lines of three columns, the front line first", () => {
  assert.equal(CELLS, 9);
  assert.deepEqual(
    Array.from({ length: CELLS }, (_, cell) => [lineOf(cell), columnOf(cell)]),
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
    ],
  );
  // Every named formation places every class on the grid, and is named back by its own name.
  for (const [name, formation] of Object.entries(RULES.combat.formations)) {
    assert.equal(formationName(formation, RULES), name);
    for (const cell of Object.values(formation))
      assert.ok(Number.isInteger(cell) && cell >= 0 && cell < CELLS, name);
  }
  assert.deepEqual(namedFormation(RULES.combat.defaultFormation, RULES), LINE);
  assert.equal(formationName({ ...LINE, cruiser: 0 }, RULES), undefined);
  // Only the rules' own names count, never what every object inherits.
  for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty"])
    assert.equal(namedFormation(name, RULES), undefined, name);
});

test("setFormation and setShelter are read from untrusted data, field by field", () => {
  const read: readonly (readonly [unknown, Command])[] = [
    [
      { type: "setFormation", fleet: NONE, arrangement: "wall" },
      { type: "setFormation", fleet: NONE, arrangement: "wall" },
    ],
    [
      {
        type: "setFormation",
        fleet: 3,
        arrangement: { fighter: 2, pod: undefined },
      },
      { type: "setFormation", fleet: 3, arrangement: { fighter: 2 } },
    ],
    [
      { type: "setFormation", fleet: -0, arrangement: {} },
      { type: "setFormation", fleet: 0, arrangement: {} },
    ],
    [
      { type: "setShelter", sheltered: true, extra: 1 },
      { type: "setShelter", sheltered: true },
    ],
  ];
  for (const [raw, command] of read)
    assert.deepEqual(parseCommand(raw), { ok: true, command });

  const malformed: readonly (readonly [Record<string, unknown>, string])[] = [
    [{ type: "setFormation", arrangement: "wall" }, "fleet"],
    [{ type: "setFormation", fleet: "home", arrangement: "wall" }, "fleet"],
    [{ type: "setFormation", fleet: NaN, arrangement: "wall" }, "fleet"],
    [{ type: "setFormation", fleet: NONE }, "arrangement"],
    [{ type: "setFormation", fleet: NONE, arrangement: 4 }, "arrangement"],
    [{ type: "setFormation", fleet: NONE, arrangement: null }, "arrangement"],
    [{ type: "setFormation", fleet: NONE, arrangement: [0, 1] }, "arrangement"],
    [
      { type: "setFormation", fleet: NONE, arrangement: { titan: 1 } },
      "arrangement",
    ],
    [
      { type: "setFormation", fleet: NONE, arrangement: { fighter: "1" } },
      "arrangement",
    ],
    [
      { type: "setFormation", fleet: NONE, arrangement: { fighter: Infinity } },
      "arrangement",
    ],
    [{ type: "setShelter" }, "sheltered"],
    [{ type: "setShelter", sheltered: "true" }, "sheltered"],
    [{ type: "setShelter", sheltered: 1 }, "sheltered"],
  ];
  for (const [command, field] of malformed)
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

test("a formation is a name the rules give or whole cells on the grid, for the home fleet or a fleet of one's own", () => {
  const world = withFleets(
    start(),
    fleetOf(1, 0, 4, { mission: "attack", ships: ships({ fighter: 1 }) }),
    fleetOf(2, 1, 4, { mission: "attack", ships: ships({ fighter: 1 }) }),
  );
  const set = (fleet: number, arrangement: Arrangement) =>
    refusal(world, 0, { type: "setFormation", fleet, arrangement });
  assert.equal(set(NONE, "wall"), undefined);
  assert.equal(set(1, { cruiser: 8 }), undefined);
  assert.equal(set(NONE, "phalanx"), "unknown formation");
  assert.equal(set(NONE, "toString"), "unknown formation");
  assert.equal(set(NONE, ""), "unknown formation");
  for (const cell of [9, -1, 1.5])
    assert.equal(
      set(NONE, { fighter: cell }),
      "a formation's cells are whole numbers from 0 to 8",
      String(cell),
    );
  assert.equal(set(2, "wall"), "unknown fleet");
  assert.equal(set(7, "wall"), "unknown fleet");
  assert.equal(set(-2, "wall"), "unknown fleet");

  // A refused command leaves the world as an idle tick would, but for the refusal.
  const refused = tick(
    world,
    from(
      0,
      { type: "setFormation", fleet: NONE, arrangement: { pod: 9 } },
      { type: "setShelter", sheltered: false },
    ),
  );
  assert.equal(reasons(refused).length, 2);
  assert.equal(
    hashWorld({ ...refused, events: [] }),
    hashWorld({ ...idle(world, 1), events: [] }),
  );
});

test("a named formation replaces the whole formation; cells move only the classes named", () => {
  let world = withFleets(
    start(),
    fleetOf(1, 0, 4, { mission: "attack", ships: ships({ fighter: 1 }) }),
  );
  world = tick(
    world,
    from(
      0,
      { type: "setFormation", fleet: NONE, arrangement: "wall" },
      { type: "setFormation", fleet: 1, arrangement: { fighter: 8, pod: 0 } },
    ),
  );
  assert.deepEqual(reasons(world), []);
  assert.deepEqual(world.planets[0]!.formation, WALL);
  assert.deepEqual(world.fleets[0]!.formation, {
    ...LINE,
    fighter: 8,
    pod: 0,
  });
  // Nobody else's formation moved.
  assert.deepEqual(world.planets[2]!.formation, LINE);

  // A fleet launched now takes the home fleet's formation with it, and a later change at home does not follow it.
  world = withPlanet(world, 0, { ships: ships({ fighter: 3 }) });
  world = tick(
    world,
    from(0, {
      type: "launchFleet",
      mission: "attack",
      target: 4,
      ships: { fighter: 3 },
    }),
  );
  const launched = world.fleets.find((fleet) => fleet.id === 2)!;
  assert.deepEqual(launched.formation, WALL);
  world = tick(
    world,
    from(0, { type: "setFormation", fleet: NONE, arrangement: "column" }),
  );
  assert.deepEqual(
    world.fleets.find((fleet) => fleet.id === 2)!.formation,
    WALL,
  );
});

test("the home fleet is sheltered or brought out, once each way", () => {
  const sheltered = tick(
    start(),
    from(0, { type: "setShelter", sheltered: true }),
  );
  assert.equal(sheltered.planets[0]!.sheltered, true);
  assert.equal(
    refusal(sheltered, 0, { type: "setShelter", sheltered: true }),
    "the home fleet is already sheltered",
  );
  assert.equal(
    refusal(start(), 0, { type: "setShelter", sheltered: false }),
    "the home fleet is not sheltered",
  );
  // Out of a battle, sheltering costs nothing.
  assert.deepEqual(sheltered.planets[0]!.ships, start().planets[0]!.ships);
  const out = tick(
    sheltered,
    from(0, { type: "setShelter", sheltered: false }),
  );
  assert.equal(out.planets[0]!.sheltered, false);
});
