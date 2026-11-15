/**
 * Source-derived OpenLieroX Classic death-match contracts.
 * Original code: Jason Boettcher, Dark Charlie, Albert Zeyer and OpenLieroX contributors.
 * Derived from OpenLieroX 0a20c6d0a10ed63b28a15f05c771913c294efbf6; code under LGPL.
 * See CGameMode.cpp, CServer_Game.cpp, CWorm.cpp, CGameObject.cpp and FeatureList.cpp.
 */
import type { ClassicLevelId } from "./level-types.js";

export interface ClassicSettings {
  level: ClassicLevelId;
  display: boolean;
  killLimit: number;
  timeLimitMs: number;
  lives: number;
  bonuses: boolean;
  loadingTime: number;
  restrictionPreset: "standard-100lt" | "all";
  respawnTimeMs: number;
  maxRespawnTimeMs: number;
  suicideDecreasesScore: boolean;
  deathDecreasesScore: number;
  allowNegativeScore: boolean;
  selfInjure: boolean;
}

export type ClassicLoadout = [number, number, number, number, number];

export const DEFAULT_SETTINGS: ClassicSettings = {
  // User-requested larger native arena; Dirt remains the original startup map option.
  level: "jail-break",
  display: false,
  killLimit: 15,
  timeLimitMs: 360_000,
  lives: -2,
  bonuses: false,
  loadingTime: 100,
  restrictionPreset: "standard-100lt",
  respawnTimeMs: 2_500,
  maxRespawnTimeMs: 0,
  suicideDecreasesScore: false,
  deathDecreasesScore: 0,
  allowNegativeScore: false,
  selfInjure: true,
};

export interface MatchWorm {
  id: string;
  slot: number;
  x: number;
  y: number;
  health: number;
  alive: boolean;
  kills: number;
  deaths: number;
  suicides: number;
  damageScore: number;
  /** -2 is unlimited, -1 is eliminated; 0 is the last remaining life. */
  lives: number;
  /** Earliest time after which a dead worm may respawn (strictly greater, not equal). */
  respawnAtMs: number | null;
  spawnedOnce: boolean;
  respawnRequested: boolean;
  canRespawnNow: boolean;
  weaponsReady: boolean;
}

export interface MatchState {
  elapsedMs: number;
  worms: MatchWorm[];
  winner: string | null;
  phase: "play" | "done";
}

/** The production adapter must keep this RNG's evolving state in its world checkpoint. */
export interface MatchRandom {
  nextFloat(): number;
  /** OpenLieroX GetRandomInt includes its maximum. */
  nextInt(maxInclusive: number): number;
}

export interface SpawnTerrain {
  readonly width: number;
  readonly height: number;
  isRock(x: number, y: number): boolean;
}

export interface MatchBonus {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Native physics-clock seconds, separate from server expiry time. */
  life: number;
  flashTime: number;
  type: "health" | "weapon";
  weaponId: number;
  spawnedAtMs: number;
}

export type ClassicBonus = MatchBonus;

export interface BonusState {
  elapsedMs: number;
  nextBonusAtMs: number;
  nextId: number;
  bonuses: MatchBonus[];
}

export interface BonusWeaponSlot {
  weaponId: number;
  charge: number;
  reloading: boolean;
}

/** A physics/weapon adapter implements this through its authoritative worm state. */
export interface BonusRecipient extends MatchWorm {
  weapon: number;
  slots: BonusWeaponSlot[];
}
