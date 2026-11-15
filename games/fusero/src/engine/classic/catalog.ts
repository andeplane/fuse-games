import { CLASSIC_DATA } from "./classic-data.js";
import type {
  ClassicPhysics,
  ClassicProjectile,
  ClassicWeapon,
} from "./catalog-types.js";
export type * from "./catalog-types.js";

/** Rules configuration is shared by every replica and cannot be mutated through a consumer. */
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const catalog = freeze(CLASSIC_DATA);
export const CLASSIC_WEAPONS: readonly ClassicWeapon[] = catalog.weapons;
export const CLASSIC_PROJECTILES: readonly ClassicProjectile[] =
  catalog.projectiles;
export const CLASSIC_PHYSICS: ClassicPhysics = catalog.physics;

/** Stable mod-native weapon id; invalid boundary values never select a fallback weapon. */
export const weaponById = (id: number): ClassicWeapon | undefined =>
  Number.isInteger(id) && id >= 0 ? CLASSIC_WEAPONS[id] : undefined;
