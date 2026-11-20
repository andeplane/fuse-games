import { memberId } from "fuse-netcode";

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

export const AVATAR = "train";
export const isAvatar = (value: unknown): value is string => value === AVATAR;

export const BOT_PREFIX = "bot:";
export const BOT_NAMES = [
  "Loco Lola",
  "Steamy Sam",
  "Boxcar Bea",
  "Coal Cole",
  "Whistle Wu",
] as const;
