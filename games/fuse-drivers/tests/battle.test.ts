import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTION, SETTINGS as ROOM_SETTINGS } from "fuse-netcode";
import { decodeRoom, encodeRoom, hashRoom } from "../src/game/checkpoint.js";
import {
  OFFROAD_COURSE_NAMES,
  getOffroadCourse,
} from "../src/game/offroad/course.js";
import { BATTLE, createBattle, stepBattle } from "../src/game/sim/battle.js";
import { NEUTRAL_INPUT } from "../src/game/sim/input.js";
import {
  SETTINGS,
  addBot,
  drive,
  fold,
  started,
} from "./fixtures/fuseDrivers.js";

const mode = { ...SETTINGS, mode: "battle" as const };
const press = { ...NEUTRAL_INPUT, item: true };
const idle = [NEUTRAL_INPUT, NEUTRAL_INPUT];

test("each Battle route has three distinct reachable crates", () => {
  for (const name of OFFROAD_COURSE_NAMES) {
    const course = getOffroadCourse(name);
    const state = createBattle(name, 4);
    assert.equal(
      new Set(state.crates.map((c) => [c.x, c.y].join(","))).size,
      3,
      name,
    );
    for (const c of state.crates)
      assert.equal(course.terrain.sample(c.x, c.y)?.blocked, false);
  }
});

test("a warned firebomb slows a rival once, exempts its owner and expires", () => {
  const race = started(mode).race!;
  const trucks = race.trucks.map((t) => ({
    ...t,
    motion: { ...t.motion, x: 6000, y: 6000, speed: 100, throttle: 200 },
  }));
  const base = race.battle!;
  let battle = stepBattle(base, trucks, [press, NEUTRAL_INPUT], 100);
  assert.equal(base.slots[0]!.held, "firebomb");
  assert.equal(battle.slots[0]!.held, null);
  const bomb = battle.bombs[0]!;
  assert.equal(bomb.detonateAt, 100 + BATTLE.fuseTicks);
  for (let tick = 101; tick < bomb.detonateAt; tick++) {
    battle = stepBattle(battle, trucks, [press, NEUTRAL_INPUT], tick);
    assert.equal(trucks[1]!.motion.speed, 100);
  }
  const shielded = structuredClone(battle);
  shielded.slots[1]!.held = "shield";
  const protectedTrucks = trucks.slice();
  const protectedState = stepBattle(
    shielded,
    protectedTrucks,
    [press, press],
    bomb.detonateAt,
  );
  assert.equal(protectedTrucks[1]!.motion.speed, 100);
  assert.equal(
    protectedState.slots[1]!.shieldUntil,
    bomb.detonateAt + BATTLE.shieldTicks,
  );
  for (let tick = bomb.detonateAt; tick <= bomb.expiresAt; tick++) {
    battle = stepBattle(battle, trucks, idle, tick);
    assert.equal(trucks[0]!.motion.speed, 100);
    assert.equal(trucks[1]!.motion.speed, 25);
    assert.equal(trucks[1]!.motion.throttle, 0);
  }
  assert.deepEqual(battle.bombs, []);
});

test("a contested crate has one winner, requires a fresh press, and restocks with the other item", () => {
  const race = started(mode).race!,
    state = race.battle!;
  const crate = state.crates[0]!;
  const trucks = race.trucks.map((t) => ({
    ...t,
    motion: { ...t.motion, x: crate.x, y: crate.y },
  }));
  for (const s of state.slots) s.held = null;
  let battle = stepBattle(state, trucks, [press, NEUTRAL_INPUT], 100);
  assert.equal(battle.slots[0]!.held, "shield");
  assert.equal(battle.slots[1]!.held, null);
  assert.equal(battle.crates[0]!.kind, "firebomb");
  assert.equal(battle.crates[0]!.readyAt, 100 + BATTLE.respawnTicks);
  battle = stepBattle(battle, trucks, [press, NEUTRAL_INPUT], 101);
  assert.equal(battle.slots[0]!.held, "shield");
  battle = stepBattle(battle, trucks, idle, 102);
  battle = stepBattle(battle, trucks, [press, NEUTRAL_INPUT], 103);
  assert.equal(battle.slots[0]!.held, null);
  trucks[0] = {
    ...trucks[0]!,
    motion: { ...trucks[0]!.motion, x: crate.x + 4000 },
  };
  battle = stepBattle(battle, trucks, idle, 100 + BATTLE.respawnTicks);
  assert.equal(battle.slots[1]!.held, "firebomb");
});

test("a same-tick item tap survives a checkpoint, bots deploy, and the race finishes", () => {
  const room = started(mode, [addBot("bot:2", 2)]);
  while (room.race!.phase === "countdown") fold(room);
  fold(room, { a: [drive({ item: true }), drive({})] });
  assert.equal(room.race!.battle!.bombs[0]?.owner, 0);
  assert.equal(room.race!.battle!.slots[0]!.itemDown, false);
  const snapshot = encodeRoom(room);
  const tick = room.tick;
  const copy = decodeRoom(snapshot, tick);
  assert.ok(copy);
  let cpuUsed = false;
  for (let i = 0; i < 4000 && room.stage === "running"; i++) {
    fold(room);
    fold(copy);
    if (room.race!.battle!.bombs.some((b) => b.owner === 2)) cpuUsed = true;
  }
  assert.ok(cpuUsed);
  assert.equal(room.stage, "over");
  assert.equal(hashRoom(copy), hashRoom(room));
  for (const invalid of [
    null,
    [[], [], []],
    [[["firebomb", 1e10, 0, false]], [], []],
  ]) {
    const bad = structuredClone(snapshot);
    (bad[5] as unknown[])[10] = invalid;
    assert.equal(decodeRoom(bad, tick), undefined);
  }
  fold(room, {
    a: [
      [ROOM_SETTINGS, SETTINGS],
      [ACTION, "rematch", "m2"],
    ],
  });
  assert.equal(room.settings.mode, "battle");
  assert.equal(room.seriesRace, 2);
  assert.equal(room.race?.battle?.slots[0]?.held, "firebomb");
});
