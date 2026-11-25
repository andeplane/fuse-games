import test from "node:test";
import assert from "node:assert/strict";
import {
  NONE,
  SETUP_2V2V2,
  SETUP_3V3,
  distance,
  stockValue,
  teamScore,
  totalOf,
  type Resources,
  type Rules,
  type World,
} from "../src/engine/index.js";
import {
  RULES,
  eventsOf,
  frozen,
  start,
  tick,
  viewFor,
  withPlanet,
  withTeam,
} from "./support.js";

test("a 2v2v2 is three teams of two around the map, members dealt out a place at a time, then the neutral planets", () => {
  const world = start(4, SETUP_2V2V2);
  assert.equal(world.planets.length, 12);
  assert.deepEqual(
    world.teams.map((team) => team.members),
    [
      [0, 3],
      [1, 4],
      [2, 5],
    ],
  );
  assert.deepEqual(
    world.planets.map((planet) => planet.kind === "seat"),
    [...Array<boolean>(6).fill(true), ...Array<boolean>(6).fill(false)],
  );
  assert.deepEqual(
    world.planets.slice(0, 6).map((planet) => planet.team),
    [0, 1, 2, 0, 1, 2],
  );
  for (const planet of world.planets) {
    assert.ok(planet.x >= 0 && planet.x <= RULES.map.size);
    assert.ok(planet.y >= 0 && planet.y <= RULES.map.size);
  }
  // The three galaxies are as far from each other as from the third, to a map unit.
  const anchors = RULES.map.teamAnchors[1]!.map(([x, y]) => ({ x, y }));
  const sides = [
    distance(anchors[0]!, anchors[1]!),
    distance(anchors[1]!, anchors[2]!),
    distance(anchors[2]!, anchors[0]!),
  ];
  assert.ok(Math.max(...sides) - Math.min(...sides) <= 1, String(sides));
  // Teammates sit closer to each other than to anyone else.
  for (const team of world.teams) {
    const [a, b] = team.members.map((id) => world.planets[id]!);
    for (const other of world.planets.slice(0, 6))
      if (other.team !== team.id)
        assert.ok(distance(a!, b!) < distance(a!, other));
  }
  assert.ok(frozen(world));
});

/** The match's last tick, with each team's planets given this stock so their scores come out in this order. */
function lastTick(stocks: readonly number[]): World {
  const rules: Rules = { ...RULES, match: { tickLimit: 1 } };
  let world = start(4, SETUP_2V2V2, rules);
  for (const team of world.teams)
    for (const member of team.members) {
      const each = stocks[team.id]!;
      const resources: Resources = { metal: each, crystal: 0, eonium: 0 };
      world = withPlanet(world, member, { resources });
    }
  return tick(world, [], rules);
}

test("of three teams the highest score wins; a tie at the top is a draw, a tie below it is not", () => {
  const winner = (stocks: readonly number[]) => lastTick(stocks).result?.winner;
  assert.equal(winner([0, 0, 10_000]), 2);
  assert.equal(winner([10_000, 0, 0]), 0);
  assert.equal(winner([0, 10_000, 0]), 1);
  // Level at the top: nobody wins, whichever teams they are.
  assert.equal(winner([10_000, 0, 10_000]), NONE);
  assert.equal(winner([0, 10_000, 10_000]), NONE);
  assert.equal(winner([5_000, 5_000, 5_000]), NONE);
  // Level below the top: the top still wins, whether the level pair comes before it or after.
  assert.equal(winner([10_000, 0, 0]), 0);
  assert.equal(winner([0, 0, 10_000]), 2);

  const ended = lastTick([0, 20_000, 10_000]);
  assert.equal(ended.phase, "ended");
  assert.deepEqual(eventsOf(ended, "matchEnded"), [
    { type: "matchEnded", winner: 1 },
  ]);
  const scores = ended.teams.map((team) =>
    teamScore(team, ended.planets, RULES),
  );
  assert.deepEqual(ended.result?.teamScores, scores);
  assert.ok(scores[1]! > scores[2]! && scores[2]! > scores[0]!);
  // Every seat sees the result.
  for (const seat of [0, 1, 2, 3, 4, 5])
    assert.deepEqual(viewFor(ended, seat).result, ended.result);
});

test("the scoreboard shows every planet's score in its parts, and each team's as its members' plus its fund", () => {
  let world = start(2, SETUP_3V3);
  world = withPlanet(world, 4, {
    xp: 300,
    research: { ...world.planets[4]!.research, sensors: 2 },
  });
  world = withTeam(world, 1, { fund: { metal: 400, crystal: 100, eonium: 0 } });
  world = tick(world);
  const board = viewFor(world, 0).scoreboard;
  // The same board for everybody.
  for (const id of world.planets.keys())
    assert.deepEqual(viewFor(world, id).scoreboard, board);

  assert.equal(board.players.length, world.planets.length);
  for (const [id, line] of board.players.entries()) {
    const planet = world.planets[id]!;
    assert.deepEqual(line, {
      planet: id,
      team: planet.team,
      score: planet.score,
      economy: planet.parts.economy,
      military: planet.parts.military,
      technology: planet.parts.technology,
      asteroids: totalOf(planet.asteroids),
    });
    assert.equal(line.economy + line.military + line.technology, line.score);
  }
  // What fighting earned is military, research is technology.
  assert.equal(board.players[4]!.military - board.players[1]!.military, 300);
  assert.equal(
    board.players[4]!.technology,
    2 * RULES.research.branches.sensors.value,
  );

  assert.deepEqual(
    board.teams.map((line) => [line.team, line.members]),
    [
      [0, [0, 2, 4]],
      [1, [1, 3, 5]],
    ],
  );
  for (const line of board.teams) {
    const team = world.teams[line.team]!;
    const sum = (
      key: "score" | "economy" | "military" | "technology" | "asteroids",
    ) =>
      line.members.reduce(
        (total, member) => total + board.players[member]![key],
        0,
      );
    const fund = stockValue(team.fund, RULES);
    assert.equal(line.score, sum("score") + fund);
    assert.equal(line.score, teamScore(team, world.planets, RULES));
    assert.equal(line.economy, sum("economy") + fund);
    assert.equal(line.military, sum("military"));
    assert.equal(line.technology, sum("technology"));
    assert.equal(line.asteroids, sum("asteroids"));
  }
  assert.equal(stockValue(world.teams[1]!.fund, RULES), 25);
  // Neutral planets are on the board under no team.
  assert.ok(
    board.players.filter((line) => line.team === NONE).length ===
      world.planets.filter((planet) => planet.kind === "neutral").length,
  );
});
