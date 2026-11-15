import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS,
  allowedWeaponIds,
  chooseWinner,
  collectBonus,
  compareWorms,
  defaultLoadout,
  findSpawnPoint,
  parseSettings,
  randomLoadout,
  recordInjury,
  resetSpawnMatchState,
  score,
  shouldRespawn,
  updateRespawnEligibility,
  stepBonuses,
  stepMatch,
  simulateBonuses,
  takeExplosionBonus,
  validLoadout,
} from "../src/engine/classic/match.js";
import { CLASSIC_WEAPONS } from "../src/engine/classic/catalog.js";
import type {
  BonusRecipient,
  BonusState,
  MatchBonus,
  MatchRandom,
  MatchState,
  MatchWorm,
  SpawnTerrain,
} from "../src/engine/classic/match-types.js";

function worm(
  id: string,
  slot = 0,
  values: Partial<MatchWorm> = {},
): MatchWorm {
  return {
    id,
    slot,
    x: 20,
    y: 20,
    health: 100,
    alive: true,
    kills: 0,
    deaths: 0,
    suicides: 0,
    damageScore: 0,
    lives: -2,
    respawnAtMs: null,
    spawnedOnce: true,
    respawnRequested: false,
    canRespawnNow: false,
    weaponsReady: true,
    ...values,
  };
}
function match(worms = [worm("a"), worm("b", 1)]): MatchState {
  return { elapsedMs: 0, worms, phase: "play", winner: null };
}
class Random implements MatchRandom {
  readonly requestedInts: number[] = [];
  floatCalls = 0;
  constructor(
    private floats: number[] = [0.5],
    private ints: number[] = [0],
  ) {}
  nextFloat(): number {
    return this.floats[this.floatCalls++ % this.floats.length]!;
  }
  nextInt(max: number): number {
    const at = this.requestedInts.length;
    this.requestedInts.push(max);
    return this.ints[at % this.ints.length]!;
  }
}
const dirt: SpawnTerrain = { width: 40, height: 30, isRock: () => false };

test("fresh native defaults are one immediate deathmatch, 15 kills, six minutes and unlimited lives", () => {
  assert.equal(DEFAULT_SETTINGS.killLimit, 15);
  assert.equal(DEFAULT_SETTINGS.timeLimitMs, 360_000);
  assert.equal(DEFAULT_SETTINGS.lives, -2);
  assert.equal(DEFAULT_SETTINGS.bonuses, false);
  assert.equal(DEFAULT_SETTINGS.respawnTimeMs, 2_500);
  assert.deepEqual(parseSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  for (const invalid of [
    { ...DEFAULT_SETTINGS, lives: -1 },
    { ...DEFAULT_SETTINGS, timeLimitMs: Infinity },
    { ...DEFAULT_SETTINGS, loadingTime: NaN },
    { ...DEFAULT_SETTINGS, restrictionPreset: "made-up" },
    { ...DEFAULT_SETTINGS, invented: true },
  ])
    assert.equal(parseSettings(invalid), undefined);
});

test("actual fresh configuration enables Standard 100lt's twelve weapons, with all 38 selectable by preset", () => {
  assert.deepEqual(
    allowedWeaponIds(DEFAULT_SETTINGS).map((id) => CLASSIC_WEAPONS[id]!.name),
    [
      "Blaster",
      "Cannon",
      "Chaingun",
      "Dart",
      "Doomsday",
      "Handgun",
      "Mini Rockets",
      "Napalm",
      "Shotgun",
      "Super Shotgun",
      "Uzi",
      "Winchester",
    ],
  );
  assert.equal(allowedWeaponIds({ restrictionPreset: "all" }).length, 38);
  const fallback = defaultLoadout(DEFAULT_SETTINGS);
  assert.equal(
    new Set(fallback).size,
    1,
    "missing native profile slots independently fall back to first enabled weapon",
  );
  assert.equal(CLASSIC_WEAPONS[fallback[0]]!.name, "Blaster");
  assert.ok(
    validLoadout(fallback, DEFAULT_SETTINGS),
    "native manual selection allows duplicate weapons",
  );
  assert.equal(
    validLoadout([0, 0, 0, 0, 0], DEFAULT_SETTINGS),
    false,
    "banned Bazooka is not a default legal loadout",
  );
  assert.equal(validLoadout([2, 2, 2, 2], DEFAULT_SETTINGS), false);
  assert.equal(validLoadout([2, 2, 2, 2, 99], DEFAULT_SETTINGS), false);
});

test("native random loadout cycles from random starts and avoids already selected weapons", () => {
  const random = new Random();
  const selected = randomLoadout(DEFAULT_SETTINGS, random);
  assert.deepEqual(
    selected.map((id) => CLASSIC_WEAPONS[id]!.name),
    ["Blaster", "Cannon", "Chaingun", "Dart", "Doomsday"],
  );
  assert.deepEqual(random.requestedInts, [37, 37, 37, 37, 37]);
  assert.ok(validLoadout(selected, DEFAULT_SETTINGS));
});

test("CGameObject injury preserves an exactly zero-health living worm until a later positive hit", () => {
  const state = match(),
    target = state.worms[1]!,
    attacker = state.worms[0]!;
  assert.deepEqual(recordInjury(state, "b", 100, "a", DEFAULT_SETTINGS), {
    damage: 100,
    killed: false,
  });
  assert.equal(target.health, 0);
  assert.equal(target.alive, true);
  assert.equal(attacker.kills, 0);
  assert.deepEqual(recordInjury(state, "b", 1, "a", DEFAULT_SETTINGS), {
    damage: 0,
    killed: true,
  });
  assert.equal(target.alive, false);
  assert.equal(target.lives, -2);
  assert.equal(target.respawnAtMs, 2_500);
  assert.equal(attacker.kills, 1);
  assert.equal(
    attacker.damageScore,
    100,
    "overkill does not inflate damage score",
  );
  assert.equal(
    target.deaths,
    0,
    "native AllowNegativeScore=false suppresses death stats while score is zero",
  );
});

test("death, suicide and score accounting retain native ordering and finite-life elimination", () => {
  const victim = worm("b", 1, { kills: 3, lives: 0 });
  const state = match([worm("a"), victim]);
  recordInjury(state, "b", 101, "a", DEFAULT_SETTINGS);
  assert.equal(victim.deaths, 1);
  assert.equal(victim.lives, -1);
  assert.equal(shouldRespawn(victim, 10_000, DEFAULT_SETTINGS), false);
  const self = match([worm("a", 0, { kills: 1 }), worm("b", 1)]);
  const penalized = { ...DEFAULT_SETTINGS, suicideDecreasesScore: true };
  recordInjury(self, "a", 101, "a", penalized);
  assert.equal(self.worms[0]!.suicides, 1);
  assert.equal(self.worms[0]!.kills, 1);
  assert.equal(score(self.worms[0]!, penalized), 0);
  assert.equal(
    self.worms[0]!.deaths,
    0,
    "suicide penalty takes effect before addDeath checks for a positive score",
  );
});

test("healing can exceed 100 outside capped bonus handling and damage ignores dead or ended worms", () => {
  const state = match();
  recordInjury(state, "a", -25, "a", DEFAULT_SETTINGS);
  assert.equal(state.worms[0]!.health, 125);
  assert.equal(state.worms[0]!.damageScore, 0);
  recordInjury(state, "a", 10, "a", { ...DEFAULT_SETTINGS, selfInjure: false });
  assert.equal(state.worms[0]!.health, 125);
  state.phase = "done";
  recordInjury(state, "a", 999, "b", DEFAULT_SETTINGS);
  assert.equal(state.worms[0]!.health, 125);
});

test("respawn is strictly after 2.5s, has no invented grace, and resets only the match-owned spawn state", () => {
  const state = match(),
    target = state.worms[1]!;
  state.elapsedMs = 100;
  recordInjury(state, "b", 101, "a", DEFAULT_SETTINGS);
  assert.equal(shouldRespawn(target, 2_600, DEFAULT_SETTINGS), false);
  assert.equal(shouldRespawn(target, 2_601, DEFAULT_SETTINGS), true);
  resetSpawnMatchState(target, { x: 20.123, y: 10.5 });
  assert.equal(target.x, Math.fround(20.123));
  assert.equal(target.health, 100);
  assert.equal(target.alive, true);
  assert.equal(target.respawnAtMs, null);
  recordInjury(state, "b", 1, "a", DEFAULT_SETTINGS);
  assert.equal(target.health, 99, "there is no post-spawn damage immunity");
});

test("disabled automatic respawn waits for a request; unselected weapons block initial spawning", () => {
  const settings = { ...DEFAULT_SETTINGS, maxRespawnTimeMs: -1 };
  const target = worm("a", 0, { alive: false, health: 0, respawnAtMs: 2_500 });
  assert.equal(shouldRespawn(target, 3_000, settings), false);
  assert.equal(updateRespawnEligibility(target, 2_500, settings), false);
  assert.equal(
    target.canRespawnNow,
    false,
    "strict timeout means client phase cannot request at the boundary",
  );
  assert.equal(updateRespawnEligibility(target, 2_501, settings), false);
  assert.equal(
    target.canRespawnNow,
    true,
    "server eligibility is published after client input",
  );
  target.respawnRequested = true;
  assert.equal(shouldRespawn(target, 3_000, settings), true);
  assert.equal(updateRespawnEligibility(target, 3_000, settings), true);
  target.spawnedOnce = false;
  target.weaponsReady = false;
  assert.equal(shouldRespawn(target, 3_000, settings), false);
});

test("first spawn bypasses the 2.5s gate but still obeys automatic/manual spawn policy", () => {
  const target = worm("a", 0, { alive: false, spawnedOnce: false });
  assert.equal(
    shouldRespawn(target, 0, DEFAULT_SETTINGS),
    false,
    "native max respawn timeout uses strict greater-than",
  );
  assert.equal(shouldRespawn(target, 1, DEFAULT_SETTINGS), true);
  const manual = { ...DEFAULT_SETTINGS, maxRespawnTimeMs: -1 };
  assert.equal(updateRespawnEligibility(target, 1, manual), false);
  assert.equal(target.canRespawnNow, true);
  target.respawnRequested = true;
  assert.equal(updateRespawnEligibility(target, 1, manual), true);
});

test("native winner uses score then rounded damage, with full ties keeping slot order regardless of health/deaths", () => {
  const a = worm("a", 0, { kills: 3, deaths: 4, health: 1, damageScore: 200 });
  const b = worm("b", 1, {
    kills: 3,
    deaths: 0,
    health: 100,
    damageScore: 200.5,
  });
  assert.equal(compareWorms(b, a, DEFAULT_SETTINGS), 0, "native Round(.5)=0");
  assert.equal(chooseWinner([b, a], DEFAULT_SETTINGS), "a");
  b.damageScore = 200.75;
  assert.equal(chooseWinner([a, b], DEFAULT_SETTINGS), "b");
});

test("finite lives outrank score until a kill limit is hit, and temporarily dead survivors remain contenders", () => {
  const settings = { ...DEFAULT_SETTINGS, lives: 3 };
  const a = worm("a", 0, { kills: 14, lives: 1 });
  const b = worm("b", 1, { kills: 2, lives: 3, alive: false, health: 0 });
  assert.equal(chooseWinner([a, b], settings), "b");
  a.kills = 15;
  assert.equal(chooseWinner([a, b], settings), "a");
  a.lives = -1;
  a.kills = 0;
  assert.equal(chooseWinner([a, b], settings), "b");
});

test("match stops at kill limit or strictly after six minutes; no crowns or automatic round are inserted", () => {
  const state = match();
  state.elapsedMs = 360_000;
  assert.equal(stepMatch(state, DEFAULT_SETTINGS), false);
  state.elapsedMs++;
  assert.equal(stepMatch(state, DEFAULT_SETTINGS), true);
  assert.equal(state.phase, "done");
  assert.equal(state.winner, "a");
  const kills = match();
  kills.worms[1]!.kills = 15;
  assert.equal(stepMatch(kills, DEFAULT_SETTINGS), true);
  assert.equal(kills.winner, "b");
  const alone = match([worm("a")]);
  assert.equal(stepMatch(alone, DEFAULT_SETTINGS, true), false);
  assert.equal(stepMatch(alone, DEFAULT_SETTINGS), true);
});

test("server match timeout uses the incremented outer frame independently of current physics time", () => {
  const state = match();
  state.elapsedMs = 359_990;
  assert.equal(stepMatch(state, DEFAULT_SETTINGS, false, 360_000), false);
  state.elapsedMs = 360_000;
  assert.equal(stepMatch(state, DEFAULT_SETTINGS, false, 360_010), true);
  assert.equal(
    state.elapsedMs,
    360_000,
    "server-frame time must not mutate the physics clock",
  );
});

test("FindSpot permits dirt, checks the native half-open rock box and preserves float candidate coordinates", () => {
  const checked: [number, number][] = [];
  const terrain: SpawnTerrain = {
    width: 40,
    height: 30,
    isRock(x, y) {
      checked.push([x, y]);
      return x === 23;
    },
  };
  const point = findSpawnPoint(terrain, new Random());
  assert.deepEqual(point, { x: 20, y: 15 });
  assert.equal(checked.length, 36);
  assert.ok(checked.some(([x, y]) => x === 22 && y === 17));
  assert.equal(
    checked.some(([x]) => x === 23),
    false,
  );
});

test("bonuses are off by default; enabled spawn/expiry use strict native intervals and reused fixed slots", () => {
  const state: BonusState = {
    elapsedMs: 30_000,
    nextBonusAtMs: 30_000,
    nextId: 8,
    bonuses: [],
  };
  const rng = new Random([0.5], [0]);
  assert.equal(
    stepBonuses(state, DEFAULT_SETTINGS, dirt, rng, [2, 6]),
    undefined,
  );
  const enabled = { ...DEFAULT_SETTINGS, bonuses: true };
  assert.equal(stepBonuses(state, enabled, dirt, rng, [2, 6]), undefined);
  state.elapsedMs++;
  const bonus = stepBonuses(state, enabled, dirt, rng, [2, 6]);
  assert.ok(bonus);
  assert.equal(bonus.id, 0);
  assert.equal(bonus.type, "weapon");
  assert.equal(bonus.weaponId, 2);
  assert.equal(state.nextId, 8);
  assert.deepEqual(rng.requestedInts, [999, 1]);
  state.elapsedMs = bonus.spawnedAtMs + 60_000;
  state.nextBonusAtMs = 999_999;
  stepBonuses(state, enabled, dirt, rng, [2, 6]);
  assert.equal(state.bonuses.length, 1);
  state.elapsedMs++;
  stepBonuses(state, enabled, dirt, rng, [2, 6]);
  assert.equal(state.bonuses.length, 0);
});

test("server bonus expiry uses spawn timestamps rather than accumulated client physics life", () => {
  const bonus: MatchBonus = {
    id: 0,
    x: 20,
    y: 20,
    type: "health",
    weaponId: -1,
    spawnedAtMs: 0,
    vx: 0,
    vy: 0,
    life: 100,
    flashTime: 0,
  };
  const state: BonusState = {
    elapsedMs: 50_000,
    nextBonusAtMs: 999_999,
    nextId: 8,
    bonuses: [bonus],
  };
  stepBonuses(
    state,
    { ...DEFAULT_SETTINGS, bonuses: true },
    dirt,
    new Random(),
    [2],
  );
  assert.equal(
    state.bonuses.length,
    1,
    "client life>60 is not the server's expiry condition",
  );
  bonus.life = 0;
  state.elapsedMs = 60_001;
  stepBonuses(
    state,
    { ...DEFAULT_SETTINGS, bonuses: true },
    dirt,
    new Random(),
    [2],
  );
  assert.equal(
    state.bonuses.length,
    0,
    "server timestamp expiry does not wait for client visual lifetime",
  );
});

test("health bonus uses inclusive native10..50 healing and strict7px collision; full health leaves the bonus", () => {
  const slot = { weaponId: 2, charge: 1, reloading: false };
  const recipient: BonusRecipient = { ...worm("a"), weapon: 0, slots: [slot] };
  const bonus: MatchBonus = {
    id: 0,
    x: 20,
    y: 20,
    type: "health",
    weaponId: -1,
    spawnedAtMs: 0,
    vx: 0,
    vy: 0,
    life: 0,
    flashTime: 0,
  };
  const random = new Random([0.5], [40]);
  assert.equal(collectBonus(recipient, bonus, random), false);
  assert.deepEqual(random.requestedInts, []);
  recipient.health = 20;
  recipient.x = 27;
  assert.equal(collectBonus(recipient, bonus, random), false);
  recipient.x = 26.99;
  assert.equal(collectBonus(recipient, bonus, random), true);
  assert.equal(recipient.health, 70);
  assert.deepEqual(random.requestedInts, [40]);
});

test("weapon pickup replaces current slot and fully charges it without resetting LastFire", () => {
  const slot = { weaponId: 2, charge: 0.2, reloading: true, lastFire: 0.4 };
  const recipient: BonusRecipient = { ...worm("a"), weapon: 0, slots: [slot] };
  const bonus: MatchBonus = {
    id: 0,
    x: 20,
    y: 20,
    type: "weapon",
    weaponId: 6,
    spawnedAtMs: 0,
    vx: 0,
    vy: 0,
    life: 0,
    flashTime: 0,
  };
  assert.equal(collectBonus(recipient, bonus, new Random()), true);
  assert.deepEqual(slot, {
    weaponId: 6,
    charge: 1,
    reloading: false,
    lastFire: 0.4,
  });
});

test("native bonus gravity uses the physics clock and settles above the first solid pixel", () => {
  const bonus: MatchBonus = {
    id: 0,
    x: 20,
    y: 10,
    type: "weapon",
    weaponId: 6,
    spawnedAtMs: 0,
    vx: 0,
    vy: 0,
    life: 0,
    flashTime: 0,
  };
  const terrain = {
    width: 40,
    height: 30,
    material(_x: number, y: number) {
      return { wormPass: y < 20, particlePass: y < 20, canHook: y >= 20 };
    },
    carve: () => 0,
  };
  simulateBonuses([bonus], terrain);
  // Native clang++ evaluation of PhysicsLX56.cpp's float operations (11ms, y=10, vy=0).
  assert.equal(bonus.vy, 0.8800000548362732);
  assert.equal(bonus.y, 10.009679794311523);
  for (let i = 0; i < 100; i++) simulateBonuses([bonus], terrain);
  assert.equal(bonus.y, 18);
  assert.equal(bonus.vy, 0);
  bonus.life = 58;
  for (let i = 0; i < 28; i++) simulateBonuses([bonus], terrain);
  assert.equal(bonus.flashTime, 0);
});

test("nearby bonuses are consumed by explosion in native slot order and inclusive15px box", () => {
  const base: MatchBonus = {
    id: 4,
    x: 20,
    y: 20,
    type: "weapon",
    weaponId: 6,
    spawnedAtMs: 0,
    vx: 0,
    vy: 0,
    life: 0,
    flashTime: 0,
  };
  const bonuses = [
    { ...base },
    { ...base, id: 1, x: 35, y: 35 },
    { ...base, id: 2, x: 35.01 },
  ];
  assert.equal(takeExplosionBonus(bonuses, 20, 20)?.id, 1);
  assert.equal(takeExplosionBonus(bonuses, 20, 20)?.id, 4);
  assert.equal(takeExplosionBonus(bonuses, 20, 20), undefined);
  assert.equal(bonuses.length, 1);
});
