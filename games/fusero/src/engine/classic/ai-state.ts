/* Altered port of CWormBotInputHandler state/lifecycle, CWormBot.h:46–97 and
 * CWormBot.cpp:884–926,4088–4126. OpenLieroX 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * Jason Boettcher, Dark Charlie, Albert Zeyer and contributors; LGPL.
 */
import { createAiSearch, type AiSearch } from "./ai-path.js";
import { point, type AiPoint, type AiTerrain } from "./ai-geometry.js";
import type { BotGameType } from "./bot-arsenal.js";
import type { ClassicControls, PhysicsTerrainPort } from "./physics-types.js";
import type { World, Worm } from "./model.js";

export type AiDifficulty = 0 | 1 | 2 | 3;
/** Native AI's zero AbsTime sentinels predate the menu-prepared match. */
export const NATIVE_AI_EPOCH_MS = 1000;
export const aiNow = (frame: Pick<NativeAiFrame, "world">): number =>
  frame.world.elapsedMs + NATIVE_AI_EPOCH_MS;
export interface NativeAiShared {
  angleNoise: [number, number, number];
  angleNoiseAtMs: number;
  trajectoryNoise: [number, number, number, number];
  trajectoryNoiseAtMs: number;
}
export interface NativeAiState {
  difficulty: AiDifficulty;
  gameType: BotGameType;
  mode: "think" | "moving";
  targetType: "none" | "worm" | "bonus" | "position";
  targetWormId: string | null;
  bonusId: number | null;
  bonusPosition: AiPoint;
  targetPosition: AiPoint;
  stuckPosition: AiPoint;
  stuckMs: number;
  stuck: boolean;
  stuckPauseAtMs: number;
  lastThinkMs: number;
  lastFaceMs: number;
  badAimMs: number;
  randomSpread: number;
  lastShootTarget: AiPoint;
  lastShootMs: number;
  lastJumpMs: number;
  lastWeaponChangeMs: number;
  lastPathCreatedMs: number;
  lastRandomChangeMs: number;
  lastGoBackMs: number;
  lastCarveMs: number;
  ropeAttachedMs: number;
  ropeFlightMs: number;
  pathFinished: boolean;
  searchStartedAtMs: number;
  search: AiSearch;
  path: AiPoint[];
  currentNode: number | null;
  spawnedAtMs: number;
}

/** Explicit per-input data, with eligible worms in native slot iteration order. */
export interface NativeAiFrame {
  world: World;
  worm: Worm;
  ai: NativeAiState;
  shared: NativeAiShared;
  terrain: AiTerrain;
  physicsTerrain: PhysicsTerrainPort;
  targets: readonly Worm[];
  /** Native bot aim/timers use outer frame delta, not human input-clock elapsed time. */
  deltaMs: number;
  controls: ClassicControls;
}

export function createNativeAiShared(): NativeAiShared {
  return {
    angleNoise: [0, 0, 0],
    angleNoiseAtMs: 0,
    trajectoryNoise: [0, 0, 0, 0],
    trajectoryNoiseAtMs: 0,
  };
}
export function createNativeAiState(
  gameType: BotGameType,
  difficulty: AiDifficulty = 1,
): NativeAiState {
  return {
    difficulty,
    gameType,
    mode: "think",
    targetType: "none",
    targetWormId: null,
    bonusId: null,
    bonusPosition: point(0, 0),
    targetPosition: point(0, 0),
    stuckPosition: point(-999, -999),
    stuckMs: 0,
    stuck: false,
    stuckPauseAtMs: 0,
    lastThinkMs: 0,
    lastFaceMs: 0,
    badAimMs: 0,
    randomSpread: 0,
    lastShootTarget: point(0, 0),
    lastShootMs: 0,
    lastJumpMs: 0,
    lastWeaponChangeMs: 0,
    lastPathCreatedMs: 0,
    lastRandomChangeMs: 0,
    lastGoBackMs: 0,
    lastCarveMs: 0,
    ropeAttachedMs: 0,
    ropeFlightMs: 0,
    pathFinished: true,
    searchStartedAtMs: 0,
    search: createAiSearch(),
    path: [],
    currentNode: null,
    spawnedAtMs: 0,
  };
}
export const emptyAiControls = (): ClassicControls => ({
  move: false,
  jump: false,
  carve: false,
  shoot: false,
  weaponDelta: 0,
  weaponSlot: null,
});
