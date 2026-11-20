import { memberId } from "fuse-netcode";
import { HERO_KINDS, type HeroKind } from "../engine/index.js";

export {
  seatPlayerName as seatName,
  validPlayerName as validName,
  MAX_PLAYER_NAME as MAX_NAME,
} from "fuse-platform/player-name";

/** A match id as every replica accepts it: 1–64 printable ASCII characters. */
export const validMatchId = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7e]{1,64}$/.test(value);

/** A member id that is safe as a record key: never one of `Object.prototype`'s names. */
export const playerKey = (value: unknown): value is string =>
  memberId(value) && !(value in Object.prototype);

/**
 * A seat's avatar is the hero it plays: a member names one with its join (the netcode's `avatarId`) and may change it
 * with a `PICK` entry in the lobby or after the run (`online/game.ts`). Duplicates are allowed.
 */
export const isHero = (value: unknown): value is HeroKind =>
  (HERO_KINDS as readonly unknown[]).includes(value);
export const DEFAULT_HERO: HeroKind = "brakka";
/** What a bot's seat records in place of a hero: a bot plays its seat's hero (`seatHero`). */
export const BOT_AVATAR = "bot";
/** The hero each seat brings when nobody chooses: Brakka, Rhea, Gorm, Brakka, Rhea. */
export const seatHero = (slot: number): HeroKind =>
  HERO_KINDS[slot % HERO_KINDS.length]!;

export const BOT_PREFIX = "bot:";
export const BOT_NAMES = [
  "Ironhide",
  "Ashwyn",
  "Bramble",
  "Korrin",
  "Sable",
] as const;
