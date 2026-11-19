import { CAMPAIGNS } from "./data.js";
import type { Campaign, Mission } from "./types.js";

export * from "./types.js";
export * from "./data.js";

/** Indices match the DOS weapon selection bitmask and the character gun IDs. */
export const WEAPONS = [
  "Knife",
  "Machine gun",
  "Grenades",
  "Flamer",
  "Shotgun",
  "Powergun",
  "Shrapnel bombs",
  "Molotovs",
  "Sniper gun",
  "Prox. mine",
  "Dynamite",
  "Chemo bombs",
  "Petrify gun",
  "Browny gun",
  "Confusion bombs",
  "Chemo gun",
].map((name, id) => ({ id, name }));

const missionList = CAMPAIGNS.flatMap((campaign) =>
  campaign.missions.map((mission) => ({ campaign, mission })),
);
export const MISSION_COUNT = missionList.length;

/** Without a campaign, the zero-based index addresses the full DOS mission list. */
export function getMission(index: number, campaign?: number): Mission {
  const mission =
    campaign === undefined
      ? missionList[index]?.mission
      : CAMPAIGNS[campaign]?.missions[index];
  if (!mission) throw new RangeError("Unknown C-Dogs mission");
  return mission;
}

export function getCampaignForMission(
  index: number,
  campaign?: number,
): Campaign {
  const entry =
    campaign === undefined ? missionList[index]?.campaign : CAMPAIGNS[campaign];
  if (!entry || (campaign !== undefined && !entry.missions[index]))
    throw new RangeError("Unknown C-Dogs mission");
  return entry;
}

/** GAMEDATA.C's two initial kits, restricted to this briefing's available weapons.
 * Additional Fuse seats alternate kits. A disjoint selection starts with the first allowed weapon. */
export function defaultLoadout(
  playerIndex: number,
  mission: Mission,
): number[] {
  const initial = playerIndex % 2 === 0 ? [4, 1, 6] : [5, 3, 2];
  const allowed = initial.filter((id) => mission.allowedWeapons.includes(id));
  return allowed.length ? allowed : mission.allowedWeapons.slice(0, 1);
}
