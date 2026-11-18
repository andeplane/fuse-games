import { CAMPAIGNS, DOGFIGHTS, WEAPONS } from "../campaign/index.js";
export const CAPACITY = 5;
export const MAX_WATCHERS = 8;
export const isBotId = (id: string): boolean =>
  /^bot:[1-9][0-9]{0,5}$/.test(id);
export const validName = (raw: unknown): raw is string =>
  typeof raw === "string" &&
  !!raw &&
  raw.trim() === raw &&
  [...raw].length <= 18 &&
  !/[\u0000-\u001f\u007f]|\p{Cs}/u.test(raw);
export function seatName(raw: string): string | undefined {
  const name = [...raw.trim()].slice(0, 18).join("").trim();
  return validName(name) ? name : undefined;
}
export interface CyberfuseSettings {
  display: boolean;
  mode: "campaign" | "dogfight";
  campaign?: number;
  loadout?: number[];
}
export const DEFAULT_SETTINGS: CyberfuseSettings = {
  display: false,
  mode: "campaign",
};
export const plain = (raw: unknown): raw is Record<string, unknown> =>
  raw !== null && typeof raw === "object" && !Array.isArray(raw);
export function parseSettings(raw: unknown): CyberfuseSettings | undefined {
  if (
    !plain(raw) ||
    Object.keys(raw).some(
      (k) => !["display", "mode", "campaign", "loadout"].includes(k),
    ) ||
    typeof raw.display !== "boolean" ||
    (raw.mode !== "campaign" && raw.mode !== "dogfight")
  )
    return;
  const { campaign, loadout } = raw;
  if (
    campaign !== undefined &&
    (typeof campaign !== "number" ||
      !Number.isInteger(campaign) ||
      campaign < 0 ||
      campaign >=
        (raw.mode === "campaign" ? CAMPAIGNS.length : DOGFIGHTS.length))
  )
    return;
  if (
    loadout !== undefined &&
    (!Array.isArray(loadout) ||
      loadout.length > 3 ||
      new Set(loadout).size !== loadout.length ||
      !loadout.every(
        (w) => Number.isInteger(w) && w >= 0 && w < WEAPONS.length,
      ))
  )
    return;
  return {
    display: raw.display,
    mode: raw.mode,
    ...(campaign !== undefined ? { campaign } : {}),
    ...(loadout !== undefined ? { loadout: [...loadout] } : {}),
  };
}
export const UP = 1,
  RIGHT = 2,
  DOWN = 4,
  LEFT = 8,
  FIRE = 16,
  SPECIAL = 32;
export const validBits = (raw: unknown): raw is number =>
  typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw < 64;
