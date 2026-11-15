/* OpenLieroX LX56 — altered TypeScript port. Code under LGPL.
 * Based on Jason Boettcher's work, enhanced by Dark Charlie and Albert Zeyer.
 * Pinned source: 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 */
import type { PhysicsWorm } from "./physics-types.js";
import type { PositionRecorder } from "./history.js";

export const MAX_CLASSIC_PROJECTILES = 3000;
export interface WeaponSlot {
  weaponId: number;
  charge: number;
  reloading: boolean;
  lastFire: number;
}
/** Source shoot-list payload captured before later worms move or projectiles apply damage. */
export interface PreparedShot {
  owner: string;
  weaponId: number;
  angle: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  randomIndex: number;
  spawnTimeMs: number;
}
export interface CombatWorm extends PhysicsWorm {
  alive: boolean;
  weapon: number;
  slots: WeaponSlot[];
  /** Complete native ring, including stale slots retained across respawns. */
  positionRecordings: PositionRecorder;
}
export interface ClassicProjectileState {
  id: number;
  slot: number;
  descriptorId: number;
  owner: string;
  weaponId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  oldX: number;
  oldY: number;
  life: number;
  extra: number;
  randomIndex: number;
  timeVarRandom: number;
  spawnTimeMs: number;
  lastSimulationMs: number;
  ignoreOwnerBeforeMs: number;
  wallShootTime: number;
  lastTrailMs: number;
  rotation: number;
  frame: number;
  frameDelta: boolean;
  firstBounce: boolean;
  minCheck: number;
  maxCheck: number;
  avgCheck: number;
  checkSpeedLen: number;
  collisionSide: number;
  used: boolean;
}
export interface CombatEffect {
  id: number;
  kind:
    "explosion" | "muzzle" | "beam" | "smoke" | "chemical-smoke" | "doomsday";
  x: number;
  y: number;
  radius: number;
  lifeMs: number;
  endX?: number;
  endY?: number;
  owner?: string;
  /** Original sample name only when its native UseSound branch executes. Presentation consumes each id once. */
  sound?: string;
}
export interface CombatWorld {
  elapsedMs: number;
  nextId: number;
  rng: number;
  worms: CombatWorm[];
  projectiles: ClassicProjectileState[];
  effects: CombatEffect[];
}
export interface CombatMaterial {
  particlePass: boolean;
  destroyable: boolean;
}
/** Every gameplay effect is explicit; tests and production use the same public boundary. */
export interface CombatPorts {
  readonly width: number;
  readonly height: number;
  material(x: number, y: number): CombatMaterial;
  carveHole(size: number, x: number, y: number): number;
  placeDirt(x: number, y: number, green: boolean): number;
  injure(victimId: string, damage: number, ownerId: string): void;
  onDirtRemoved?(ownerId: string, count: number): void;
  /** Original bonuses within 15px of an explosion are removed and explode for damage15. */
  explodeBonuses?(x: number, y: number): number;
  /** Beam's direct bonus test is radius3; a hit invokes normal explosion/chain handling. */
  beamBonusAt?(x: number, y: number): boolean;
}
