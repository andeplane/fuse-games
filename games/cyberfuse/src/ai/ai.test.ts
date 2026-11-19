import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseEnemyControl,
  createBrain,
  isBrain,
  COWARD,
  FOLLOWER,
  SNEAKY,
} from "./hostile.js";
import { botControls } from "./teammate.js";

test("v1.06 CommandBadGuys matches the independently compiled DOS cases in probe.c", () => {
  const visible = 256,
    detour = 32,
    right = 64,
    asleep = 128;
  const scenarios = [
    [10, 0, visible, 2, 0, 0, 0, 0, 80, 90, 40, 0, 0],
    [65, 0, visible, 2, 0, 0, 0, 0, 80, 90, 40, 0, 0],
    [85, 5, visible, 2, 0, 0, 0, 0, 80, 90, 40, 0, 0],
    [99, 0, 0, 2, 0, 0, 0, 0, 80, 90, 40, 0, 0],
    [65, 0, visible, 4, 1, 0, 0, 1, 80, 90, 40, 0, 0],
    [80, 0, visible | detour, 6, 1, 0, 2, 1, 0, 90, 0, 0, 0],
    [80, 0, visible | detour | right, 1, 0, 0, 1, 0, 0, 90, 0, 0, 0],
    [10, 0, visible | SNEAKY, 6, 0, 3, 0, 0, 0, 0, 0, 1, 0],
    [10, 0, visible | COWARD, 0, 0, 0, 0, 0, 80, 90, 0, 0, 0],
    [10, 0, visible, 6, 24, 3, 0, 0, 80, 90, 40, 0, 0],
    [10, 0, asleep, 2, 0, 0, 0, 0, 80, 90, 40, 0, 30],
    [10, 0, visible | FOLLOWER, 2, 0, 0, 0, 0, 80, 90, 0, 0, 0],
  ] as const;
  const expected = [
    [16, 2, 7, 0, 0, 1],
    [2, 2, 7, 0, 0, 1],
    [9, 2, 7, 0, 0, 2],
    [0, 2, 7, 0, 40, 1],
    [0, 5, 7, 1, 0, 1],
    [9, 5, 0, 3, 0, 1],
    [4, 0, 0, 0, 0, 1],
    [18, 6, 3, 0, 0, 1],
    [1, 0, 7, 0, 0, 1],
    [8, 6, 2, 0, 0, 1],
    [0, 2, 0, 0, 30, 0],
    [2, 2, 7, 0, 0, 1],
  ];
  const directions = [4, 6, 2, 10, 8, 9, 1, 5];
  scenarios.forEach(
    (
      [
        roll,
        extra,
        flags,
        dir,
        last,
        delay,
        turns,
        wall,
        track,
        move,
        shoot,
        retaliate,
        lock,
      ],
      i,
    ) => {
      const actor = {
        x: 32,
        y: 32,
        dir,
        hp: 50,
        lock,
        brain: {
          ...createBrain(Boolean(flags & asleep)),
          lastDir: directions.indexOf(last & 15),
          delay,
          turns,
          tryRight: !!(flags & right),
        },
      };
      const rolls = [roll, extra];
      let calls = 0;
      const decision = chooseEnemyControl(
        actor,
        [{ x: 64, y: 32, fire: !!retaliate, hp: 100 }],
        { move, track, shoot, delay: 7, flags },
        {
          visible: !!(flags & visible),
          goodGuysPresent: false,
          canStand: () => !wall,
          random: () => rolls[calls++]!,
        },
      );
      const { dx, dy, fire } = decision.control;
      const bits =
        (dx < 0 ? 1 : dx > 0 ? 2 : 0) |
        (dy < 0 ? 4 : dy > 0 ? 8 : 0) |
        (fire ? 16 : 0);
      assert.deepEqual(
        [
          bits,
          decision.dir,
          decision.brain.delay,
          decision.brain.turns,
          decision.lock,
          calls,
        ],
        expected[i],
        `probe row ${i}`,
      );
      assert.ok(isBrain(decision.brain));
      assert.equal(actor.brain.delay, delay);
    },
  );
});
test("restored brains reject invalid state", () => {
  assert.ok(isBrain(JSON.parse(JSON.stringify(createBrain()))));
  for (const patch of [
    { turns: 4 },
    { delay: -1 },
    { lastDir: 8 },
    { sleeping: 1 },
    { delay: Infinity },
    { rng: "untracked" },
  ])
    assert.equal(isBrain({ ...createBrain(), ...patch }), false);
});
function sample() {
  return {
    width: 7,
    height: 5,
    mode: "campaign",
    outcome: "playing",
    tiles: ["#######", "#..D.E#", "#.###.#", "#.....#", "#######"],
    seen: Array<string>(5).fill("1111111"),
    actors: [
      {
        x: 24,
        y: 18,
        seat: "bot:1" as string | null,
        role: "player",
        escort: null as string | null,
        hp: 100,
        dir: 2,
        lock: 0,
        weapon: 1,
        objectiveIndex: null as number | null,
        skill: { flags: 0 },
      },
    ],
    keys: [{ x: 24, y: 42 }],
    props: [] as {
      x: number;
      y: number;
      impassable: boolean;
      w: number;
      h: number;
    }[],
    keyring: [] as string[],
    doors: [{ x: 3, y: 1, key: "red", timer: 0 }],
    objectives: [] as { kind: string; done: number; required: number }[],
    items: [] as {
      x: number;
      y: number;
      kind: string;
      hp: number;
      solid: boolean;
      escort: string | null;
      objectiveIndex: number | null;
    }[],
  };
}
test("route to extraction respects a locked door; acquiring its key opens the shorter route", () => {
  const w = sample();
  assert.deepEqual(botControls(w, "bot:1"), {
    dx: 0,
    dy: 1,
    fire: false,
    special: false,
  });
  w.keyring.push("red");
  assert.deepEqual(botControls(w, "bot:1"), {
    dx: 1,
    dy: 0,
    fire: false,
    special: false,
  });
  w.actors[0]!.x = 88;
  assert.deepEqual(botControls(w, "bot:1"), {
    dx: 0,
    dy: 0,
    fire: false,
    special: false,
  });
});
test("an impassable prop deflects the extraction route until it is destroyed", () => {
  const w = sample();
  w.keyring.push("red");
  w.props.push({ x: 40, y: 18, w: 6, h: 5, impassable: true });
  assert.equal(botControls(w, "bot:1").dy, 1);
  w.props[0]!.impassable = false;
  assert.equal(botControls(w, "bot:1").dx, 1);
});
test("bot picks a reachable key to unlock a mission objective", () => {
  const w = sample();
  w.tiles[3] = "#.#####";
  w.objectives.push({ kind: "collect", done: 0, required: 1 });
  w.items.push({
    kind: "core",
    hp: 1,
    x: 88,
    y: 18,
    solid: false,
    escort: null,
    objectiveIndex: 0,
  });
  assert.equal(botControls(w, "bot:1").dy, 1);
  w.keyring.push("red");
  assert.equal(botControls(w, "bot:1").dx, 1);
});
test("teammates approach a captive without firing and leave escorted captives with the squad", () => {
  const w = sample();
  w.keys = [];
  w.objectives.push({ kind: "rescue", done: 0, required: 1 });
  const captive = {
    ...w.actors[0]!,
    role: "hostage",
    seat: null,
    objectiveIndex: 0,
    x: 40,
  };
  w.actors.push(captive);
  assert.deepEqual(botControls(w, "bot:1"), {
    dx: 1,
    dy: 0,
    fire: false,
    special: false,
  });
  captive.escort = "bot:1";
  assert.deepEqual(botControls(w, "bot:1"), {
    dx: 0,
    dy: 0,
    fire: false,
    special: false,
  });
});
test("rescuer leads a trailing hostage inside before holding extraction", () => {
  const w = sample();
  w.tiles[1] = "#..EEE#";
  w.actors[0]!.x = 56;
  const captive = {
    ...w.actors[0]!,
    x: 40,
    role: "hostage",
    seat: null,
    escort: "bot:1",
  };
  w.actors.push(captive);
  assert.equal(botControls(w, "bot:1").dx, 1);
  captive.x = 52;
  assert.equal(botControls(w, "bot:1").dx, 0);
});
test("dogfight sees opponents, respects walls and shoots along eight-way aim", () => {
  const w = sample();
  w.mode = "dogfight";
  w.actors.push({ ...w.actors[0]!, x: 40, seat: "solo" });
  assert.deepEqual(botControls(w, "bot:1"), {
    dx: 1,
    dy: 0,
    fire: true,
    special: false,
  });
  w.actors[1]!.x = 88;
  assert.equal(botControls(w, "bot:1").fire, false);
  w.outcome = "victory";
  assert.deepEqual(botControls(w, "bot:1"), {
    dx: 0,
    dy: 0,
    fire: false,
    special: false,
  });
});
