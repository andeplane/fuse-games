import assert from "node:assert/strict";
import test from "node:test";
import { CAMPAIGNS } from "../src/campaign/index.js";
import {
  missionBonuses,
  missionPassword,
  missionFromPassword,
  rememberMissionPassword,
  readMissionPassword,
  type MissionPerformance,
} from "../src/progression/index.js";

test("passwords match the DOS source reference for both players, campaigns and seeds", () => {
  // Calling the published PASSWORD.C MakePassword with the shipped titles and a zero-based mission.
  const fixtures: [number, number, number, boolean, string][] = [
    [1, 1, 0, false, "q4skdb"],
    [1, 1, 0, true, "u5sahj"],
    [1, 2, 0, false, "6p6mdb"],
    [1, 2, 493, true, "6n3yhj"],
    [0, 1, 0, false, "hfelya"],
    [2, 1, 0, false, "g0tirc"],
    [3, 1, 493, true, "a48z1j"],
    [4, 3, 0, false, "l9rj0e"],
  ];
  for (const [campaign, mission, seed, coop, expected] of fixtures) {
    assert.equal(missionPassword(campaign, mission, seed, coop), expected);
    assert.equal(missionFromPassword(campaign, expected, seed, coop), mission);
  }
  for (const [c, campaign] of CAMPAIGNS.entries())
    for (let m = 1; m < campaign.missions.length; m++)
      for (const coop of [true, false])
        assert.equal(
          missionFromPassword(c, missionPassword(c, m, 0, coop), 0, coop),
          m,
        );
});

test("starting, wrong codes, wrong campaign and incompatible DOS seed", () => {
  assert.equal(missionFromPassword(1, ""), 0);
  assert.equal(missionPassword(1, 0), "");
  for (const code of ["akdjdb", "Q4SKDB", "q4skdb ", "x".repeat(17)])
    assert.equal(missionFromPassword(1, code), undefined);
  assert.equal(missionFromPassword(0, "q4skdb"), undefined);
  assert.equal(missionFromPassword(1, "q4skdb", 1), undefined);
  assert.equal(missionFromPassword(1, "q4skdb", 0, true), undefined);
  assert.equal(missionFromPassword(-1, ""), undefined);
  assert.equal(missionPassword(1, 16), "");
  assert.equal(missionPassword(1, 1, 0x80000000), "");
});

test("the furthest unlocked mission persists within its campaign, seed and mode", () => {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  assert.equal(readMissionPassword(store, 1), "");
  assert.equal(rememberMissionPassword(store, 1, 2), "6p6mdb");
  assert.equal(rememberMissionPassword(store, 1, 1), "q4skdb");
  assert.equal(readMissionPassword(store, 1), "6p6mdb");
  assert.equal(readMissionPassword(store, 1, 0, true), "");
  assert.equal(readMissionPassword(store, 0), "");
  assert.equal(readMissionPassword(store, 1, 493), "");
  assert.equal(rememberMissionPassword(store, 1, 16), "");
  assert.equal(readMissionPassword(store, 1), "6p6mdb");
  for (const key of values.keys()) values.set(key, "corrupt");
  assert.equal(readMissionPassword(store, 1), "");
});

const final: MissionPerformance = {
  objectives: [
    { count: 20, required: 15, done: 20 },
    { count: 5, required: 5, done: 5 },
  ],
  keys: 9,
  ticks: 4915,
  survived: true,
  hp: 183,
  kills: 7,
  friendlies: 0,
  loadout: [0],
};

test("bonus ledger matches the compiled DOS Bonuses and Summary total", () => {
  assert.deepEqual(missionBonuses(final), {
    objective: 500,
    access: 250,
    time: 1250,
    health: 330,
    conduct: 350,
    total: 2680,
  });
  assert.deepEqual(missionBonuses({ ...final, survived: false }), {
    objective: 0,
    access: 0,
    time: 0,
    health: 0,
    conduct: 0,
    total: 0,
  });
});

test("awards use arithmetic in the DOS scoring path, including threshold boundaries", () => {
  assert.equal(missionBonuses({ ...final, ticks: 70 * 120 }).time, 0);
  assert.equal(missionBonuses({ ...final, ticks: 70 * 120 - 1 }).time, 25);
  assert.equal(missionBonuses({ ...final, keys: 15 }).access, 500);
  assert.equal(
    missionBonuses({
      ...final,
      objectives: [{ count: 3, required: 0, done: 3 }],
    }).objective,
    500,
  );
  assert.equal(
    missionBonuses({
      ...final,
      objectives: [{ count: 3, required: 3, done: 3 }],
    }).objective,
    0,
  );
  assert.equal(missionBonuses({ ...final, hp: 150 }).health, 0);
  assert.equal(missionBonuses({ ...final, hp: 0 }).health, -500);
  assert.equal(
    missionBonuses({ ...final, friendlies: 6, kills: 12 }).conduct,
    0,
  );
  assert.equal(
    missionBonuses({ ...final, friendlies: 6, kills: 11 }).conduct,
    -600,
  );
  assert.equal(missionBonuses({ ...final, kills: 5 }).conduct, 0);
  assert.equal(missionBonuses({ ...final, kills: 6 }).conduct, 300);
  assert.equal(missionBonuses({ ...final, loadout: [0, 1] }).conduct, 0);
  assert.equal(missionBonuses({ ...final, kills: 0 }).conduct, 500);
});
