import type { PlayerResult } from "fuse-platform";
import {
  CAPACITY,
  MAX_EVENTS,
  MAX_LAPS,
  MAX_PROGRESS_UNITS,
  MAX_ROUNDS,
  validName,
} from "./basics.js";

/** One player's result as the platform stores it; `FuseDriversPlayerResult` in `game/result.ts` is the same shape. */
export interface FuseDriversStats extends PlayerResult {
  laps: number;
  kills: number;
  deaths: number;
  /** Laps this driver crossed the line in front. */
  lapsLed: number;
  nitrosUsed: number;
}
const KEYS = [
  "playerId",
  "name",
  "slot",
  "roundsPlayed",
  "roundWins",
  "matchScoreUnits",
  "matchPlacement",
  "earlyExits",
  "laps",
  "kills",
  "deaths",
  "lapsLed",
  "nitrosUsed",
] as const satisfies readonly (keyof FuseDriversStats)[];
type Counter = Exclude<(typeof KEYS)[number], "playerId" | "name">;
const COUNTERS = KEYS.slice(2) as readonly Counter[];

export const count = (value: unknown, most: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= most;
export const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The storage and wire boundary for one player: every field checked, unknown ones refused, rebuilt in one key order. */
export function parseRaceStats(
  raw: unknown,
  rounds: number,
  acceptPlayerId: (id: string) => boolean,
  maxPlacement: number,
): FuseDriversStats | undefined {
  if (!plain(raw)) return;
  const keys = Object.keys(raw);
  if (
    keys.length !== KEYS.length ||
    !KEYS.every((key) => Object.hasOwn(raw, key))
  )
    return;
  const { playerId, name } = raw;
  if (
    typeof playerId !== "string" ||
    !acceptPlayerId(playerId) ||
    !validName(name)
  )
    return;
  const most: Record<Counter, number> = {
    slot: CAPACITY - 1,
    roundsPlayed: rounds,
    roundWins: rounds,
    // How far round the track the driver got, in hundredths of a checkpoint.
    matchScoreUnits: MAX_PROGRESS_UNITS * MAX_ROUNDS,
    matchPlacement: maxPlacement,
    earlyExits: 1,
    laps: MAX_LAPS,
    kills: MAX_EVENTS,
    deaths: MAX_EVENTS,
    lapsLed: MAX_LAPS,
    nitrosUsed: MAX_EVENTS,
  };
  if (!COUNTERS.every((key) => count(raw[key], most[key]))) return;
  if ((raw.matchPlacement as number) < 1) return;
  if ((raw.lapsLed as number) > (raw.laps as number)) return;
  // Counters are bounded one by one, so nothing else stops a forged report claiming more races won than
  // raced and crediting itself the difference.
  if ((raw.roundWins as number) > (raw.roundsPlayed as number)) return;
  const player: Record<string, unknown> = {};
  for (const key of KEYS) player[key] = raw[key];
  return player as unknown as FuseDriversStats;
}
