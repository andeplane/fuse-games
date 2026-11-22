import test from "node:test";
import assert from "node:assert/strict";
import {
  NONE,
  SETUP_2V2,
  SETUP_3V3,
  hashWorld,
  legalCommands,
  noShips,
  viewFor,
  type CommandOption,
  type GameEvent,
  type Policy,
  type Rules,
  type World,
} from "../src/engine/index.js";
import { createEconomyBot } from "../src/bots/economy-bot.js";
import { USAGE, parseArgs, wholeNumber } from "../src/cli/args.js";
import {
  runBotMatch,
  ticksPerSecond,
  type Clock,
} from "../src/cli/bot-match.js";
import { HELP, parseInput } from "../src/cli/input.js";
import { main } from "../src/cli/main.js";
import { playSession, type Terminal } from "../src/cli/play.js";
import {
  eventLine,
  optionLine,
  renderLegal,
  renderStandings,
  renderView,
} from "../src/cli/render.js";
import {
  RICH,
  RULES,
  from,
  idle,
  start,
  tick,
  withPlanet,
  withTeam,
} from "./support.js";

/** A terminal that types the given lines and keeps what it is shown. */
function scripted(lines: readonly string[]) {
  const left = [...lines];
  const shown: string[] = [];
  const prompts: string[] = [];
  const terminal: Terminal = {
    readLine(prompt) {
      prompts.push(prompt);
      return Promise.resolve(left.shift());
    },
    write(text) {
      shown.push(text);
    },
  };
  return { terminal, shown, prompts, left };
}

/** A clock that moves on by a fixed step every time it is read. */
function stepping(milliseconds: number): Clock {
  let now = 1000;
  return {
    now() {
      now += milliseconds;
      return now;
    },
  };
}

const error = (message: string) => ({ mode: "error", message });

test("the command line picks a mode, and help when there is none", () => {
  for (const argv of [[], ["help"], ["--help"], ["-h"], ["help", "--seed"]])
    assert.deepEqual(parseArgs(argv, RULES), { mode: "help" });
  assert.deepEqual(parseArgs(["serve"], RULES), error('unknown mode "serve"'));

  const bots = parseArgs(["bots"], RULES);
  assert.deepEqual(bots, {
    mode: "bots",
    matches: 1,
    seed: 1,
    setup: SETUP_2V2,
    rules: RULES,
  });
  assert.ok(bots.mode === "bots" && bots.rules === RULES);
  assert.deepEqual(parseArgs(["play"], RULES), {
    mode: "play",
    seat: 0,
    seed: 1,
    setup: SETUP_2V2,
    rules: RULES,
  });
});

test("the command line's options set the seed, the size, the length and the seat", () => {
  assert.deepEqual(
    parseArgs(
      [
        "bots",
        "--seed",
        "7",
        "--mode",
        "3v3",
        "--neutrals",
        "0",
        "--ticks",
        "50",
        "--matches",
        "3",
      ],
      RULES,
    ),
    {
      mode: "bots",
      matches: 3,
      seed: 7,
      setup: { teams: 2, teamSize: 3, neutrals: 0 },
      rules: { ...RULES, match: { tickLimit: 50 } },
    },
  );
  assert.deepEqual(parseArgs(["play", "--mode", "3v3", "--seat", "5"], RULES), {
    mode: "play",
    seat: 5,
    seed: 1,
    setup: SETUP_3V3,
    rules: RULES,
  });
  assert.deepEqual(
    parseArgs(["play", "--mode", "2v2", "--seat", "3", "--seed", "0"], RULES),
    { mode: "play", seat: 3, seed: 0, setup: SETUP_2V2, rules: RULES },
  );
  // The last of a repeated option wins.
  assert.deepEqual(parseArgs(["bots", "--seed", "3", "--seed", "4"], RULES), {
    mode: "bots",
    matches: 1,
    seed: 4,
    setup: SETUP_2V2,
    rules: RULES,
  });
});

test("a command line that cannot be read says what is wrong with it", () => {
  const cases: readonly (readonly [readonly string[], string])[] = [
    [["bots", "seed", "1"], 'unknown option "seed"'],
    [["bots", "--speed", "1"], 'unknown option "--speed"'],
    [["bots", "--seed"], "--seed needs a value"],
    [["play", "--seat", "1", "--ticks"], "--ticks needs a value"],
    [["bots", "--seed", "abc"], "--seed must be a whole number of 0 or more"],
    [["bots", "--seed", "-1"], "--seed must be a whole number of 0 or more"],
    [["bots", "--ticks", "1.5"], "--ticks must be a whole number of 0 or more"],
    [["bots", "--mode", "4v4"], "--mode must be 2v2 or 3v3"],
    [["bots", "--neutrals", "13"], "a match has 0 to 12 neutral planets"],
    [["bots", "--ticks", "0"], "--ticks must be at least 1"],
    [["bots", "--seat", "1"], "--seat is for play"],
    [["bots", "--matches", "0"], "--matches must be at least 1"],
    [["play", "--matches", "2"], "--matches is for bots"],
    [["play", "--seat", "4"], "--seat must be below 4"],
    [["play", "--mode", "3v3", "--seat", "6"], "--seat must be below 6"],
  ];
  for (const [argv, message] of cases)
    assert.deepEqual(parseArgs(argv, RULES), error(message), argv.join(" "));
});

test("a whole number is digits and nothing else", () => {
  assert.equal(wholeNumber("0"), 0);
  assert.equal(wholeNumber("42"), 42);
  assert.equal(wholeNumber("007"), 7);
  assert.equal(wholeNumber("999999999999999"), 999999999999999);
  for (const text of [
    "",
    "-1",
    "1.5",
    "1e3",
    " 1",
    "1 ",
    "0x10",
    "1234567890123456",
  ])
    assert.equal(wholeNumber(text), undefined, text);
});

test("a typed line is read into the command it names", () => {
  const command = (line: string) => {
    const input = parseInput(line);
    assert.equal(input.kind, "command", line);
    return input.kind === "command" ? input.command : undefined;
  };
  assert.deepEqual(command("roid metal"), {
    type: "initiateAsteroid",
    resource: "metal",
  });
  assert.deepEqual(command("  build   shipyard  "), {
    type: "buildStructure",
    structure: "shipyard",
  });
  assert.deepEqual(command("research jamming"), {
    type: "startResearch",
    branch: "jamming",
  });
  assert.deepEqual(command("ships corvette 12"), {
    type: "produceShips",
    shipClass: "corvette",
    count: 12,
  });
  assert.deepEqual(command("launch observe 1 fighter=2 cruiser=1"), {
    type: "launchFleet",
    mission: "observe",
    target: 1,
    ships: { fighter: 2, cruiser: 1 },
  });
  assert.deepEqual(command("launch defend 2"), {
    type: "launchFleet",
    mission: "defend",
    target: 2,
    ships: {},
  });
  assert.deepEqual(command("launch attack 1 fighter=1"), {
    type: "launchFleet",
    mission: "attack",
    target: 1,
    ships: { fighter: 1 },
  });
  assert.deepEqual(command("recall 7"), { type: "recallFleet", fleet: 7 });
  assert.deepEqual(command("vote 2"), { type: "voteCommander", candidate: 2 });
  assert.deepEqual(command("tax 15"), { type: "setTax", percent: 15 });
  assert.deepEqual(command("grant 2 metal=5 eonium=1"), {
    type: "grant",
    to: 2,
    resources: { metal: 5, eonium: 1 },
  });
  assert.deepEqual(command("priority 2"), {
    type: "setDefencePriority",
    planet: 2,
  });
  assert.deepEqual(command("priority none"), {
    type: "setDefencePriority",
    planet: NONE,
  });
  assert.deepEqual(command("donate crystal=10"), {
    type: "donate",
    resources: { crystal: 10 },
  });
  // Numbers the engine will refuse are still commands: the engine says why.
  assert.deepEqual(command("tax -5"), { type: "setTax", percent: -5 });
  assert.deepEqual(command("donate"), { type: "donate", resources: {} });
});

test("a typed line may be for the client instead, or nothing, or not understood", () => {
  assert.deepEqual(parseInput(""), { kind: "nothing" });
  assert.deepEqual(parseInput("   \t "), { kind: "nothing" });
  for (const kind of ["view", "legal", "help", "quit"] as const)
    assert.deepEqual(parseInput(` ${kind} now`), { kind });
  assert.deepEqual(parseInput("next"), { kind: "next", ticks: 1 });
  assert.deepEqual(parseInput("next 25"), { kind: "next", ticks: 25 });
  for (const line of ["next 0", "next -3", "next soon", "next 1.5"])
    assert.deepEqual(parseInput(line), {
      kind: "error",
      message: "next takes a number of ticks, 1 or more",
    });

  const cases: readonly (readonly [string, string])[] = [
    ["dance", '"dance" is not a command; type help for the list'],
    ["ROID metal", '"ROID" is not a command; type help for the list'],
    ["roid gold", "the command's resource is missing or malformed"],
    ["roid", "the command's resource is missing or malformed"],
    ["build", "the command's structure is missing or malformed"],
    ["research warp", "the command's branch is missing or malformed"],
    ["ships fighter", "the command's count is missing or malformed"],
    ["ships fighter many", "the command's count is missing or malformed"],
    ["ships titan 1", "the command's shipClass is missing or malformed"],
    [
      "launch raid 1 fighter=1",
      "the command's mission is missing or malformed",
    ],
    [
      "launch observe x fighter=1",
      "the command's target is missing or malformed",
    ],
    ["launch observe 1 fighter", "the command's ships is missing or malformed"],
    [
      "launch observe 1 fighter=1=2",
      "the command's ships is missing or malformed",
    ],
    ["launch observe 1 =2", "the command's ships is missing or malformed"],
    ["launch observe 1 titan=2", "the command's ships is missing or malformed"],
    [
      "launch observe 1 fighter=two",
      "the command's ships is missing or malformed",
    ],
    ["recall", "the command's fleet is missing or malformed"],
    ["vote me", "the command's candidate is missing or malformed"],
    ["tax ten", "the command's percent is missing or malformed"],
    ["grant two metal=1", "the command's to is missing or malformed"],
    ["grant 2 metal", "the command's resources is missing or malformed"],
    ["priority", "the command's planet is missing or malformed"],
    ["donate gold=1", "the command's resources is missing or malformed"],
  ];
  for (const [line, message] of cases)
    assert.deepEqual(parseInput(line), { kind: "error", message }, line);
});

test("every event has its line", () => {
  const cases: readonly (readonly [GameEvent, string])[] = [
    [
      { type: "rejected", player: 0, command: "setTax", reason: "no" },
      "refused setTax: no",
    ],
    [
      { type: "asteroidInitiated", player: 3, resource: "eonium" },
      "planet 3 mines a new eonium asteroid",
    ],
    [
      { type: "structureBuilt", player: 0, structure: "researchLab" },
      "planet 0 finished a researchLab",
    ],
    [
      { type: "researchDone", player: 2, branch: "hulls", level: 3 },
      "planet 2 reached hulls level 3",
    ],
    [
      { type: "shipsBuilt", player: 2, shipClass: "frigate", count: 4 },
      "planet 2 produced 4 frigate",
    ],
    [
      {
        type: "fleetArrived",
        player: 2,
        fleet: 9,
        target: 0,
        mission: "defend",
      },
      "fleet 9 of planet 2 arrived at planet 0 to defend",
    ],
    [
      { type: "fleetReturned", player: 0, fleet: 9 },
      "fleet 9 of planet 0 came home",
    ],
    [
      { type: "commanderChanged", team: 1, commander: 3 },
      "team 1's commander is now planet 3",
    ],
    [
      { type: "commanderChanged", team: 1, commander: NONE },
      "team 1's commander is now none",
    ],
    [{ type: "matchEnded", winner: 0 }, "the match ended: team 0 wins"],
    [{ type: "matchEnded", winner: NONE }, "the match ended in a draw"],
  ];
  for (const [event, line] of cases) assert.equal(eventLine(event), line);
});

test("the view at the start, as the terminal shows it", () => {
  assert.equal(
    renderView(viewFor(start(), 0), RULES),
    [
      "Tick 0/2400 · planet 0 · team 0 · score 550",
      "Resources    metal 800  crystal 800  eonium 400",
      "Income/tick  metal 14  crystal 14  eonium 10",
      "Asteroids    metal 1  crystal 1  eonium 1",
      "Structures   none",
      "Research     none",
      "Ships home   none",
      "Team 0       commander none · tax 0% · defence priority none",
      "Fund         metal 0  crystal 0  eonium 0",
      "Ally 2       score 550 · metal 800  crystal 800  eonium 400 · ships none",
      "Planets      id  kind     team     x     y   score",
      "              0 seat       0   180   410     550  (you)",
      "              1 seat       1   820   410     550",
      "              2 seat       0   110   560     550",
      "              3 seat       1   750   560     550",
      "              4 neutral    -   196   877    1850",
      "              5 neutral    -   342   720    1550",
      "              6 neutral    -   742    84    1400",
      "              7 neutral    -   271   507    1400",
      "              8 neutral    -   776   772    1250",
      "              9 neutral    -   708   910    1100",
    ].join("\n"),
  );
  const neutral = renderView(viewFor(start(), 4), RULES).split("\n");
  assert.equal(neutral[0], "Tick 0/2400 · planet 4 · score 1850");
  assert.equal(neutral[2], "Income/tick  metal 15  crystal 11  eonium 11");
  assert.ok(!neutral.some((line) => /^(Team|Fund|Ally)/.test(line)));
});

/** A view with something on every line the terminal can show. */
function busy(): World {
  let world = withTeam(start(), 0, {
    commander: 2,
    votes: [2, 2],
    taxPercent: 25,
    defencePriority: 0,
    fund: { metal: 5, crystal: 6, eonium: 7 },
  });
  world = withPlanet(world, 0, {
    structures: {
      ...world.planets[0]!.structures,
      researchLab: 1,
      shipyard: 2,
    },
    research: { ...world.planets[0]!.research, hulls: 2, mining: 1 },
    ships: { ...noShips(), fighter: 3, frigate: 1 },
    construction: [
      { structure: "metalRefinery", remaining: 1 },
      { structure: "shipyard", remaining: 45 },
    ],
    researchQueue: [
      { branch: "sensors", level: 1, remaining: 12 },
      { branch: "sensors", level: 2, remaining: 70 },
    ],
    production: [
      { shipClass: "fighter", count: 5, remaining: 1 },
      { shipClass: "frigate", count: 2, remaining: 30 },
    ],
  });
  world = withPlanet(world, 2, {
    ships: { ...noShips(), corvette: 4 },
  });
  return {
    ...world,
    tick: 300,
    fleets: [
      {
        id: 4,
        owner: 0,
        mission: "observe",
        target: 1,
        ships: { ...noShips(), fighter: 1 },
        phase: "outbound",
        eta: 1,
        travelTicks: 37,
      },
      {
        id: 6,
        owner: 2,
        mission: "defend",
        target: 0,
        ships: { ...noShips(), corvette: 2, cruiser: 1 },
        phase: "stationed",
        eta: 80,
        travelTicks: 19,
      },
    ],
    knowledge: world.knowledge.map((known, id) =>
      id === 0
        ? {
            reports: [
              {
                target: 1,
                tick: 250,
                by: 0,
                detail: 1,
                resources: { metal: 10, crystal: 20, eonium: 30 },
                asteroids: { metal: 4, crystal: 5, eonium: 6 },
                structures: null,
                research: null,
                ships: null,
              },
              {
                target: 3,
                tick: 280,
                by: 0,
                detail: 3,
                resources: { metal: 1, crystal: 2, eonium: 3 },
                asteroids: { metal: 7, crystal: 8, eonium: 9 },
                structures: {
                  ...world.planets[3]!.structures,
                  shipyard: 1,
                },
                research: world.planets[3]!.research,
                ships: { ...noShips(), destroyer: 2 },
              },
            ],
          }
        : known,
    ),
    events: [
      { type: "shipsBuilt", player: 0, shipClass: "fighter", count: 3 },
      { type: "rejected", player: 0, command: "setTax", reason: "why" },
    ],
  };
}

test("a busy view shows queues, the team, fleets, reports and events", () => {
  const lines = renderView(viewFor(busy(), 0), RULES).split("\n");
  for (const line of [
    "Tick 300/2400 · planet 0 · team 0 · score 550",
    // 14 metal, 4 of it from an asteroid that mining level 1 makes 4.4, whole: 14; a quarter goes in tax.
    "Income/tick  metal 11  crystal 11  eonium 8",
    "Structures   researchLab 1  shipyard 2",
    "Research     hulls 2  mining 1",
    "Ships home   fighter 3  frigate 1",
    "Building     metalRefinery (1 tick), shipyard (queued)",
    "Researching  sensors 1 (12 ticks), sensors 2 (queued)",
    "Producing    5 fighter (1 tick), 2 frigate (30 ticks)",
    "Team 0       commander planet 2 · tax 25% · defence priority planet 0",
    "Fund         metal 5  crystal 6  eonium 7",
    "Ally 2       score 550 · metal 800  crystal 800  eonium 400 · ships corvette 4",
    "Fleet 4      planet 0 to observe planet 1, outbound, 1 tick: fighter 1",
    "Fleet 6      planet 2 to defend planet 0, stationed, 80 ticks: corvette 2  cruiser 1",
    "Report       planet 1 at tick 250 by planet 0: metal 10  crystal 20  eonium 30 · asteroids metal 4  crystal 5  eonium 6",
    "Report       planet 3 at tick 280 by planet 0: metal 1  crystal 2  eonium 3 · asteroids metal 7  crystal 8  eonium 9 · structures shipyard 1 · research none · ships destroyer 2",
    "Event        planet 0 produced 3 fighter",
    "Event        refused setTax: why",
  ])
    assert.ok(lines.includes(line), `${line}\n--- in ---\n${lines.join("\n")}`);
  assert.ok(!lines.some((line) => line.startsWith("Result")));

  const ended = renderView(
    viewFor(idle(start(), RULES.match.tickLimit), 0),
    RULES,
  ).split("\n");
  assert.deepEqual(ended.slice(-2), [
    "Event        the match ended in a draw",
    "Result       a draw · team scores 10220 / 10220",
  ]);
  const won = tick(
    idle(
      tick(start(), from(1, { type: "initiateAsteroid", resource: "metal" })),
      RULES.match.tickLimit - 2,
    ),
  );
  assert.match(
    renderView(viewFor(won, 0), RULES).split("\n").at(-1)!,
    /^Result {7}team 1 wins · team scores \d+ \/ \d+$/,
  );
});

test("each option is shown as the command to type for it", () => {
  const cases: readonly (readonly [CommandOption, string])[] = [
    [
      {
        type: "initiateAsteroid",
        resource: "metal",
        cost: { metal: 75, crystal: 75, eonium: 0 },
      },
      "roid metal   (metal 75  crystal 75)",
    ],
    [
      {
        type: "buildStructure",
        structure: "researchLab",
        cost: { metal: 400, crystal: 400, eonium: 100 },
        ticks: 45,
      },
      "build researchLab   (metal 400  crystal 400  eonium 100, 45 ticks)",
    ],
    [
      {
        type: "startResearch",
        branch: "mining",
        level: 2,
        cost: { metal: 480, crystal: 480, eonium: 160 },
        ticks: 84,
      },
      "research mining   (level 2: metal 480  crystal 480  eonium 160, 84 ticks)",
    ],
    [
      {
        type: "produceShips",
        shipClass: "fighter",
        maxCount: 22,
        unitCost: { metal: 60, crystal: 20, eonium: 0 },
        ticks: 1,
      },
      "ships fighter <1-22>   (each metal 60  crystal 20, 1 tick)",
    ],
    [
      {
        type: "launchFleet",
        mission: "defend",
        target: 2,
        maxShips: { ...noShips(), fighter: 3, cruiser: 1 },
      },
      "launch defend 2 <ships>   (up to fighter=3 cruiser=1)",
    ],
    [{ type: "recallFleet", fleet: 4 }, "recall 4"],
    [{ type: "voteCommander", candidate: 2 }, "vote 2"],
    [{ type: "setTax", maxPercent: 30 }, "tax <0-30>"],
    [
      { type: "grant", to: 2, max: { metal: 0, crystal: 9, eonium: 1 } },
      "grant 2 <amounts>   (up to crystal=9 eonium=1)",
    ],
    [{ type: "setDefencePriority", planet: 2 }, "priority 2"],
    [{ type: "setDefencePriority", planet: NONE }, "priority none"],
    [
      { type: "donate", max: RICH },
      "donate <amounts>   (up to metal=1000000 crystal=1000000 eonium=1000000)",
    ],
  ];
  for (const [option, line] of cases) assert.equal(optionLine(option), line);
  assert.equal(
    renderLegal(cases.slice(5, 8).map(([option]) => option)),
    "  recall 4\n  vote 2\n  tax <0-30>",
  );
  assert.equal(renderLegal([]), "Nothing can be done now.");
  // What the list shows can be typed back as it stands.
  for (const option of legalCommands(viewFor(start(), 0), RULES)) {
    const typed = optionLine(option).split("   ")[0]!;
    if (!typed.includes("<"))
      assert.equal(parseInput(typed).kind, "command", typed);
  }
});

test("the standings name the result, each team and every planet", () => {
  assert.equal(
    renderStandings(busy(), RULES),
    [
      "Stopped at tick 300, no result",
      "Team 0  score 1100  commander planet 2  tax 25%  fund metal 5  crystal 6  eonium 7",
      "  planet  0  score     550  asteroids   3  structures  3  research  3  ships fighter 3  frigate 1",
      "  planet  2  score     550  asteroids   3  structures  0  research  0  ships corvette 4",
      "Team 1  score 1100  commander none  tax 0%  fund metal 0  crystal 0  eonium 0",
      "  planet  1  score     550  asteroids   3  structures  0  research  0  ships none",
      "  planet  3  score     550  asteroids   3  structures  0  research  0  ships none",
      "Neutral planets",
      "  planet  4  score    1850  asteroids  12  structures  0  research  0  ships none",
      "  planet  5  score    1550  asteroids  10  structures  0  research  0  ships none",
      "  planet  6  score    1400  asteroids   9  structures  0  research  0  ships none",
      "  planet  7  score    1400  asteroids   9  structures  0  research  0  ships none",
      "  planet  8  score    1250  asteroids   8  structures  0  research  0  ships none",
      "  planet  9  score    1100  asteroids   7  structures  0  research  0  ships none",
    ].join("\n"),
  );
  const duel = { teams: 2, teamSize: 1, neutrals: 0 };
  const one: Rules = { ...RULES, match: { tickLimit: 1 } };
  const draw = renderStandings(tick(start(1, duel), [], one), one).split("\n");
  assert.equal(draw[0], "Result: a draw after 1 tick");
  assert.equal(draw.length, 5);
  assert.ok(!draw.includes("Neutral planets"));
  const won = tick(
    start(1, duel),
    from(1, { type: "initiateAsteroid", resource: "metal" }),
    one,
  );
  assert.equal(
    renderStandings(won, one).split("\n")[0],
    "Result: team 1 wins after 1 tick",
  );
  assert.equal(
    renderStandings(idle(start(), 2400), RULES).split("\n")[0],
    "Result: a draw after 2400 ticks",
  );
});

test("a bot match is timed by the clock it is given, and checked against its own replay", () => {
  const short: Rules = { ...RULES, match: { tickLimit: 60 } };
  const result = runBotMatch({
    seed: 3,
    setup: SETUP_2V2,
    rules: short,
    policy: createEconomyBot(),
    clock: stepping(250),
  });
  assert.equal(result.ticks, 60);
  assert.equal(result.milliseconds, 250);
  assert.equal(result.world.phase, "ended");
  assert.equal(result.hash, hashWorld(result.world));
  assert.equal(result.replayMatches, true);
  assert.equal(result.rejected, 0);
  assert.ok(result.commands > 50);

  // Refusals are counted, whoever the bot is.
  const unruly: Policy = () => [{ type: "setTax", percent: 5 }];
  const refused = runBotMatch({
    seed: 3,
    setup: SETUP_2V2,
    rules: { ...RULES, match: { tickLimit: 5 } },
    policy: unruly,
    clock: stepping(1),
  });
  assert.equal(refused.commands, 50);
  assert.equal(refused.rejected, 50);
  assert.equal(refused.replayMatches, true);
});

test("ticks a second is a whole number, and nothing when no time passed", () => {
  assert.equal(ticksPerSecond(2400, 125), 19200);
  assert.equal(ticksPerSecond(1, 3), 333);
  assert.equal(ticksPerSecond(2400, 0), 0);
  assert.equal(ticksPerSecond(0, 10), 0);
});

test("the client prints its usage for help, and with the problem for a command line it cannot read", async () => {
  const help = scripted([]);
  assert.equal(await main(["help"], { ...help, clock: stepping(1) }), 0);
  assert.deepEqual(help.shown, [USAGE]);
  const wrong = scripted([]);
  assert.equal(
    await main(["bots", "--ticks", "0"], { ...wrong, clock: stepping(1) }),
    2,
  );
  assert.deepEqual(wrong.shown, [`--ticks must be at least 1\n\n${USAGE}`]);
  assert.match(USAGE, /pnpm galaxy bots/);
  assert.match(USAGE, /pnpm galaxy play/);
});

test("the client plays bot matches and reports their speed", async () => {
  const one = scripted([]);
  assert.equal(
    await main(["bots", "--ticks", "30", "--seed", "4"], {
      ...one,
      clock: stepping(10),
    }),
    0,
  );
  assert.equal(one.shown.length, 3);
  assert.equal(
    one.shown[0],
    "Fuse Galaxy · seed 4 · 2 teams of 2 + 6 neutral planets · rules v1",
  );
  assert.match(
    one.shown[1]!,
    /^Result: (team \d wins|a draw) after 30 ticks\n/,
  );
  assert.match(
    one.shown[2]!,
    /^Commands: \d+ sent, 0 refused\nWorld hash: [0-9a-f]{16} · replay from the log matches\nSpeed: 30 ticks in 10\.0 ms = 3000 ticks\/second$/,
  );
  assert.deepEqual(one.prompts, []);

  const three = scripted([]);
  assert.equal(
    await main(
      [
        "bots",
        "--ticks",
        "30",
        "--seed",
        "4",
        "--matches",
        "3",
        "--mode",
        "3v3",
      ],
      { ...three, clock: stepping(10) },
    ),
    0,
  );
  assert.equal(three.shown.length, 10);
  assert.deepEqual(
    [0, 3, 6].map((index) => three.shown[index]),
    [4, 5, 6].map(
      (seed) =>
        `Fuse Galaxy · seed ${seed} · 2 teams of 3 + 6 neutral planets · rules v1`,
    ),
  );
  for (const index of [2, 5, 8])
    assert.match(
      three.shown[index]!,
      /\nSpeed: 30 ticks in 10\.0 ms = 3000 ticks\/second$/,
    );
  assert.equal(
    three.shown[9],
    "Total: 3 matches, 90 ticks in 30.0 ms = 3000 ticks/second",
  );
});

test("a session ends when the input does, or when the player quits", async () => {
  const options = {
    seed: 1,
    setup: SETUP_2V2,
    rules: RULES,
    seat: 0,
    policy: createEconomyBot(),
  };
  const silent = scripted([]);
  const world = await playSession({ ...options, terminal: silent.terminal });
  assert.equal(world.tick, 0);
  assert.deepEqual(silent.prompts, ["tick 0> "]);
  assert.equal(silent.shown.length, 3);
  assert.equal(silent.shown[0], HELP);
  assert.equal(silent.shown[1], renderView(viewFor(start(), 0), RULES));
  assert.equal(silent.shown[2], renderStandings(start(), RULES));

  const leaving = scripted(["next 2", "quit", "next 5"]);
  const left = await playSession({ ...options, terminal: leaving.terminal });
  assert.equal(left.tick, 2);
  assert.deepEqual(leaving.prompts, ["tick 0> ", "tick 2> "]);
  assert.deepEqual(leaving.left, ["next 5"]);
  assert.match(leaving.shown.at(-1)!, /^Stopped at tick 2, no result\n/);
});

test("a session queues what the player types for the next tick and says what it cannot do", async () => {
  const rules: Rules = { ...RULES, match: { tickLimit: 70 } };
  const { terminal, shown, prompts } = scripted([
    "",
    "help",
    "dance",
    "tax 5",
    "roid metal",
    "vote 0",
    "build shipyard",
    "legal",
    "next",
    "view",
    "next 3",
    "next 60",
    "tax 5",
    "ships fighter 2000",
    "next 1000",
    "never read",
  ]);
  const world = await playSession({
    seed: 1,
    setup: SETUP_2V2,
    rules,
    seat: 0,
    policy: createEconomyBot(),
    terminal,
  });
  assert.equal(world.phase, "ended");
  assert.equal(world.tick, 70);
  assert.deepEqual(prompts, [
    ...Array.from({ length: 9 }, () => "tick 0> "),
    "tick 1> ",
    "tick 1> ",
    "tick 4> ",
    "tick 64> ",
    "tick 64> ",
    "tick 64> ",
  ]);

  const after = (index: number) => shown[index]!;
  // 0 help, 1 the first view; the empty line shows nothing.
  assert.equal(after(2), HELP);
  assert.equal(
    after(3),
    'Not understood: "dance" is not a command; type help for the list',
  );
  assert.equal(
    after(4),
    "Cannot do that: only the team's commander can do that",
  );
  assert.equal(after(5), "Queued for the next tick: initiateAsteroid");
  assert.equal(after(6), "Queued for the next tick: voteCommander");
  assert.equal(after(7), "Queued for the next tick: buildStructure");
  // The list is of what can be done now, not after what is queued.
  assert.equal(
    after(8),
    renderLegal(legalCommands(viewFor(start(), 0), RULES)),
  );
  const first = after(9).split("\n");
  assert.equal(first[0], "Tick 1/70 · planet 0 · team 0 · score 649");
  assert.equal(first[1], "Resources    metal 243  crystal 439  eonium 310");
  assert.ok(first.includes("Building     shipyard (44 ticks)"));
  assert.ok(first.includes("Event        planet 0 mines a new metal asteroid"));
  assert.ok(first.includes("Event        team 0's commander is now planet 0"));
  assert.equal(after(10), after(9));
  assert.match(after(11), /^Tick 4\/70 /);
  // What happened on the ticks that went by unseen is listed before the view.
  assert.equal(
    after(12),
    "Tick 45: planet 0 finished a shipyard\nTick 63: planet 2 finished a researchLab",
  );
  assert.match(after(13), /^Tick 64\/70 /);
  assert.equal(after(14), "Queued for the next tick: setTax");
  assert.equal(after(15), "Cannot do that: an order holds at most 1000 ships");
  assert.match(after(16), /^Tick 70\/70 /);
  assert.ok(after(16).includes("\nResult       team 1 wins"));
  assert.match(after(17), /^Result: team 1 wins after 70 ticks\n/);
  assert.equal(shown.length, 18);

  // The seat was the player's alone: the bots played every planet but that one.
  assert.equal(world.teams[0]!.taxPercent, 5);
  assert.deepEqual(world.planets[0]!.asteroids, {
    metal: 2,
    crystal: 1,
    eonium: 1,
  });
  assert.ok(world.planets[2]!.asteroids.metal > 2);
});

test("the client's play mode takes the seat asked for", async () => {
  const session = scripted(["legal", "next 3"]);
  assert.equal(
    await main(["play", "--seat", "3", "--ticks", "3", "--seed", "8"], {
      ...session,
      clock: stepping(1),
    }),
    0,
  );
  assert.match(
    session.shown[1]!,
    /^Tick 0\/3 · planet 3 · team 1 · score 550\n/,
  );
  assert.ok(session.shown[2]!.includes("  vote 1\n  vote 3\n"));
  assert.match(session.shown[3]!, /^Tick 3\/3 · planet 3 /);
  assert.match(session.shown[4]!, /^Result: /);
  assert.deepEqual(session.prompts, ["tick 0> ", "tick 0> "]);
});
