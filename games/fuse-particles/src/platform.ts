import type { GameRegistration, PlayerResult } from "fuse-platform";
import {
  CAPACITY,
  TICKS_PER_SECOND,
  isBotId,
  validName,
} from "./game/basics.js";

export interface FuseParticlesStats extends PlayerResult {
  hp: number;
  kills: number;
}
const counters = ["matches", "wins", "kills"] as const;
type Totals = Record<(typeof counters)[number], number>;
const bounds = {
  slot: CAPACITY - 1,
  roundsPlayed: 1,
  roundWins: 1,
  matchScoreUnits: 1000,
  matchPlacement: CAPACITY,
  earlyExits: 1,
  hp: 1000,
  kills: 1_000_000,
};
const bounded = (raw: unknown, max: number): raw is number =>
  typeof raw === "number" &&
  Number.isSafeInteger(raw) &&
  raw >= 0 &&
  raw <= max;
export function parseFuseParticlesStats(
  raw: unknown,
  rounds: number,
): FuseParticlesStats | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || rounds !== 1)
    return;
  const stats = raw as Record<string, unknown>;
  if (
    Object.keys(stats).length !== Object.keys(bounds).length + 2 ||
    typeof stats.playerId !== "string" ||
    !(isBotId(stats.playerId) || /^[a-f0-9]{24}$/.test(stats.playerId)) ||
    !validName(stats.name) ||
    !Object.entries(bounds).every(([key, max]) => bounded(stats[key], max)) ||
    stats.matchPlacement === 0 ||
    (stats.roundWins === 1 && stats.roundsPlayed === 0)
  )
    return;
  return stats as unknown as FuseParticlesStats;
}
const empty = (): Totals => ({ matches: 0, wins: 0, kills: 0 });
export const fuseParticlesRegistration: GameRegistration<
  FuseParticlesStats,
  { totals: Totals },
  Totals
> = {
  id: "fuse-particles",
  minRatedRoundTicks: TICKS_PER_SECOND,
  isBot: isBotId,
  parseStats: parseFuseParticlesStats,
  emptyTotals: () => ({ totals: empty() }),
  credit: (player) => ({
    matches: 1,
    wins: player.roundWins,
    kills: player.kills,
  }),
  addTotals(standing, credit) {
    for (const key of counters) standing.totals[key] += credit[key];
  },
  parseTotals(document) {
    if (document.totals === undefined) return { totals: empty() };
    if (!document.totals || typeof document.totals !== "object") return;
    const totals = document.totals as Partial<Totals>;
    if (!counters.every((key) => bounded(totals[key], Number.MAX_SAFE_INTEGER)))
      return;
    return { totals: totals as Totals };
  },
};
