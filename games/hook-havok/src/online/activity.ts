import type { MatchResult, PlayerResult } from "fuse-platform";
import { parseHistoryPlayer } from "fuse-platform/history-api";
import type { View } from "./game.js";

export const isHistoryBot = (id: string) => /^bot:[1-9]\d?$/.test(id);
export interface HookHistoryPlayer extends PlayerResult {
  points: number;
  knockouts: number;
  falls: number;
  thrown: number;
  rules: "score" | "elimination";
  map: "crossroads" | "spire" | "belfry";
}
export function parseHookHistoryPlayer(
  raw: unknown,
  rounds: number,
): HookHistoryPlayer | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const { points, knockouts, falls, thrown, rules, map, ...base } =
    raw as Record<string, unknown>;
  const player = parseHistoryPlayer(base, rounds);
  const count = (n: unknown): n is number =>
    typeof n === "number" &&
    Number.isSafeInteger(n) &&
    n >= 0 &&
    n <= 1_000_000;
  if (
    !player ||
    rounds !== 1 ||
    typeof points !== "number" ||
    !Number.isSafeInteger(points) ||
    points < -7200 ||
    points > 10800 ||
    !count(knockouts) ||
    !count(falls) ||
    !count(thrown) ||
    (rules !== "score" && rules !== "elimination") ||
    !["crossroads", "spire", "belfry"].includes(String(map))
  )
    return;
  return {
    ...player,
    points,
    knockouts,
    falls,
    thrown,
    rules,
    map: map as HookHistoryPlayer["map"],
  };
}

/** Capture once at the deciding tick, before later seat names or free-play state can change. */
export function activityResult(
  frame: Pick<
    View,
    "matchId" | "round" | "contest" | "keepers" | "seats" | "map"
  >,
): MatchResult<HookHistoryPlayer> | undefined {
  const c = frame.contest;
  if (c.rules === "free" || c.phase !== "over") return;
  const winners = new Set(c.winners);
  const rank = (entry: (typeof c.entries)[number]) =>
    winners.has(entry.id)
      ? 3e6
      : (entry.out ? 0 : 1e6) + (c.rules === "score" ? entry.score : 0);
  const finishers = c.entries
    .filter(
      (entry) =>
        !isHistoryBot(entry.id) &&
        frame.seats.some((seat) => seat.id === entry.id && seat.connected),
    )
    .map((entry) => entry.id)
    .sort();
  return {
    matchId: `${frame.matchId}:${frame.round}`,
    length: 1,
    ...(c.winners.length === 1 ? { winnerId: c.winners[0]! } : {}),
    finishers,
    players: c.entries.map((entry) => {
      const keeper = frame.keepers.find((keeper) => keeper.id === entry.id);
      return {
        playerId: entry.id,
        name: keeper?.name ?? "Keeper",
        slot: entry.slot,
        roundsPlayed: 1,
        roundWins: winners.has(entry.id) ? 1 : 0,
        matchScoreUnits: 0,
        matchPlacement:
          1 + c.entries.filter((other) => rank(other) > rank(entry)).length,
        earlyExits:
          isHistoryBot(entry.id) || finishers.includes(entry.id) ? 0 : 1,
        points: entry.score,
        knockouts: keeper?.tally.knockouts ?? 0,
        falls: keeper?.tally.falls ?? 0,
        thrown: keeper?.tally.thrown ?? 0,
        rules: c.rules as "score" | "elimination",
        map: frame.map,
      };
    }),
  };
}
