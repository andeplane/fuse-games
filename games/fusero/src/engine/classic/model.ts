import type { CombatWorld, CombatWorm } from "./combat-types.js";
import type {
  ClassicSettings,
  MatchWorm,
  ClassicBonus,
} from "./match-types.js";
import type { PixelTerrain } from "./terrain-types.js";
import type { PreparedShot } from "./weapons.js";
import type { NativeAiShared, NativeAiState } from "./ai-state.js";

/** All mutable decisions live here. Mod descriptions and physical masks are immutable, pinned source data. */
export interface Worm extends CombatWorm, MatchWorm {
  lastInputTimeMs: number;
  canRespawnNow: boolean;
  ai: NativeAiState | null;
}

export interface World extends CombatWorld {
  seed: number;
  /** Completed native 10 ms outer frames. */
  step: number;
  lastClientPhysicsMs: number;
  pendingShots: PreparedShot[];
  phase: "play" | "done";
  winner: string | null;
  settings: ClassicSettings;
  terrain: PixelTerrain;
  worms: Worm[];
  bonuses: ClassicBonus[];
  nextBonusAtMs: number;
  aiShared: NativeAiShared;
}
