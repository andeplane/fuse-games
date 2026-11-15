/**
 * Source-derived OpenLieroX Classic death-match rules; this is an altered TypeScript port.
 * Original code: Jason Boettcher, Dark Charlie, Albert Zeyer and OpenLieroX contributors.
 * OpenLieroX commit 0a20c6d0a10ed63b28a15f05c771913c294efbf6; code under LGPL.
 * See CGameMode.cpp, CServer_Game.cpp, CWorm.cpp, CGameObject.cpp and CMap.cpp.
 */
import {
  DEFAULT_SETTINGS,
  type BonusRecipient,
  type BonusState,
  type ClassicSettings,
  type ClassicLoadout,
  type MatchBonus,
  type MatchRandom,
  type MatchState,
  type MatchWorm,
  type SpawnTerrain,
} from "./match-types.js";
import { CLASSIC_WEAPONS } from "./catalog.js";
import type { PhysicsTerrainPort } from "./physics-types.js";
import { isClassicLevelId } from "./level.js";

export { DEFAULT_SETTINGS } from "./match-types.js";
export type { ClassicSettings, MatchState, MatchWorm } from "./match-types.js";

/** Actual startup default, not merely a bundled example: FeatureList defaultValue is Standard 100lt. */
const STANDARD_WEAPONS = new Set([
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
]);

export function allowedWeaponIds(
  settings: Pick<ClassicSettings, "restrictionPreset">,
): number[] {
  return CLASSIC_WEAPONS.filter(
    (weapon) =>
      settings.restrictionPreset === "all" || STANDARD_WEAPONS.has(weapon.name),
  ).map((weapon) => weapon.id);
}

/** Manual native selection permits duplicate weapons; do not silently impose a uniqueness rule. */
export function validLoadout(
  raw: unknown,
  settings: Pick<ClassicSettings, "restrictionPreset">,
): raw is ClassicLoadout {
  const allowed = new Set(allowedWeaponIds(settings));
  return (
    Array.isArray(raw) &&
    raw.length === 5 &&
    raw.every(
      (id) => typeof id === "number" && Number.isInteger(id) && allowed.has(id),
    )
  );
}

/** A missing/forbidden profile slot falls back to the first enabled mod weapon, independently for all five slots. */
export function defaultLoadout(
  settings: Pick<ClassicSettings, "restrictionPreset">,
): ClassicLoadout {
  const first = allowedWeaponIds(settings)[0]!;
  return [first, first, first, first, first];
}

/** Exact GetRandomWeapons cycling, including its native MAX(1, random) starting-index quirk. */
export function randomLoadout(
  settings: Pick<ClassicSettings, "restrictionPreset">,
  random: MatchRandom,
): ClassicLoadout {
  const allowed = new Set(allowedWeaponIds(settings));
  const result: number[] = [];
  for (let slot = 0; slot < 5; slot++) {
    const start = Math.max(1, random.nextInt(CLASSIC_WEAPONS.length - 1));
    let next = start,
      lastEnabled = -1;
    for (;;) {
      if (next >= CLASSIC_WEAPONS.length) next = 0;
      if (allowed.has(next)) {
        if (!result.includes(next)) break;
        lastEnabled = next;
      }
      next++;
      if (next === start) {
        next = lastEnabled;
        break;
      }
    }
    result.push(next);
  }
  return [result[0]!, result[1]!, result[2]!, result[3]!, result[4]!];
}

const integer = (raw: unknown, low: number, high: number): raw is number =>
  typeof raw === "number" && Number.isInteger(raw) && raw >= low && raw <= high;
const finite = (raw: unknown, low: number, high: number): raw is number =>
  typeof raw === "number" && Number.isFinite(raw) && raw >= low && raw <= high;

/** Exact boundary shape; extra fields and NaN must not enter a peer checkpoint. */
export function parseSettings(raw: unknown): ClassicSettings | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(DEFAULT_SETTINGS);
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    return;
  if (
    !isClassicLevelId(value.level) ||
    typeof value.display !== "boolean" ||
    !integer(value.killLimit, -1, 150) ||
    !integer(value.timeLimitMs, -1, 1_200_000) ||
    !(value.lives === -2 || integer(value.lives, 0, 150)) ||
    typeof value.bonuses !== "boolean" ||
    !finite(value.loadingTime, 0, 500) ||
    (value.restrictionPreset !== "standard-100lt" &&
      value.restrictionPreset !== "all") ||
    !integer(value.respawnTimeMs, 0, 20_000) ||
    !integer(value.maxRespawnTimeMs, -1, 20_000) ||
    typeof value.suicideDecreasesScore !== "boolean" ||
    !finite(value.deathDecreasesScore, 0, 5) ||
    typeof value.allowNegativeScore !== "boolean" ||
    typeof value.selfInjure !== "boolean"
  )
    return;
  return { ...value } as unknown as ClassicSettings;
}

/** CWorm::getScore truncates the death penalty after a small precision allowance. */
export function score(worm: MatchWorm, settings: ClassicSettings): number {
  let result = worm.kills;
  if (settings.deathDecreasesScore > 0)
    result -= Math.trunc(
      Math.fround(
        Math.fround(worm.deaths * settings.deathDecreasesScore) + 0.01,
      ),
    );
  if (settings.suicideDecreasesScore) result -= worm.suicides;
  return result;
}

/** Round(float) in MathLib.cpp is ceil(double(x)-0.5), with ties towards negative infinity. */
const nativeRound = (value: number): number =>
  Math.ceil(Math.fround(value) - 0.5);

export function compareWorms(
  a: MatchWorm,
  b: MatchWorm,
  settings: ClassicSettings,
): number {
  if (settings.lives >= 0) {
    if (settings.killLimit > 0) {
      if (score(a, settings) >= settings.killLimit) return 1;
      if (score(b, settings) >= settings.killLimit) return -1;
    }
    if (a.lives > b.lives) return 1;
    if (a.lives < b.lives) return -1;
  }
  if (a.lives !== -1 && b.lives === -1) return 1;
  if (b.lives !== -1 && a.lives === -1) return -1;
  const difference = score(a, settings) - score(b, settings);
  if (difference) return difference > 0 ? 1 : -1;
  return nativeRound(Math.fround(a.damageScore - b.damageScore));
}

/** Worm iteration is stable slot order. Full ties retain the first worm, not the healthier worm. */
export function chooseWinner(
  worms: readonly MatchWorm[],
  settings: ClassicSettings,
): string | null {
  const ordered = [...worms].sort((a, b) => a.slot - b.slot);
  const living = ordered.filter((worm) => worm.lives !== -1);
  // Native getAliveWormCount/getFirstAliveWorm concern lives != WRM_OUT, including temporarily dead worms.
  if (living.length === 1) return living[0]!.id;
  let highest: MatchWorm | undefined;
  for (const worm of ordered)
    if (!highest || compareWorms(worm, highest, settings) > 0) highest = worm;
  return highest?.id ?? null;
}

export interface InjuryResult {
  damage: number;
  killed: boolean;
}

/** Default death match: no spawn grace. Exactly 0 health is still alive in CGameObject::injure. */
export function recordInjury(
  state: MatchState,
  victimId: string,
  amount: number,
  ownerId: string | null,
  settings: ClassicSettings,
): InjuryResult {
  const victim = state.worms.find((worm) => worm.id === victimId);
  if (state.phase !== "play" || !victim?.alive || !Number.isFinite(amount))
    return { damage: 0, killed: false };
  const owner = state.worms.find((worm) => worm.id === ownerId);
  if (amount > 0 && owner === victim && !settings.selfInjure)
    return { damage: 0, killed: false };
  const damage = Math.fround(amount);
  const realDamage = Math.min(victim.health, damage);
  if (owner && realDamage >= 0) {
    if (owner !== victim)
      owner.damageScore = Math.fround(owner.damageScore + realDamage);
    else if (settings.suicideDecreasesScore)
      owner.damageScore = Math.fround(owner.damageScore - realDamage);
  }
  victim.health = Math.fround(victim.health - damage);
  if (victim.health >= 0) return { damage: realDamage, killed: false };
  victim.health = 0;
  if (owner === victim) {
    if (settings.allowNegativeScore || score(victim, settings) > 0)
      victim.suicides++;
  } else if (owner) owner.kills++;
  if (settings.allowNegativeScore || score(victim, settings) > 0)
    victim.deaths++;
  if (victim.lives !== -2) victim.lives--;
  victim.alive = false;
  victim.respawnAtMs = state.elapsedMs + settings.respawnTimeMs;
  victim.respawnRequested = false;
  victim.canRespawnNow = false;
  return { damage: realDamage, killed: true };
}

/** Match timers and respawn use strict greater-than comparisons in the native server. */
export function shouldRespawn(
  worm: MatchWorm,
  elapsedMs: number,
  settings: ClassicSettings,
): boolean {
  if (worm.alive || worm.lives === -1 || !worm.weaponsReady) return false;
  if (
    worm.spawnedOnce &&
    (worm.respawnAtMs === null || elapsedMs <= worm.respawnAtMs)
  )
    return false;
  const diedAt = worm.spawnedOnce
    ? worm.respawnAtMs! - settings.respawnTimeMs
    : 0;
  return (
    worm.respawnRequested ||
    (settings.maxRespawnTimeMs >= 0 &&
      elapsedMs > diedAt + settings.maxRespawnTimeMs)
  );
}

/**
 * CServer::SimulateGame runs after the client's input/physics phase. If automatic respawn is disabled or not
 * yet due, a modern client is told it may request one; only a later eligible jump edge makes that request.
 */
export function updateRespawnEligibility(
  worm: MatchWorm,
  elapsedMs: number,
  settings: ClassicSettings,
): boolean {
  if (worm.alive || worm.lives === -1 || !worm.weaponsReady) return false;
  if (
    worm.spawnedOnce &&
    (worm.respawnAtMs === null || elapsedMs <= worm.respawnAtMs)
  )
    return false;
  if (shouldRespawn(worm, elapsedMs, settings)) return true;
  worm.canRespawnNow = true;
  return false;
}

/** The composition root also resets physics, input, rope and every slot's charge through their own contracts. */
export function resetSpawnMatchState(
  worm: MatchWorm,
  position: { x: number; y: number },
): void {
  worm.x = Math.fround(position.x);
  worm.y = Math.fround(position.y);
  worm.health = 100;
  worm.alive = true;
  worm.spawnedOnce = true;
  worm.respawnRequested = false;
  worm.canRespawnNow = false;
  worm.respawnAtMs = null;
}

/** CMap::FindSpot accepts dirt; its half-open area check rejects rock at offsets -3..2 on both axes. */
export function findSpawnPoint(
  terrain: SpawnTerrain,
  random: MatchRandom,
): { x: number; y: number } {
  let position = { x: 0, y: 0 };
  for (let attempt = 0; attempt < 1_000; attempt++) {
    position = {
      x: Math.fround(Math.fround(random.nextFloat()) * terrain.width),
      y: Math.fround(Math.fround(random.nextFloat()) * terrain.height),
    };
    const x = Math.trunc(position.x),
      y = Math.trunc(position.y);
    let rock = false;
    for (let py = y - 3; py < y + 3 && !rock; py++)
      for (let px = x - 3; px < x + 3; px++)
        if (terrain.isRock(px, py)) {
          rock = true;
          break;
        }
    if (!rock) return position;
  }
  return position;
}

/** One native deathmatch, with no invented crowns, intermission rounds or warmup countdown. */
export function stepMatch(
  state: MatchState,
  settings: ClassicSettings,
  solo = false,
  serverElapsedMs = state.elapsedMs,
): boolean {
  if (state.phase === "done") return true;
  const limit =
    settings.killLimit > 0 &&
    state.worms.some((worm) => score(worm, settings) >= settings.killLimit);
  const timeout =
    settings.timeLimitMs > 0 && serverElapsedMs > settings.timeLimitMs;
  const remaining = state.worms.filter((worm) => worm.lives !== -1).length;
  const minimum = solo && state.worms.length === 1 ? 1 : 2;
  if (!limit && !timeout && remaining >= minimum) return false;
  state.phase = "done";
  state.winner = chooseWinner(state.worms, settings);
  return true;
}

export const BONUS_FREQUENCY_MS = 30_000;
export const BONUS_LIFE_MS = 60_000;

/** Native server permits one spawn per frame after a missed interval; it does not backfill a burst. */
export function stepBonuses(
  state: BonusState,
  settings: ClassicSettings,
  terrain: SpawnTerrain,
  random: MatchRandom,
  availableWeaponIds: readonly number[],
  capacity = 32,
): MatchBonus | undefined {
  if (!settings.bonuses) return;
  state.bonuses = state.bonuses.filter(
    (bonus) => state.elapsedMs - bonus.spawnedAtMs <= BONUS_LIFE_MS,
  );
  if (state.elapsedMs <= state.nextBonusAtMs) return;
  state.nextBonusAtMs = state.elapsedMs + BONUS_FREQUENCY_MS;
  // SpawnBonus chooses a position and bonus kind before looking for a free slot.
  const position = findSpawnPoint(terrain, random);
  const type = random.nextInt(999) >= 500 ? "health" : "weapon";
  if (state.bonuses.length >= capacity) return;
  const weaponId = availableWeaponIds.length
    ? availableWeaponIds[random.nextInt(availableWeaponIds.length - 1)]!
    : -1;
  if (type === "weapon" && weaponId < 0) return;
  let id = 0;
  while (state.bonuses.some((bonus) => bonus.id === id)) id++;
  const bonus: MatchBonus = {
    ...position,
    id,
    type,
    weaponId,
    spawnedAtMs: state.elapsedMs,
    vx: 0,
    vy: 0,
    life: 0,
    flashTime: 0,
  };
  state.bonuses.push(bonus);
  return bonus;
}

/** Pickup overlap is an axis-aligned strict 7px check. A full-health worm leaves health bonuses untouched. */
export function collectBonus(
  worm: BonusRecipient,
  bonus: MatchBonus,
  random: MatchRandom,
): boolean {
  if (
    !worm.alive ||
    Math.abs(worm.x - bonus.x) >= 7 ||
    Math.abs(worm.y - bonus.y) >= 7
  )
    return false;
  if (bonus.type === "weapon") {
    const slot = worm.slots[worm.weapon];
    if (!slot) return false;
    // Native pickup resets charge/reloading, but does not reset the current slot's LastFire timer.
    slot.weaponId = bonus.weaponId;
    slot.charge = 1;
    slot.reloading = false;
    return true;
  }
  if (worm.health >= 100) return false;
  const healing = Math.min(random.nextInt(40) + 10, 100 - worm.health);
  worm.health = Math.fround(worm.health + healing);
  return true;
}

/** PhysicsLX56::simulateBonus: gravity, native 5x5 solid scan and stop-at-first-hit behavior. */
export function simulateBonuses(
  bonuses: MatchBonus[],
  terrain: PhysicsTerrainPort,
  dtMs = 11,
  infiniteMap = false,
): void {
  const dt = Math.fround(Math.fround(dtMs) * Math.fround(0.001));
  for (const bonus of bonuses) {
    bonus.life = Math.fround(bonus.life + dt);
    if (bonus.life > 57) {
      bonus.flashTime = Math.fround(bonus.flashTime + dt);
      if (bonus.flashTime > Math.fround(0.3)) bonus.flashTime = 0;
    }
    bonus.vy = Math.fround(bonus.vy + Math.fround(80 * dt));
    bonus.x = Math.fround(bonus.x + Math.fround(bonus.vx * dt));
    bonus.y = Math.fround(bonus.y + Math.fround(bonus.vy * dt));
    const px = Math.trunc(bonus.x),
      py = Math.trunc(bonus.y);
    let collided = false;
    for (let y = py - 2; y <= py + 2 && !collided; y++) {
      if (y < 0) continue;
      if (y >= terrain.height) {
        if (infiniteMap) bonus.y = Math.fround(bonus.y - terrain.height);
        else {
          bonus.vx = 0;
          bonus.vy = 0;
          bonus.y = y - 2;
        }
        collided = true;
        continue;
      }
      for (let x = px - 2; x <= px + 2; x++) {
        if (x < 0) continue;
        if (x >= terrain.width || !terrain.material(x, y).wormPass) {
          bonus.vx = 0;
          bonus.vy = 0;
          bonus.y = y - 2;
          collided = true;
          break;
        }
      }
    }
  }
}

/** Explosion consumes nearby bonuses in native fixed-slot order before recursively exploding them. */
export function takeExplosionBonus(
  bonuses: MatchBonus[],
  x: number,
  y: number,
): MatchBonus | undefined {
  let index = -1;
  for (let i = 0; i < bonuses.length; i++) {
    const bonus = bonuses[i]!;
    if (
      Math.abs(bonus.x - x) <= 15 &&
      Math.abs(bonus.y - y) <= 15 &&
      (index < 0 || bonus.id < bonuses[index]!.id)
    )
      index = i;
  }
  if (index < 0) return;
  return bonuses.splice(index, 1)[0];
}
