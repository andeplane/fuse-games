import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACTION,
  JOIN,
  LEAVE,
  PRESENCE,
  SETTINGS,
  SPECTATOR,
} from "fuse-netcode";
import {
  createOffroadDriver,
  type OffroadPurchase,
} from "../src/game/offroad/campaign.js";
import {
  DEFAULT_SETTINGS,
  createRoom,
  PURCHASE,
  decodeRoom,
  encodeRoom,
  foldTick,
  fuseDriversView,
  isFuseDriversEntry,
  matchResult,
  parseSettings,
  type FuseDriversRoom,
} from "../src/game/index.js";
import { addBot, fold, started } from "./fixtures/fuseDrivers.js";

function finish(room: FuseDriversRoom) {
  for (let ticks = 0; room.stage === "running" && ticks < 8_000; ticks++)
    fold(room);
  assert.equal(room.stage, "over");
}

function quote(room: FuseDriversRoom, member: string, item: OffroadPurchase) {
  const driver = room.garage[member]!;
  return [
    PURCHASE,
    room.matchId,
    room.round,
    room.finishTick,
    item,
    driver.cash,
    driver.credits,
    driver[item],
  ] as const;
}

const roomWithFive = () =>
  started(DEFAULT_SETTINGS, [
    addBot("bot:1", 2),
    addBot("bot:2", 3),
    addBot("bot:3", 4),
  ]);

test("lobby wallets checkpoint and only quoted purchases before START reach the first grid", () => {
  const room = createRoom("lobby", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "fox", 1],
      [JOIN, "b", "Bo", 1, "fox", 1],
      addBot("bot:2", 2),
      [SPECTATOR, "join", "watch", "Watch", 1],
    ],
  });
  assert.deepEqual(Object.keys(room.garage), ["a", "b"]);
  const buy = [...quote(room, "a", "tires")];
  assert.ok(isFuseDriversEntry([1, room.tick + 1, ...buy]));
  fold(room, { a: [buy, buy], watch: [buy] });
  assert.deepEqual(room.garage.a, {
    ...createOffroadDriver(),
    tires: 1,
    cash: 16,
    credits: 1,
  });
  const fields = encodeRoom(room);
  const replica = decodeRoom(fields, room.tick)!;
  assert.deepEqual(replica, room);
  const forged = structuredClone(fields);
  (forged[8] as unknown[][])[0]![1] = 17;
  assert.equal(decodeRoom(forged, room.tick), undefined);
  for (const r of [room, replica]) {
    const shocks = [...quote(r, "a", "shocks")],
      nitro = [...quote(r, "b", "nitros")];
    fold(r, {
      a: [
        shocks,
        [ACTION, "start", "heat"],
        [PURCHASE, "lobby", 1, 0, "topSpeed", 10, 1, 0],
      ],
      b: [nitro],
    });
    assert.equal(r.race!.trucks[0]!.upgrades?.shocks, 1);
    assert.equal(r.race!.trucks[0]!.upgrades?.tires, 1);
    assert.equal(r.race!.trucks[0]!.upgrades?.topSpeed, 0);
    assert.equal(r.race!.trucks[1]!.motion.nitros, 26);
  }
  assert.deepEqual(replica, room);
});

test("a new lobby discards the previous opening quote, and seat reclamation cannot transfer upgrades", () => {
  const room = createRoom("first", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "fox", 1],
      [JOIN, "b", "Bo", 1, "fox", 1],
    ],
  });
  const purchase = [...quote(room, "b", "topSpeed")];
  fold(room, { b: [purchase] });
  fold(room, {
    a: [
      [LEAVE, "b"],
      [JOIN, "c", "Cy", 1, "cat", 1],
    ],
  });
  assert.deepEqual(room.garage.c, createOffroadDriver());
  assert.equal(room.garage.b, undefined);
  fold(room, { a: [[ACTION, "start", "heat"]] });
  fold(room, { a: [[ACTION, "lobby", "second"]] });
  fold(room, { c: [purchase] });
  assert.deepEqual(room.garage.c, createOffroadDriver());
});

test("a finite series freezes its chosen length, preserves each receipt and ends shopping at the finish", () => {
  const room = started({ ...DEFAULT_SETTINGS, races: 2 }, [
    addBot("bot:1", 2),
    addBot("bot:2", 3),
  ]);
  assert.equal(fuseDriversView(room).seriesRace, 1);
  fold(room, { a: [[SETTINGS, { ...DEFAULT_SETTINGS, races: 8 }]] });
  assert.equal(room.seriesLength, 2);
  finish(room);
  assert.equal(fuseDriversView(room).seriesComplete, false);
  fold(room, { a: [[ACTION, "rematch", "heat2"]] });
  const restored = decodeRoom(encodeRoom(room), room.tick)!;
  assert.equal(restored.seriesRace, 2);
  assert.equal(restored.seriesLength, 2);
  finish(restored);
  assert.equal(fuseDriversView(restored).seriesComplete, true);
  assert.deepEqual(
    restored.recentFinishes.map((f) => [f.matchId, f.round]),
    [
      ["m1", 1],
      ["heat2", 1],
    ],
  );
  const prior = { ...restored.garage };
  fold(restored, {
    a: [[...quote(restored, "a", "shocks")], [ACTION, "rematch", "extra"]],
  });
  assert.equal(restored.matchId, "heat2");
  assert.equal(restored.stage, "over");
  assert.deepEqual(restored.garage, prior);
  fold(restored, { a: [[ACTION, "lobby", "lobby"]] });
  assert.equal(fuseDriversView(restored).seriesRace, 0);
  assert.equal(fuseDriversView(restored).seriesLength, 8);
  fold(restored, { a: [[ACTION, "start", "fresh"]] });
  assert.equal(restored.seriesRace, 1);
  assert.equal(restored.seriesLength, 8);
});

test("one-race ends immediately; continuous mode continues beyond the default three races", () => {
  const one = started({ ...DEFAULT_SETTINGS, races: 1 }, [addBot("bot:1", 2)]);
  finish(one);
  assert.equal(fuseDriversView(one).seriesComplete, true);
  const continuous = started({ ...DEFAULT_SETTINGS, races: 0 }, [
    addBot("bot:1", 2),
    addBot("bot:2", 3),
  ]);
  for (let index = 1; index <= 3; index++) {
    finish(continuous);
    assert.equal(fuseDriversView(continuous).seriesComplete, false);
    fold(continuous, { a: [[ACTION, "rematch", `heat${index + 1}`]] });
  }
  assert.equal(continuous.stage, "running");
  assert.equal(continuous.seriesRace, 4);
});

test("settings and checkpoints refuse invalid series lengths and impossible active race ordinals", () => {
  for (const races of [-1, -0, 9, 2.5, null, undefined, "3"]) {
    assert.equal(parseSettings({ ...DEFAULT_SETTINGS, races }), undefined);
  }
  const room = roomWithFive();
  for (const [ordinal, length] of [
    [0, 3],
    [4, 3],
    [1, 9],
    [1, -1],
    [room.tick + 1, 0],
  ]) {
    const fields = encodeRoom(room);
    const header = fields[0] as unknown[];
    header[4] = ordinal;
    header[5] = length;
    assert.equal(decodeRoom(fields, room.tick), undefined);
  }
});

test("a five-seat campaign pays human drivers once and purchases follow the owner into the next grid", () => {
  const room = roomWithFive();
  assert.deepEqual(Object.keys(room.garage), room.grid);
  assert.equal(room.campaignIndex, 0);
  assert.equal(room.race?.trackName, "offroad-4");
  const before = fuseDriversView(room).garage;
  finish(room);
  const finished = fuseDriversView(room).garage;
  const receipt = matchResult(room);
  const places = room.race!.placements;
  const expected = [10, 9, 8, 7, 0][places.indexOf(0)]!;
  assert.equal(finished.a!.cash, (expected + room.race!.trucks[0]!.cash) % 100);
  assert.equal(before.a!.cash, 0, "a retained view is a snapshot");
  assert.equal(
    finished["bot:3"]!.cash,
    0,
    "the fifth, computer-controlled seat does not shop",
  );
  const purchase = [...quote(room, "a", "topSpeed")];
  fold(room, { a: [purchase, purchase] });
  assert.equal(room.garage.a!.topSpeed, 1);
  assert.equal(finished.a!.topSpeed, 0);
  assert.equal(room.garage.b!.topSpeed, 0);
  assert.deepEqual(matchResult(room), receipt);
  const after = room.garage;
  fold(room, { a: [purchase] });
  assert.deepEqual(
    room.garage,
    after,
    "the same quote in another log tick is spent already",
  );
  fold(room, {
    a: [
      [LEAVE, "b"],
      [JOIN, "c", "Cy", 1, "cat", 1],
      [ACTION, "rematch", "m2"],
    ],
  });
  assert.equal(room.race?.trackName, "offroad-7");
  assert.equal(room.campaignIndex, 1);
  assert.deepEqual(room.garage.a, after.a);
  assert.equal(room.race?.trucks[0]?.upgrades?.topSpeed, 1);
  assert.equal(room.race?.trucks[0]?.motion.nitros, after.a!.nitros);
  assert.deepEqual(room.garage.c, createOffroadDriver());
  assert.equal(room.garage.b, undefined);
  fold(room, { a: [purchase] });
  assert.equal(room.garage.a!.topSpeed, 1);
  fold(room, {
    a: [
      [ACTION, "lobby", "l2"],
      [ACTION, "start", "m3"],
    ],
  });
  assert.equal(room.campaignIndex, 0);
  assert.equal(room.race?.trackName, "offroad-4");
  assert.deepEqual(room.garage.a, createOffroadDriver());
});

test("shop requires the admitted stream generation, a current finish quote and a participating human seat", () => {
  const room = roomWithFive();
  finish(room);
  const body = quote(room, "b", "shocks");
  const tick = room.tick + 1;
  foldTick(
    room,
    "a",
    new Map([
      [
        "a",
        {
          generation: 1,
          entries: [
            [1, tick, PRESENCE, "b", true, 2],
            [2, tick, SPECTATOR, "join", "watch", "Watcher", 1],
          ],
        },
      ],
      [
        "b",
        {
          generation: 2,
          retired: [{ generation: 1, entries: [[1, tick, ...body]] }],
          entries: [],
        },
      ],
      ["watch", { generation: 1, entries: [[1, tick, ...body]] }],
    ]),
  );
  assert.equal(room.garage.b!.shocks, 0);
  assert.equal(room.garage.watch, undefined);
  const next = room.tick + 1;
  foldTick(
    room,
    "a",
    new Map([
      [
        "b",
        {
          generation: 2,
          entries: [
            [
              1,
              next,
              PURCHASE,
              "different",
              room.round,
              room.finishTick,
              "shocks",
              body[5],
              body[6],
              0,
            ],
            [
              2,
              next,
              PURCHASE,
              room.matchId,
              room.round,
              room.finishTick - 1,
              "shocks",
              body[5],
              body[6],
              0,
            ],
            [3, next, ...body],
          ],
        },
      ],
    ]),
  );
  assert.equal(room.garage.b!.shocks, 1);
  assert.equal(room.garage.a!.shocks, 0);
});

test("the selected reverse opener determines the next campaign course and a lobby reset clears every balance", () => {
  const room = started({ ...DEFAULT_SETTINGS, track: "offroad-3-reverse" }, [
    addBot("bot:1", 2),
  ]);
  assert.equal(room.campaignIndex, 42);
  finish(room);
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.equal(room.campaignIndex, 27);
  assert.equal(room.race?.trackName, "offroad-4");
  fold(room, { a: [[ACTION, "lobby", "l1"]] });
  assert.deepEqual(room.garage, {
    a: createOffroadDriver(),
    b: createOffroadDriver(),
  });
  assert.equal(room.campaignIndex, -1);
});

test("purchase inputs must carry a bounded, scoped quote", () => {
  const valid = [1, 40, PURCHASE, "m1", 1, 39, "shocks", 90, 2, 4];
  assert.ok(isFuseDriversEntry(valid));
  for (const [index, value] of [
    [5, 40],
    [5, -1],
    [6, "__proto__"],
    [7, 10000],
    [8, 10],
    [9, 6],
  ] as const) {
    const entry: unknown[] = [...valid];
    entry[index] = value;
    assert.equal(isFuseDriversEntry(entry), false);
  }
});

test("two purchases from one tick apply by input sequence, with one credit conversion and a cap per tier", () => {
  const room = roomWithFive();
  finish(room);
  const first = quote(room, "b", "shocks");
  const driver = room.garage.b!;
  const nextCash = driver.cash + (driver.cash < 6 ? 20 : 0) - 6;
  const nextCredits = driver.credits - Number(driver.cash < 6);
  const tick = room.tick + 1;
  foldTick(
    room,
    "a",
    new Map([
      [
        "b",
        {
          generation: 1,
          entries: [
            [
              2,
              tick,
              PURCHASE,
              room.matchId,
              room.round,
              room.finishTick,
              "shocks",
              nextCash,
              nextCredits,
              1,
            ],
            [1, tick, ...first],
          ],
        },
      ],
    ]),
  );
  assert.equal(room.garage.b!.shocks, 2);
  for (let i = 0; i < 3; i++)
    fold(room, { b: [[...quote(room, "b", "shocks")]] });
  assert.equal(room.garage.b!.shocks, 5);
  const capped = room.garage.b;
  fold(room, { b: [[...quote(room, "b", "shocks")]] });
  assert.deepEqual(room.garage.b, capped);
  for (let i = 0; i < 3; i++)
    fold(room, { b: [[...quote(room, "b", "topSpeed")]] });
  assert.equal(room.garage.b!.credits, 0);
  assert.ok(room.garage.b!.cash < 10);
  const spent = room.garage.b;
  fold(room, { b: [[...quote(room, "b", "topSpeed")]] });
  assert.deepEqual(room.garage.b, spent);
});
