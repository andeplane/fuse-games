import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTION, PRESENCE, World } from "fuse-netcode";
import { dueReports } from "../src/app/reports.js";
import {
  PURCHASE,
  fuseDriversGame,
  foldTick,
  type FuseDriversRoom,
} from "../src/game/index.js";
import { started, addBot, fold, runTo } from "./fixtures/fuseDrivers.js";

function openRace() {
  return started(undefined, [addBot("bot:1", 2), addBot("bot:2", 3)]);
}

function finish() {
  const room = openRace();
  for (let i = 0; i < 8000 && room.stage === "running"; i++) fold(room);
  assert.equal(room.stage, "over");
  return room;
}

function purchase(room: FuseDriversRoom, member: string) {
  const d = room.garage[member]!;
  return [
    PURCHASE,
    room.matchId,
    room.round,
    room.finishTick,
    "shocks",
    d.cash,
    d.credits,
    d.shocks,
  ] as const;
}

test("the closing tick accepts the host's earlier purchase and a concurrent guest purchase", () => {
  const room = finish(),
    tick = room.tick + 1;
  const host = purchase(room, "a"),
    guest = purchase(room, "b");
  foldTick(
    room,
    "a",
    new Map([
      [
        "a",
        {
          generation: 1,
          entries: [
            [1, tick, ...host],
            [2, tick, ACTION, "rematch", "next"],
            [3, tick, ...host],
          ],
        },
      ],
      ["b", { generation: 1, entries: [[1, tick, ...guest]] }],
    ]),
  );
  assert.equal(room.stage, "running");
  assert.equal(room.race!.trucks[0]!.upgrades?.shocks, 1);
  assert.equal(room.race!.trucks[1]!.upgrades?.shocks, 1);
});

test("a buy after NEXT in its own stream and a superseded guest generation cannot spend the closing wallet", () => {
  const room = finish(),
    tick = room.tick + 1;
  const host = purchase(room, "a"),
    guest = purchase(room, "b");
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
            [2, tick, ACTION, "rematch", "next"],
            [3, tick, ...host],
          ],
        },
      ],
      [
        "b",
        {
          generation: 2,
          entries: [],
          retired: [{ generation: 1, entries: [[1, tick, ...guest]] }],
        },
      ],
    ]),
  );
  assert.equal(room.race!.trucks[0]!.upgrades?.shocks, 0);
  assert.equal(room.race!.trucks[1]!.upgrades?.shocks, 0);
});

function nearFinish(finishTick: number) {
  const room = openRace();
  runTo(room, finishTick - 4);
  assert.equal(room.stage, "running");
  const world = new World(fuseDriversGame, room, "a", "a");
  for (const id of ["a", "b"])
    world.stream(id, 1, { seq: 0, tick: room.tick }).through = room.tick;
  return world;
}

test("an immediate rematch or lobby transition survives until the first rollback-closed report", () => {
  const end = finish(),
    at = end.finishTick;
  const expected = dueReports(end, "b", at, new Set());
  assert.equal(expected.length, 2);
  for (const action of ["rematch", "lobby"] as const) {
    const world = nearFinish(at),
      host = world.stream("a", 1),
      guest = world.stream("b", 1);
    host.append(at + 1, [ACTION, action, "next"]);
    host.through = at + 100;
    world.advance(at + 2);
    assert.equal(world.state.stage, action === "rematch" ? "running" : "lobby");
    assert.equal(
      world.confirmedFrame(),
      undefined,
      "the old result is still speculative on this replica",
    );
    guest.through = at + 100;
    world.advance(at + 70);
    const final = world.confirmedFrame()!;
    assert.equal(final.matchId, "next");
    assert.deepEqual(dueReports(final, "b", final.tick, new Set()), expected);
    assert.deepEqual(
      dueReports(final, "new-driver", final.tick, new Set()),
      [],
    );
    assert.deepEqual(dueReports(final, "bot:1", final.tick, new Set()), []);
    assert.deepEqual(
      dueReports(final, "b", final.tick, new Set(expected.map((r) => r.key))),
      [],
    );
  }
});

test("an overturned speculative finish never becomes a confirmed report", () => {
  const at = finish().finishTick,
    world = nearFinish(at);
  world.advance(at + 2);
  assert.equal(world.state.stage, "over");
  assert.equal(world.state.recentFinishes.length, 1);
  assert.equal(world.confirmedFrame(), undefined);
  const repair = world.receive(
    "a",
    [[1, at - 1, ACTION, "lobby", "cancelled"]],
    1,
    at + 70,
    at + 70,
  );
  assert.equal(repair.status, "accepted");
  assert.ok(repair.rollbackTicks > 0);
  world.stream("b", 1).through = at + 100;
  world.advance(at + 70);
  const final = world.confirmedFrame()!;
  assert.equal(final.matchId, "cancelled");
  assert.equal(final.recentFinishes.length, 0);
  assert.deepEqual(dueReports(final, "a", final.tick, new Set()), []);
});
