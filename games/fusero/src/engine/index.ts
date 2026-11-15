/** Fusero's pinned, source-derived Classic gameplay behind Fuse's rollback contract. */
export * from "./classic/world.js";
export * from "./classic/physics-types.js";
export { nativeBotArsenal } from "./classic/bot-arsenal.js";
export {
  encodeWorld,
  decodeWorld,
  toView,
  type WorldView,
} from "./classic/codec.js";
export {
  DEFAULT_SETTINGS,
  parseSettings,
  allowedWeaponIds,
  validLoadout,
  defaultLoadout,
  randomLoadout,
  score,
} from "./classic/match.js";
export type {
  ClassicSettings as Settings,
  ClassicLoadout,
} from "./classic/match-types.js";
export {
  CLASSIC_WEAPONS,
  CLASSIC_PROJECTILES,
  weaponById,
} from "./classic/catalog.js";
