import { MAX_MATCH_PARTICIPANTS, type GameRegistration } from "fuse-platform";
import { isBotId } from "./game/basics.js";
import {
  count,
  plain,
  parseRaceStats,
  type FuseDriversStats,
} from "./game/result-stats.js";
export type { FuseDriversStats } from "./game/result-stats.js";

export const TOTAL_KEYS = [
  "matches",
  "wins",
  "roundWins",
  "laps",
  "kills",
  "deaths",
  "lapsLed",
  "nitrosUsed",
] as const;
export type FuseDriversTotalsRecord = Record<
  (typeof TOTAL_KEYS)[number],
  number
>;
/** An account's standing in the fuseDrivers game beside its rating. */
export interface FuseDriversTotals {
  totals: FuseDriversTotalsRecord;
}

/** Parse results at the service boundary, where human participants have account IDs. */
export function parseFuseDriversStats(
  raw: unknown,
  rounds: number,
): FuseDriversStats | undefined {
  return parseRaceStats(
    raw,
    rounds,
    (id) => /^[a-f0-9]{24}$/.test(id) || isBotId(id),
    MAX_MATCH_PARTICIPANTS,
  );
}

export const emptyFuseDriversTotals = (): FuseDriversTotalsRecord =>
  Object.fromEntries(
    TOTAL_KEYS.map((key) => [key, 0]),
  ) as FuseDriversTotalsRecord;

export const fuseDriversRegistration: GameRegistration<
  FuseDriversStats,
  FuseDriversTotals,
  FuseDriversTotalsRecord
> = {
  id: "fuse-drivers",
  minRatedRoundTicks: 24, // One second at the VGA update rate of 70/3 Hz, rounded up.
  isBot: isBotId,
  parseStats: parseFuseDriversStats,
  emptyTotals: () => ({ totals: emptyFuseDriversTotals() }),
  credit: (player) => ({
    matches: 1,
    wins: player.matchPlacement === 1 ? 1 : 0,
    roundWins: player.roundWins,
    laps: player.laps,
    kills: player.kills,
    deaths: player.deaths,
    lapsLed: player.lapsLed,
    nitrosUsed: player.nitrosUsed,
  }),
  addTotals(standing, credit) {
    for (const key of TOTAL_KEYS) standing.totals[key] += credit[key];
  },
  parseTotals(document) {
    if (document.totals === undefined)
      return { totals: emptyFuseDriversTotals() };
    const stored = document.totals;
    if (
      !plain(stored) ||
      !TOTAL_KEYS.every((key) => count(stored[key], Number.MAX_SAFE_INTEGER))
    )
      return;
    const totals = emptyFuseDriversTotals();
    for (const key of TOTAL_KEYS) totals[key] = stored[key] as number;
    return { totals };
  },
};
