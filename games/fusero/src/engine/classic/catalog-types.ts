/** Pinned LX56 v7 data, before runtime scaling; all flags retain their native 0/1 representation. */
export type ClassicFlag = 0 | 1;
export type ClassicProjectileId = number;

interface LegacyActionFields {
  readonly projectiles?: ClassicFlag;
  readonly useSound?: ClassicFlag;
  readonly sound?: string;
  readonly shake?: number;
}

/** Legacy Exp/Touch blocks contain unused damage fields even when their action is Nothing. */
export type ClassicAction = LegacyActionFields &
  (
    | {
        readonly type: 0;
        readonly name: "bounce";
        readonly bounceCoeff: number;
        readonly bounceExplode?: number;
      }
    | { readonly type: 1; readonly name: "explode"; readonly damage: number }
    | { readonly type: 2; readonly name: "injure"; readonly damage: number }
    | { readonly type: 4; readonly name: "carve"; readonly damage: number }
    | { readonly type: 5; readonly name: "dirt"; readonly damage?: number }
    | { readonly type: 6; readonly name: "greendirt"; readonly damage?: number }
    | { readonly type: 7; readonly name: "disappear"; readonly damage?: number }
    | { readonly type: 8; readonly name: "nothing"; readonly damage?: number }
    | {
        readonly type: 9;
        readonly name: "disappear2";
        readonly damage?: number;
      }
    | {
        readonly type: 10;
        readonly name: "gothrough";
        readonly damage?: number;
      }
  );

interface SpawnBase {
  readonly amount: number;
  readonly speed: number;
  readonly speedVar: number;
  readonly spread: number;
  readonly projectileId: ClassicProjectileId;
}
export interface ClassicSpawn extends SpawnBase {
  readonly useAngle: ClassicFlag;
  readonly angle: number;
}
export interface ClassicTrail extends SpawnBase {
  readonly useParentVelocityForSpread: ClassicFlag;
  readonly delayMs: number;
}
/** ANI_ONCE expiry uses native bitmap width / height, even when replacement art differs. */
export interface ClassicBitmap {
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
}
interface ProjectileBase {
  readonly id: ClassicProjectileId;
  readonly sourceOffset: number;
  readonly timerTime: number;
  readonly timerVar: number;
  readonly trailType: 0 | 1 | 2 | 3 | 4 | 5;
  readonly customGravity: ClassicFlag;
  readonly gravity?: number;
  readonly dampening: number;
  /** LX56 logical hitbox dimensions, independent of the replacement sprite. */
  readonly width: number;
  readonly height: number;
  readonly hit: ClassicAction;
  readonly timer?: ClassicAction;
  readonly playerHit: ClassicAction;
  readonly explode: ClassicAction;
  readonly touch: ClassicAction;
  readonly spawn?: ClassicSpawn;
  readonly trail?: ClassicTrail;
}
export type ClassicProjectile = ProjectileBase &
  (
    | {
        readonly type: "pixel";
        readonly rawType: 0;
        readonly colors: readonly (readonly [number, number, number])[];
      }
    | {
        readonly type: "image";
        readonly rawType: 1;
        readonly image: string;
        readonly rotating: ClassicFlag;
        readonly rotIncrement: number;
        readonly rotSpeed: number;
        readonly useAngle: ClassicFlag;
        readonly useSpecAngle: ClassicFlag;
        readonly angleImages?: number;
        readonly animating: ClassicFlag;
        readonly animRate?: number;
        readonly animType?: number;
        readonly bitmap?: ClassicBitmap;
      }
  );
interface WeaponBase {
  readonly id: number;
  readonly sourceOffset: number;
  readonly name: string;
  readonly recoil: number;
  /** Native file value: the runtime charges this / 10 per second at 100% loading. */
  readonly recharge: number;
  /** Charge percentage consumed per trigger shot, not per spawned projectile. */
  readonly drain: number;
  /** Native file milliseconds; the runtime divides by 1000. */
  readonly rofMs: number;
  readonly laser: ClassicFlag;
}
export interface ClassicBeam {
  readonly color: readonly [number, number, number];
  readonly damage: number;
  readonly playerDamage: number;
  readonly length: number;
}
export type ClassicWeapon = WeaponBase &
  (
    | {
        readonly type: "projectile";
        readonly rawType: 0;
        readonly class: number;
        readonly speed: number;
        readonly speedVar: number;
        readonly spread: number;
        readonly amount: number;
        readonly useSound: ClassicFlag;
        readonly sound?: string;
        readonly projectileId: ClassicProjectileId;
      }
    | { readonly type: "beam"; readonly rawType: 2; readonly beam: ClassicBeam }
  );
export interface ClassicPhysics {
  readonly rope: {
    readonly length: number;
    readonly rest: number;
    readonly strength: number;
  };
  readonly worm: {
    readonly angleSpeed: number;
    readonly groundSpeed: number;
    readonly airSpeed: number;
    readonly gravity: number;
    readonly jumpForce: number;
    readonly airFriction: number;
    /** Retained from the file even though CGameScript::Load does not put it into mod settings. */
    readonly groundFriction: number;
  };
}
export interface ClassicCatalogData {
  readonly sourceSha256: string;
  readonly scriptId: "Liero Game Script";
  readonly version: 7;
  readonly modName: string;
  readonly decodedBytes: number;
  readonly weapons: readonly ClassicWeapon[];
  readonly projectiles: readonly ClassicProjectile[];
  readonly physics: ClassicPhysics;
}
