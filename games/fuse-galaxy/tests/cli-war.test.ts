import test from "node:test";
import assert from "node:assert/strict";
import { NONE, type World } from "../src/engine/index.js";
import { parseInput } from "../src/cli/input.js";
import { eventLine, renderView } from "../src/cli/render.js";
import {
  LINE,
  RULES,
  raid,
  ships,
  start,
  viewFor,
  withFleets,
  withPlanet,
} from "./support.js";

const WALL = RULES.combat.formations.wall!;

/** Planet 0 at war: a battle at home and one away, and three attacks seen coming in three levels of detail. */
function atWar(): World {
  let world = withPlanet(start(), 0, {
    ships: ships({ probe: 1, fighter: 3, pod: 2 }),
    formation: { ...LINE, fighter: 8 },
    research: { ...start().planets[0]!.research, sensors: 1 },
  });
  world = withPlanet(world, 2, {
    research: { ...start().planets[2]!.research, sensors: 2 },
  });
  world = withPlanet(world, 3, {
    research: { ...start().planets[3]!.research, jamming: 2 },
  });
  world = {
    ...world,
    battles: [
      {
        planet: 0,
        round: 2,
        wounds: [],
        wreck: { metal: 0, crystal: 0, eonium: 0 },
      },
      {
        planet: 4,
        round: 1,
        wounds: [],
        wreck: { metal: 0, crystal: 0, eonium: 0 },
      },
    ],
  };
  return withFleets(
    world,
    raid(5, 1, 0, { corvette: 4 }, { phase: "fighting", eta: 0 }),
    raid(
      7,
      0,
      4,
      { fighter: 9 },
      { phase: "fighting", eta: 0, formation: WALL },
    ),
    raid(8, 1, 0, { fighter: 23 }, { eta: 30 }),
    raid(9, 1, 2, { fighter: 5 }, { eta: 31, formation: WALL }),
    raid(10, 3, 2, { cruiser: 1 }, { eta: 32 }),
  );
}

test("formation and shelter are typed as the engine takes them", () => {
  const read = (line: string) => parseInput(line);
  assert.deepEqual(read("formation home wall"), {
    kind: "command",
    command: { type: "setFormation", fleet: NONE, arrangement: "wall" },
  });
  assert.deepEqual(read("formation 3 fighter=8 pod=0"), {
    kind: "command",
    command: {
      type: "setFormation",
      fleet: 3,
      arrangement: { fighter: 8, pod: 0 },
    },
  });
  // A name the rules do not have is still a command: the engine says why it refuses it.
  assert.deepEqual(read("formation home phalanx"), {
    kind: "command",
    command: { type: "setFormation", fleet: NONE, arrangement: "phalanx" },
  });
  for (const line of [
    "formation home",
    "formation home wall column",
    "formation home fighter=front",
    "formation home fighter=1=2",
  ])
    assert.deepEqual(
      read(line),
      {
        kind: "error",
        message: "the command's arrangement is missing or malformed",
      },
      line,
    );
  assert.deepEqual(read("formation away wall"), {
    kind: "error",
    message: "the command's fleet is missing or malformed",
  });
  assert.deepEqual(read("shelter on"), {
    kind: "command",
    command: { type: "setShelter", sheltered: true },
  });
  assert.deepEqual(read("shelter off"), {
    kind: "command",
    command: { type: "setShelter", sheltered: false },
  });
  for (const line of ["shelter", "shelter yes"])
    assert.deepEqual(read(line), {
      kind: "error",
      message: "the command's sheltered is missing or malformed",
    });
});

test("a view at war shows the battles, the fleets fighting in them and the attacks seen coming", () => {
  const lines = renderView(viewFor(atWar(), 0), RULES).split("\n");
  const at = (start: string): number =>
    lines.findIndex((line) => line.startsWith(start));
  for (const line of [
    // Probes do not fight, so the formation leaves them out.
    "Formation    fighter=8 pod=5",
    "Fleet 7      planet 0 to attack planet 4, fighting [wall]: fighter 9",
    // Each attack in the detail the target's sensors give against the attacker's jamming.
    "INCOMING     fleet 8 of planet 1 attacks planet 0 in 30 ticks: about fighter 10",
    "INCOMING     fleet 9 of planet 1 attacks planet 2 in 31 ticks: fighter 5 [wall]",
    "INCOMING     fleet 10 of planet 3 attacks planet 2 in 32 ticks: ships unknown",
  ])
    assert.ok(lines.includes(line), `${line}\n--- in ---\n${lines.join("\n")}`);
  // Each battle with every force on each side under it.
  const home = at("Battle       at planet 0");
  assert.deepEqual(lines.slice(home, home + 3), [
    "Battle       at planet 0, round 2 of 10",
    "  attacking  planet 1 fleet 5 [line]: corvette 4",
    "  defending  planet 0 home fleet [fighter=8 pod=5]: probe 1  fighter 3  pod 2",
  ]);
  const away = at("Battle       at planet 4");
  assert.deepEqual(lines.slice(away, away + 3), [
    "Battle       at planet 4, round 1 of 10",
    "  attacking  planet 0 fleet 7 [wall]: fighter 9",
    "  defending  planet 4 home fleet [line]: fighter 30  corvette 8",
  ]);

  // A formation with nothing in it to place, and a sheltered home fleet.
  const quiet = renderView(
    viewFor(
      withPlanet(start(), 0, {
        ships: ships({}),
        formation: { ...LINE, fighter: 8 },
        sheltered: true,
      }),
      0,
    ),
    RULES,
  ).split("\n");
  assert.ok(
    quiet.includes("Formation    custom · sheltered: out of any battle here"),
  );
});

test("the events of a battle each have their line", () => {
  const lost = ships({ fighter: 3, pod: 1 });
  assert.deepEqual(
    [
      eventLine({ type: "fleetLost", player: 2, fleet: 6 }),
      eventLine({
        type: "battleRound",
        planet: 1,
        round: 3,
        parties: [0, 1],
        attackersLost: lost,
        defendersLost: ships({}),
        attackersFrozen: 2,
        defendersFrozen: 0,
      }),
      eventLine({
        type: "battleEnded",
        planet: 1,
        rounds: 1,
        parties: [0, 1],
        captured: 1,
        salvage: { metal: 90, crystal: 0, eonium: 4 },
      }),
      eventLine({
        type: "battleEnded",
        planet: 1,
        rounds: 10,
        parties: [0, 1],
        captured: 0,
        salvage: { metal: 0, crystal: 0, eonium: 0 },
      }),
      eventLine({
        type: "asteroidsCaptured",
        player: 0,
        fleet: 6,
        from: 1,
        asteroids: { metal: 2, crystal: 0, eonium: 1 },
      }),
    ],
    [
      "fleet 6 of planet 2 has no ship left",
      "battle at planet 1, round 3: attackers lost fighter 3  pod 1 (2 frozen) · defenders lost none (0 frozen)",
      "battle at planet 1 ended after 1 round: 1 asteroid captured · salvage metal 90  eonium 4",
      "battle at planet 1 ended after 10 rounds: 0 asteroids captured · salvage none",
      "fleet 6 of planet 0 took metal 2  eonium 1 asteroids from planet 1",
    ],
  );
});
