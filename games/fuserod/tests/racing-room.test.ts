import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  JOIN,
  BOT,
  PRESENCE,
  SETTINGS,
  type StreamEntries,
} from "fuse-netcode";
import {
  DEFAULT_SETTINGS,
  COUNTDOWN_TICKS,
  MAX_RACE_TICKS,
  createRoom,
  decodeRoom,
  encodeRoom,
  foldTick,
  fuserodView,
  hashRoom,
  isEntry,
  parseSettings,
  type FuserodRoom,
  type FuserodSettings,
  type FuserodEntry,
} from "../src/game/index.js";
import { fuserodRegistration } from "../src/platform.js";
const empty = new Map<string, StreamEntries<FuserodEntry>>();
function setup(
  bot = true,
  settings: FuserodSettings = DEFAULT_SETTINGS,
  matchId = "heat",
) {
  const r = createRoom("lobby", settings);
  const entries: FuserodEntry[] = [[1, 1, JOIN, "a", "Ada", 0, "robot", 1]];
  if (bot) entries.push([2, 1, BOT, "add", "bot:1", "Jet", 1]);
  entries.push([3, 1, ACTION, "start", matchId]);
  foldTick(r, "a", new Map([["a", { generation: 1, entries }]]));
  return r;
}
function run(room: FuserodRoom, ticks: number) {
  for (let i = 0; i < ticks; i++) foldTick(room, "a", empty);
}
function restore(r: FuserodRoom) {
  const restored = decodeRoom(encodeRoom(r), r.tick);
  assert.ok(restored);
  assert.equal(hashRoom(restored), hashRoom(r));
  return restored;
}
test("one room heat runs countdown, ordinary bot controls, two receipts and rematch", () => {
  const r = setup();
  assert.equal(r.stage, "running");
  run(r, r.race!.treeTicks - 1);
  assert.equal(fuserodView(r).raceTicks, 0);
  assert.equal(r.race!.racers[1]!.motor.position, 0);
  while (r.stage === "running" && r.tick <= MAX_RACE_TICKS + COUNTDOWN_TICKS)
    run(r, 1);
  assert.equal(r.stage, "over");
  assert.equal(r.race!.winnerId, "bot:1");
  assert.deepEqual(
    r.history.map((h) => [h.result.matchId, h.result.round, h.result.winnerId]),
    [
      ["heat", 1, "bot:1"],
      ["heat", undefined, "bot:1"],
    ],
  );
  assert.deepEqual(r.history[1]!.result.finishers, ["a"]);
  assert.ok(fuserodRegistration.validField(r.history[0]!.result.players));
  assert.ok(
    r.history[0]!.result.players.every((p) =>
      fuserodRegistration.parseStats(p, 1),
    ),
  );
  const restored = restore(r);
  const entry: FuserodEntry = [4, r.tick + 1, ACTION, "rematch", "heat2"];
  foldTick(
    restored,
    "a",
    new Map([["a", { generation: 1, entries: [entry] }]]),
  );
  assert.equal(restored.race!.elapsed, 1);
  assert.equal(restored.matchId, "heat2");
  assert.equal(restored.race!.racers[0]!.motor.position, 0);
  assert.equal(restored.history.length, 2);
});
test("one seat time trial, held launch and release, checkpoint replay and heat fencing", () => {
  const r = setup(false);
  const entries: FuserodEntry[] = [
    [4, 2, 0, "heat", true, false, 0, 1],
    [5, 2, 0, "heat", true, false, 0, 0],
    [6, 2, 0, "stale", false, true, 1, -1],
    [7, 2, SETTINGS, { ...DEFAULT_SETTINGS, route: "canyon", variant: "duel" }],
  ];
  foldTick(r, "a", new Map([["a", { generation: 1, entries }]]));
  assert.equal(r.race!.racers[0]!.input.shift, 1);
  run(r, 100);
  assert.equal(r.race!.settings.route, "strip");
  assert.ok(r.race!.racers[0]!.motor.position > 0);
  const resume = restore(r);
  const release: FuserodEntry = [8, r.tick + 1, 0, "heat", false, true, -1, 0];
  for (const state of [r, resume]) {
    foldTick(
      state,
      "a",
      new Map([["a", { generation: 1, entries: [release] }]]),
    );
    run(state, 11);
  }
  assert.deepEqual(fuserodView(r), fuserodView(resume));
  assert.equal(hashRoom(r), hashRoom(resume));
  assert.equal(r.race!.racers[0]!.input.throttle, false);
  assert.equal(r.race!.racers[0]!.input.brake, true);
});
test("generation replacement clears held pedals and ignores a retired driver's later inputs", () => {
  const r = setup(false);
  foldTick(
    r,
    "a",
    new Map([
      ["a", { generation: 1, entries: [[4, 2, 0, "heat", true, false, 1, 1]] }],
    ]),
  );
  foldTick(
    r,
    "a",
    new Map([
      [
        "a",
        {
          generation: 2,
          entries: [[1, 3, PRESENCE, "a", true, 2]],
          retired: [
            { generation: 1, entries: [[5, 3, 0, "heat", true, false, 1, 0]] },
          ],
        },
      ],
    ]),
  );
  assert.deepEqual(r.race!.racers[0]!.input, {
    throttle: false,
    brake: false,
    steer: 0,
    shift: 0,
  });
});
test("corrupt motor, sorted grid and elapsed bounds reject recovery without changing the healthy room", () => {
  const r = setup();
  run(r, 100);
  const before = hashRoom(r);
  for (const bad of [
    { ...r.race, elapsed: 5000 },
    { ...r.race, racers: [r.race!.racers[0], r.race!.racers[0]] },
    {
      ...r.race,
      racers: [
        {
          ...r.race!.racers[0],
          motor: { ...r.race!.racers[0]!.motor, gear: 99 },
        },
      ],
    },
  ]) {
    const data = encodeRoom(r);
    data[4] = bad;
    assert.equal(decodeRoom(data, r.tick), undefined);
    assert.equal(hashRoom(r), before);
  }
  assert.equal(isEntry([1, 1, 0, "heat", true, false, 2, 0]), false);
  assert.equal(isEntry([1, 1, JOIN, "bot:1", "Ada", 0, "robot", 1]), false);
  assert.equal(parseSettings({ ...DEFAULT_SETTINGS, power: 3 }), undefined);
});
test("solo timeout completes with no credited win", () => {
  const r = setup(false);
  run(r, MAX_RACE_TICKS + COUNTDOWN_TICKS);
  assert.equal(r.stage, "over");
  assert.equal(r.history[1]!.result.winnerId, undefined);
  assert.equal(r.history[1]!.result.players[0]!.roundWins, 0);
  restore(r);
});
test("all five event kinds use their own distance, field, qualifier deadline and bracket trees", () => {
  const timed = setup(true, { ...DEFAULT_SETTINGS, variant: "timed" });
  assert.equal(timed.race!.racers.length, 1);
  assert.equal(fuserodView(timed).finishDistance, 402.336);
  run(timed, timed.race!.treeTicks + 1600);
  assert.equal(timed.stage, "over");
  assert.equal(timed.race!.winnerId, null);
  restore(timed);
  const bracket = setup(true, {
    ...DEFAULT_SETTINGS,
    variant: "grudge",
    dialInTicks: 550,
  });
  const drivers = fuserodView(bracket).racers;
  assert.ok(drivers[0]!.countdown < drivers[1]!.countdown);
  const street = setup();
  assert.ok(fuserodView(street).finishDistance > 900);
  for (const route of ["aqueduct", "canyon"] as const) {
    const road = setup(true, { ...DEFAULT_SETTINGS, variant: "duel", route });
    assert.ok(fuserodView(road).finishDistance > 1600);
    assert.equal(restore(road).race!.settings.variant, "duel");
  }
});
test("crossing the center line on a qualifying run loses the round, freezes results and round-trips the checkpoint", () => {
  const room = setup(true, { ...DEFAULT_SETTINGS, variant: "timed" });
  foldTick(
    room,
    "a",
    new Map([
      [
        "a",
        { generation: 1, entries: [[4, 2, 0, "heat", true, false, -1, 1]] },
      ],
    ]),
  );
  while (room.stage === "running") run(room, 1);
  assert.equal(room.race!.racers[0]!.laneFault, true);
  assert.equal(room.race!.winnerId, null);
  restore(room);
});
test("a bracket racer who beats the declared time loses the heat even when crossing first", () => {
  const r = setup(true, {
    ...DEFAULT_SETTINGS,
    variant: "grudge",
    dialInTicks: 750,
  });
  while (r.stage === "running") {
    const driver = r.race!.racers[0]!;
    const gear = driver.motor.gear;
    const shift = gear === 0 || (gear < 3 && driver.motor.rpm >= 4250) ? 1 : 0;
    const tick = r.tick + 1;
    foldTick(
      r,
      "a",
      new Map([
        [
          "a",
          {
            generation: 1,
            entries: [[tick + 3, tick, 0, "heat", true, false, 0, shift]],
          },
        ],
      ]),
    );
  }
  assert.equal(fuserodView(r).racers[0]!.breakout, true);
  assert.equal(r.race!.winnerId, "bot:1");
  restore(r);
});
test("rivals drive both road events past the visible hazards on championship power", () => {
  for (const route of ["canyon", "aqueduct"] as const) {
    const r = setup(
      true,
      {
        ...DEFAULT_SETTINGS,
        variant: "duel",
        route,
        opponent: 2,
        king: true,
      },
      "race-4",
    );
    while (r.stage === "running") run(r, 1);
    assert.equal(r.race!.winnerId, "bot:1");
    assert.ok(r.race!.racers[1]!.finishTicks > 0);
    assert.equal(r.race!.police.phase, 0);
    assert.equal(r.race!.racers[1]!.crashed, false);
    restore(r);
  }
});
test("high-RPM rivals can lose a heat to a seeded gearbox failure", () => {
  const r = setup(
    true,
    {
      ...DEFAULT_SETTINGS,
      variant: "duel",
      route: "canyon",
      king: true,
      opponent: 2,
    },
    "heat",
  );
  while (r.stage === "running") run(r, 1);
  assert.equal(r.race!.racers[1]!.motor.broken, true);
  assert.equal(r.race!.winnerId, "a");
  restore(r);
});
