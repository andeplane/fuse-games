/*
 * OpenLieroX LX56 physics — altered TypeScript port for Fusero.
 * Source: openlierox/openlierox 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * Based on Jason Boettcher's work, enhanced by Dark Charlie and Albert Zeyer.
 * Code under LGPL; retain the upstream COPYING.LIB distributed with this port.
 */
import { sin, cos } from "./math.js";
export const LEFT = 1,
  RIGHT = 2,
  UP = 4,
  DOWN = 8,
  JUMP = 16,
  FIRE = 32,
  ROPE = 64,
  NEXT = 128,
  PREV = 256,
  CARVE = 512,
  SLOT1 = 1024,
  SLOT2 = 2048,
  SLOT3 = 4096,
  SLOT4 = 8192,
  SLOT5 = 16384,
  SELECT_MOD = 32768,
  STRAFE = 65536,
  INPUT_MASK = 131071;
export type Facing = 1 | -1;
export interface ClassicRope {
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: "shooting" | "falling" | "terrain" | "worm";
  attachedId: string | null;
}
export interface PhysicsWorm {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  facing: Facing;
  moveFacing: Facing;
  aimSpeed: number;
  onGround: boolean;
  input: number;
  health: number;
  alive: boolean;
  rope: ClassicRope | null;
}
export interface ClassicMaterial {
  wormPass: boolean;
  particlePass: boolean;
  canHook: boolean;
}
export interface PhysicsTerrainPort {
  readonly width: number;
  readonly height: number;
  material(x: number, y: number): ClassicMaterial;
  carve(x: number, y: number, radius: number): number;
}
export interface ClassicPhysicsConfig {
  groundSpeed: number;
  airSpeed: number;
  maxGroundMoveSpeed: number;
  maxAirMoveSpeed: number;
  gravity: number;
  jumpForce: number;
  airFriction: number;
  groundFriction: number;
  groundStopSpeed: number;
  speedFactor: number;
  infiniteMap: boolean;
  ropeMaxLength: number;
  ropeRestLength: number;
  ropeStrength: number;
  ropeSpeed: number;
  ropeAddParentSpeed: boolean;
  ropeGravity: number;
  ropeFallingGravity: number;
  ropePrecision: number;
  ropeCanAttachWorm: boolean;
  aimMaxSpeed: number;
  aimAcceleration: number;
  aimFriction: number;
  aimLikeLX56: boolean;
  fullAimAngle: boolean;
}
/** Classic/script.lgs overrides the fallback FeatureList values for gravity, jump and rope. */
export const CLASSIC_PHYSICS: Readonly<ClassicPhysicsConfig> = {
  groundSpeed: 8,
  airSpeed: 4,
  maxGroundMoveSpeed: 30,
  maxAirMoveSpeed: 30,
  gravity: 100,
  jumpForce: -65,
  airFriction: 0,
  groundFriction: 0.1,
  groundStopSpeed: 5,
  speedFactor: 1,
  infiniteMap: false,
  ropeMaxLength: 300,
  ropeRestLength: 27,
  ropeStrength: 4.5,
  ropeSpeed: 250,
  ropeAddParentSpeed: false,
  ropeGravity: 100,
  ropeFallingGravity: 150,
  ropePrecision: 1,
  ropeCanAttachWorm: true,
  aimMaxSpeed: 232.996,
  aimAcceleration: 1299.91,
  aimFriction: 0,
  aimLikeLX56: false,
  fullAimAngle: false,
};
export interface ClassicControls {
  move: boolean;
  jump: boolean;
  carve: boolean;
  shoot: boolean;
  weaponDelta: number;
  weaponSlot: number | null;
}
export const f = Math.fround;
export const seconds = (dtMs: number): number => f(f(dtMs) * f(0.001));
export const add = (a: number, b: number): number => f(f(a) + f(b));
export const mul = (a: number, b: number): number => f(f(a) * f(b));
export const sub = (a: number, b: number): number => f(f(a) - f(b));
export const length2 = (x: number, y: number): number =>
  add(mul(x, x), mul(y, y));
export const wrap = (n: number, size: number): number =>
  f(((n % size) + size) % size);
/** std::sinf/cosf are evaluated at the source's float angle/radian conversion. */
export function faceDirection(worm: Pick<PhysicsWorm, "aim" | "facing">): {
  x: number;
  y: number;
} {
  const radians = mul(worm.aim, f(f(Math.PI) / f(180)));
  return { x: mul(f(cos(radians)), worm.facing), y: f(sin(radians)) };
}
