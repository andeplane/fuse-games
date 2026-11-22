import test from "node:test";
import assert from "node:assert/strict";
import {
  NONE,
  SETUP_3V3,
  teamScore,
  type Command,
  type Rules,
  type Team,
} from "../src/engine/index.js";
import { electCommander } from "../src/engine/orders.js";
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
  withTeam,
} from "./support.js";

const vote = (candidate: number): Command => ({
  type: "voteCommander",
  candidate,
});

const team = (votes: number[], commander = NONE): Team => ({
  id: 0,
  members: [0, 2, 4],
  fund: { metal: 0, crystal: 0, eonium: 0 },
  taxPercent: 0,
  commander,
  votes,
  defencePriority: NONE,
});

test("the commander is the member with the most votes", () => {
  assert.equal(electCommander(team([NONE, NONE, NONE])), NONE);
  assert.equal(electCommander(team([NONE, NONE, NONE], 2)), NONE);
  assert.equal(electCommander(team([NONE, 4, NONE])), 4);
  assert.equal(electCommander(team([2, 2, 0], 0)), 2);
  assert.equal(electCommander(team([4, 4, 4], 0)), 4);
});

test("when votes are level the sitting commander stays, and otherwise the lowest planet takes the post", () => {
  assert.equal(electCommander(team([0, 2, 4], 4)), 4);
  assert.equal(electCommander(team([0, 2, 4], 2)), 2);
  assert.equal(electCommander(team([0, 2, 4])), 0);
  assert.equal(electCommander(team([4, 2, NONE])), 2);
  assert.equal(electCommander(team([4, 2, NONE], 0)), 2);
  // A commander nobody votes for any more does not keep the post on a tie between others.
  assert.equal(electCommander(team([NONE, 4, 2], 0)), 2);
});

test("the first vote on a team makes a commander, and the team is told when the post changes hands", () => {
  let world = tick(start(), from(2, vote(2)));
  assert.equal(world.teams[0]!.commander, 2);
  assert.deepEqual(world.teams[0]!.votes, [NONE, 2]);
  assert.deepEqual(eventsOf(world, "commanderChanged"), [
    { type: "commanderChanged", team: 0, commander: 2 },
  ]);
  assert.equal(world.teams[1]!.commander, NONE);

  // One vote each: level, so the sitting commander stays and nothing is announced.
  world = tick(world, from(0, vote(0)));
  assert.equal(world.teams[0]!.commander, 2);
  assert.deepEqual(world.teams[0]!.votes, [0, 2]);
  assert.deepEqual(eventsOf(world, "commanderChanged"), []);

  // The commander gives the post away with their own vote.
  world = tick(world, from(2, vote(0)));
  assert.equal(world.teams[0]!.commander, 0);
  assert.deepEqual(eventsOf(world, "commanderChanged"), [
    { type: "commanderChanged", team: 0, commander: 0 },
  ]);
  // Voting the same way again changes nothing.
  world = tick(world, from(2, vote(0)));
  assert.deepEqual(world.events, []);
});

test("in a team of three a majority unseats the commander", () => {
  let world = start(1, SETUP_3V3);
  assert.deepEqual(world.teams[0]!.members, [0, 2, 4]);
  assert.deepEqual(world.teams[1]!.members, [1, 3, 5]);
  world = tick(world, [...from(0, vote(0)), ...from(3, vote(5))]);
  assert.equal(world.teams[0]!.commander, 0);
  assert.equal(world.teams[1]!.commander, 5);
  world = tick(world, from(2, vote(4)));
  assert.equal(world.teams[0]!.commander, 0);
  world = tick(world, from(4, vote(4)));
  assert.equal(world.teams[0]!.commander, 4);
  assert.deepEqual(world.teams[0]!.votes, [0, 4, 4]);
  // The old commander's powers went with the post.
  assert.equal(
    refusal(world, 0, { type: "setTax", percent: 5 }),
    "only the team's commander can do that",
  );
  assert.equal(refusal(world, 4, { type: "setTax", percent: 5 }), undefined);
});

test("a vote is for a member of the voter's own team", () => {
  const world = start();
  for (const candidate of [1, 3, 4, NONE, 99, 0.5])
    assert.equal(
      refusal(world, 0, vote(candidate)),
      "the candidate is not on the team",
    );
  assert.equal(refusal(world, 0, vote(0)), undefined);
  assert.equal(refusal(world, 0, vote(2)), undefined);
});

test("a neutral planet has no team to vote in, lead or give to", () => {
  const world = start();
  const commands: readonly Command[] = [
    vote(4),
    { type: "setTax", percent: 0 },
    { type: "grant", to: 4, resources: { metal: 1 } },
    { type: "setDefencePriority", planet: 4 },
    { type: "donate", resources: { metal: 1 } },
  ];
  for (const command of commands)
    assert.equal(
      refusal(world, 4, command),
      "a neutral planet has no team",
      command.type,
    );
});

const led = () => withTeam(start(), 0, { commander: 2, votes: [NONE, 2] });

test("only the commander sets the tax, within the rules' limit, and it applies from the same tick", () => {
  const tax = (percent: number): Command => ({ type: "setTax", percent });
  assert.equal(
    refusal(led(), 0, tax(10)),
    "only the team's commander can do that",
  );
  assert.equal(
    refusal(start(), 0, tax(10)),
    "only the team's commander can do that",
  );
  for (const percent of [31, -1, 2.5, Number.NaN, 100])
    assert.equal(
      refusal(led(), 2, tax(percent)),
      "tax must be a whole percentage from 0 to 30",
    );
  for (const percent of [0, 1, 30])
    assert.equal(refusal(led(), 2, tax(percent)), undefined);

  const world = tick(led(), from(2, tax(30)));
  assert.equal(world.teams[0]!.taxPercent, 30);
  // 30% of 14, 14 and 10 from each of the two members.
  assert.deepEqual(world.teams[0]!.fund, { metal: 8, crystal: 8, eonium: 6 });
  assert.deepEqual(world.planets[0]!.resources, {
    metal: 810,
    crystal: 810,
    eonium: 407,
  });
  assert.deepEqual(world.teams[1]!.fund, { metal: 0, crystal: 0, eonium: 0 });

  const lower: Rules = { ...RULES, team: { maxTaxPercent: 12 } };
  assert.equal(
    refusal(led(), 2, tax(13), lower),
    "tax must be a whole percentage from 0 to 12",
  );
});

test("any member can donate to the fund, and the team's score does not change by it", () => {
  const before = tick(start());
  const world = tick(
    start(),
    from(0, { type: "donate", resources: { metal: 300, eonium: 400 } }),
  );
  assert.deepEqual(world.teams[0]!.fund, {
    metal: 300,
    crystal: 0,
    eonium: 400,
  });
  assert.deepEqual(world.planets[0]!.resources, {
    metal: 500 + 14,
    crystal: 800 + 14,
    eonium: 10,
  });
  assert.equal(
    world.planets[0]!.value,
    before.planets[0]!.value - 700 / RULES.score.resourceDivisor,
  );
  assert.equal(
    teamScore(world.teams[0]!, world.planets, RULES),
    teamScore(before.teams[0]!, before.planets, RULES),
  );
});

test("a donation or a grant must be whole, more than nothing and no more than there is", () => {
  const donate = (
    resources: Partial<Record<"metal" | "crystal" | "eonium", number>>,
  ) => refusal(start(), 0, { type: "donate", resources });
  assert.equal(donate({ metal: 801 }), "not enough resources");
  assert.equal(
    donate({ metal: 800, crystal: 800, eonium: 401 }),
    "not enough resources",
  );
  assert.equal(donate({}), "there is nothing to transfer");
  assert.equal(donate({ metal: 0, eonium: 0 }), "there is nothing to transfer");
  for (const amount of [-1, 0.5, Number.NaN, Number.NEGATIVE_INFINITY])
    assert.equal(
      donate({ metal: 5, crystal: amount }),
      "amounts must be whole numbers of 0 or more",
    );
  assert.equal(donate({ metal: 800, crystal: 800, eonium: 400 }), undefined);

  const funded = withTeam(led(), 0, {
    fund: { metal: 50, crystal: 0, eonium: 7 },
  });
  const grant = (
    to: number,
    resources: Partial<Record<"metal" | "crystal" | "eonium", number>>,
  ) => refusal(funded, 2, { type: "grant", to, resources });
  assert.equal(grant(0, { metal: 51 }), "the fund does not hold that much");
  assert.equal(grant(0, { crystal: 1 }), "the fund does not hold that much");
  assert.equal(grant(0, {}), "there is nothing to transfer");
  assert.equal(
    grant(0, { eonium: -7 }),
    "amounts must be whole numbers of 0 or more",
  );
  for (const to of [1, 4, NONE, 99])
    assert.equal(grant(to, { metal: 1 }), "the recipient is not on the team");
  assert.equal(grant(0, { metal: 50, eonium: 7 }), undefined);
  assert.equal(grant(2, { metal: 1 }), undefined);
  assert.equal(
    refusal(funded, 0, { type: "grant", to: 0, resources: { metal: 1 } }),
    "only the team's commander can do that",
  );
});

test("the commander pays a member out of the fund", () => {
  const funded = withTeam(led(), 0, {
    fund: { metal: 50, crystal: 20, eonium: 7 },
  });
  const world = tick(
    funded,
    from(2, { type: "grant", to: 0, resources: { metal: 50, eonium: 3 } }),
  );
  assert.deepEqual(world.teams[0]!.fund, { metal: 0, crystal: 20, eonium: 4 });
  assert.deepEqual(world.planets[0]!.resources, {
    metal: 850 + 14,
    crystal: 800 + 14,
    eonium: 403 + 10,
  });
  assert.deepEqual(
    world.planets[2]!.resources,
    tick(start()).planets[2]!.resources,
  );

  // Donated and granted on in one tick: the fund is only passed through.
  const passed = tick(start(), [
    ...from(0, vote(2), { type: "donate", resources: { crystal: 100 } }),
    ...from(2, { type: "grant", to: 2, resources: { crystal: 100 } }),
  ]);
  assert.deepEqual(reasons(passed), []);
  assert.equal(passed.planets[0]!.resources.crystal, 700 + 14);
  assert.equal(passed.planets[2]!.resources.crystal, 900 + 14);
  assert.equal(passed.teams[0]!.fund.crystal, 0);
});

test("a transfer stops at the receiver's cap", () => {
  const capped: Rules = {
    ...RULES,
    limits: { ...RULES.limits, resourceCap: 1000 },
  };
  const funded = withTeam(led(), 0, {
    fund: { metal: 900, crystal: 0, eonium: 0 },
  });
  const granted = tick(
    funded,
    from(2, { type: "grant", to: 0, resources: { metal: 900 } }),
    capped,
  );
  assert.equal(granted.planets[0]!.resources.metal, 1000);
  assert.equal(granted.teams[0]!.fund.metal, 0);
  const donated = tick(
    funded,
    from(0, { type: "donate", resources: { metal: 500 } }),
    capped,
  );
  assert.equal(donated.teams[0]!.fund.metal, 1000);
  assert.equal(donated.planets[0]!.resources.metal, 314);
});

test("the commander flags one member's planet for defence, or none", () => {
  const flag = (planet: number): Command => ({
    type: "setDefencePriority",
    planet,
  });
  assert.equal(start().teams[0]!.defencePriority, NONE);
  assert.equal(
    refusal(led(), 0, flag(0)),
    "only the team's commander can do that",
  );
  for (const planet of [1, 3, 4, 99, -2, 0.5])
    assert.equal(
      refusal(led(), 2, flag(planet)),
      "the planet is not on the team",
    );

  let world = tick(led(), from(2, flag(0)));
  assert.deepEqual(reasons(world), []);
  assert.equal(world.teams[0]!.defencePriority, 0);
  assert.equal(world.teams[1]!.defencePriority, NONE);
  world = tick(world, from(2, flag(2)));
  assert.equal(world.teams[0]!.defencePriority, 2);
  world = tick(world, from(2, flag(NONE)));
  assert.deepEqual(reasons(world), []);
  assert.equal(world.teams[0]!.defencePriority, NONE);
});

test("tax, fund and flag stay as they are when the post changes hands", () => {
  let world = tick(
    led(),
    from(
      2,
      { type: "setTax", percent: 20 },
      { type: "setDefencePriority", planet: 0 },
    ),
  );
  world = idle(world, 5);
  const fund = world.teams[0]!.fund;
  world = tick(world, from(2, vote(0)));
  assert.equal(world.teams[0]!.commander, 0);
  assert.equal(world.teams[0]!.taxPercent, 20);
  assert.equal(world.teams[0]!.defencePriority, 0);
  assert.ok(world.teams[0]!.fund.metal > fund.metal);
  assert.equal(refusal(world, 0, { type: "setTax", percent: 0 }), undefined);
  // The team's planets are worth the same to it wherever the stock sits.
  assert.equal(
    withPlanet(world, 0, {}).teams[0]!.members.length,
    world.teams[0]!.members.length,
  );
});
