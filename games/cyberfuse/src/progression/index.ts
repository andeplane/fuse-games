import { CAMPAIGNS } from "../campaign/index.js";

const SOLO_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const COOP_DIGITS = "9876543210kjihgfedcbazyxwvutsrqponml";

/** DOS mission passwords are tied to title, zero-based mission, map seed and player mode.
 * The first briefing never issues a password. The original signed integer encoder
 * emits no digits for a seed whose high bit makes its result negative. */
export function missionPassword(
  campaign: number,
  mission: number,
  seed = 0,
  cooperative = false,
): string {
  const entry = CAMPAIGNS[campaign];
  if (
    !entry?.missions[mission] ||
    mission < 1 ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff
  )
    return "";
  let sum = 0,
    xor = 0;
  for (const letter of entry.title) {
    // All five licensed DOS campaign titles are ASCII; the game reads their bytes.
    const byte = letter.charCodeAt(0);
    sum += byte;
    xor ^= byte;
  }
  const digits = cooperative ? COOP_DIGITS : SOLO_DIGITS;
  let value = ((xor << 23) | (mission << 16) | sum) ^ seed;
  let code = "";
  while (value > 0) {
    code += digits[value % digits.length];
    value = Math.floor(value / digits.length);
  }
  return code;
}

/** Blank starts a campaign. Nonempty codes must match a later mission in this campaign. */
export function missionFromPassword(
  campaign: number,
  code: string,
  seed = 0,
  cooperative = false,
): number | undefined {
  const entry = CAMPAIGNS[campaign];
  if (!entry || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    return;
  if (code === "") return 0;
  if (!/^[0-9a-z]{1,16}$/.test(code)) return;
  for (let mission = 1; mission < entry.missions.length; mission++) {
    if (missionPassword(campaign, mission, seed, cooperative) === code)
      return mission;
  }
  return;
}

interface PasswordStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storageKey = (campaign: number, seed: number, cooperative: boolean) =>
  `cyberfuse-password-${CAMPAIGNS[campaign]?.id}-${seed}-${cooperative ? "coop" : "solo"}`;

export function readMissionPassword(
  store: PasswordStore,
  campaign: number,
  seed = 0,
  cooperative = false,
): string {
  const code = store.getItem(storageKey(campaign, seed, cooperative)) ?? "";
  return missionFromPassword(campaign, code, seed, cooperative) ? code : "";
}

/** Preserve the furthest earned checkpoint when a player replays an earlier mission.
 * Returns the current briefing's code so a replay still shows its own checkpoint. */
export function rememberMissionPassword(
  store: PasswordStore,
  campaign: number,
  mission: number,
  seed = 0,
  cooperative = false,
): string {
  const code = missionPassword(campaign, mission, seed, cooperative);
  if (!code) return "";
  const key = storageKey(campaign, seed, cooperative);
  const previous = missionFromPassword(
    campaign,
    store.getItem(key) ?? "",
    seed,
    cooperative,
  );
  if (previous === undefined || mission > previous) store.setItem(key, code);
  return code;
}

export interface MissionPerformance {
  objectives: readonly { done: number; required: number; count: number }[];
  /** Shared access inventory: yellow = 1, green = 2, blue = 4, red = 8. */
  keys: number;
  /** C-Dogs simulation ticks, including extraction. */
  ticks: number;
  survived: boolean;
  hp: number;
  kills: number;
  friendlies: number;
  loadout: readonly number[];
}

/** The score awarded by Bonuses and Summary after ordinary play has already been scored.
 * "survived" means the player's actor still exists as the mission ends. */
export function missionBonuses(run: MissionPerformance) {
  let objective = 0,
    access = 0,
    time = 0,
    health = 0,
    conduct = 0;
  if (run.survived) {
    for (const { done, required, count } of run.objectives)
      if (done === count && done > required) objective += 500;
    for (let color = 0; color < 4; color++)
      if (run.keys & (1 << color)) access += 50 * (color + 1);
    const seconds = Math.floor(run.ticks / 70);
    time = Math.max(0, 60 + 30 * run.objectives.length - seconds) * 25;
    if (run.hp > 150) health = (run.hp - 150) * 10;
    else if (run.hp <= 0) health = -500;
    if (run.friendlies > 5 && run.friendlies > Math.floor(run.kills / 2))
      conduct = -100 * run.friendlies;
    else if (
      run.loadout.length === 1 &&
      run.loadout[0] === 0 &&
      run.friendlies === 0 &&
      run.kills > 5
    )
      conduct = 50 * run.kills;
    else if (run.kills === 0 && run.friendlies === 0) conduct = 500;
  }
  return {
    objective,
    access,
    time,
    health,
    conduct,
    total: objective + access + time + health + conduct,
  };
}
