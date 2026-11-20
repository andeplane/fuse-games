import {
  parseGameplayOptions,
  type GameplayOptions,
} from "../options/index.js";
import { CAMPAIGNS, DOGFIGHTS, WEAPONS } from "../campaign/index.js";
import { validPlayerName as validName } from "fuse-platform/player-name";

export { validName };

export { CAPACITY } from "../capacity.js";
export const MAX_WATCHERS = 7;
export const isBotId = (id: string): boolean =>
  /^bot:[1-9][0-9]{0,5}$/.test(id);
export function seatName(raw: string): string | undefined {
  const name = [...raw.trim()].slice(0, 18).join("").trim();
  return validName(name) ? name : undefined;
}
export interface CyberfuseSettings {
  display: boolean;
  mode: "campaign" | "dogfight";
  campaign?: number;
  /** Zero-based source mission selected by a campaign password. */
  startMission?: number;
  loadout?: number[];
  gameplay?: GameplayOptions;
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
      (k) =>
        ![
          "display",
          "mode",
          "campaign",
          "loadout",
          "startMission",
          "gameplay",
        ].includes(k),
    ) ||
    typeof raw.display !== "boolean" ||
    (raw.mode !== "campaign" && raw.mode !== "dogfight")
  )
    return;
  const { campaign, loadout, startMission } = raw;
  const gameplay = parseGameplayOptions(raw.gameplay);
  if (raw.gameplay !== undefined && !gameplay) return;
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
    startMission !== undefined &&
    (typeof startMission !== "number" ||
      !Number.isInteger(startMission) ||
      startMission < 0 ||
      startMission >=
        (raw.mode === "campaign"
          ? CAMPAIGNS[campaign ?? 0]!.missions.length
          : 1))
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
    ...(gameplay ? { gameplay } : {}),
    display: raw.display,
    mode: raw.mode,
    ...(campaign !== undefined ? { campaign } : {}),
    ...(startMission !== undefined ? { startMission } : {}),
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
