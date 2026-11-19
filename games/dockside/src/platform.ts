import type { GameRegistration, PlayerResult } from "fuse-platform";
import { CAPACITY, isBotId, validName } from "./game/basics.js";

/**
 * Dockside's part of the shared backend (`fuse-platform`): what a player's reported stats are and what a confirmed
 * match adds to an account. The room service registers it beside the other games' in `service/history.ts`;
 * attestation, settlement, Elo and storage are the platform's. It imports only `basics.ts`, so the service never loads
 * the engine or the netcode.
 */

/** One pilot's result as the platform stores it; the room's result module (`game/result.ts`) reports the same shape. */
export interface DocksideStats extends PlayerResult {
  /** Rounds won. */
  points: number;
  /** Drones launched from the factory. */
  launched: number;
  /** Enemy drones intercepted. */
  intercepted: number;
}
export const TOTAL_KEYS = [
  "matches",
  "wins",
  "points",
  "launched",
  "intercepted",
] as const;
export type DocksideTotalsRecord = Record<(typeof TOTAL_KEYS)[number], number>;
/** An account's standing in Dockside beside its rating. */
export interface DocksideTotals {
  totals: DocksideTotalsRecord;
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
  "points",
  "launched",
  "intercepted",
] as const satisfies readonly (keyof DocksideStats)[];
type Counter = Exclude<(typeof KEYS)[number], "playerId" | "name">;
/** The most each counter can be in one match: a forged report can inflate the reporter's totals by no more. */
const MOST: Record<Counter, number> = {
  slot: CAPACITY - 1,
  roundsPlayed: 1,
  roundWins: 1,
  matchScoreUnits: 1,
  matchPlacement: CAPACITY,
  earlyExits: 1,
  points: 1,
  launched: 0xffffffff,
  intercepted: 0xffffffff,
};
const COUNTERS = Object.keys(MOST) as Counter[];

const count = (value: unknown, most: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= most;
const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The storage and wire boundary for one pilot: every field checked, unknown ones refused, rebuilt in one key order.
 * A Dockside match reports as one round, so a result of any other length is not one of ours.
 */
export function parseDocksideStats(
  raw: unknown,
  rounds: number,
): DocksideStats | undefined {
  if (!plain(raw) || rounds !== 1) return;
  if (
    Object.keys(raw).length !== KEYS.length ||
    !KEYS.every((key) => Object.hasOwn(raw, key))
  )
    return;
  const { playerId, name } = raw;
  if (
    typeof playerId !== "string" ||
    !(/^[a-f0-9]{24}$/.test(playerId) || isBotId(playerId)) ||
    !validName(name)
  )
    return;
  if (!COUNTERS.every((key) => count(raw[key], MOST[key]))) return;
  const number = (key: Counter) => raw[key] as number;
  if (number("roundsPlayed") !== 1) return;
  // First place, and only first place, has the round; a winner took at least one round of the match.
  const won = number("roundWins") === 1;
  if (
    won !== (number("matchPlacement") === 1) ||
    number("matchPlacement") < 1 ||
    number("points") !== number("roundWins") ||
    number("points") !== number("matchScoreUnits")
  )
    return;
  return {
    playerId,
    name,
    slot: number("slot"),
    roundsPlayed: number("roundsPlayed"),
    roundWins: number("roundWins"),
    matchScoreUnits: number("matchScoreUnits"),
    matchPlacement: number("matchPlacement"),
    earlyExits: number("earlyExits"),
    points: number("points"),
    launched: number("launched"),
    intercepted: number("intercepted"),
  };
}

/** Each of the two pilots places by deliveries. Simultaneous deliveries share first. */
export function validDocksideField(players: readonly DocksideStats[]): boolean {
  if (players.length !== CAPACITY) return false;
  const slots = new Set(players.map((player) => player.slot));
  if (
    slots.size !== players.length ||
    [...slots].some((slot) => slot >= players.length)
  )
    return false;
  return players.every(
    (player) =>
      player.matchPlacement ===
      1 + players.filter((other) => other.points > player.points).length,
  );
}

export const emptyDocksideTotals = (): DocksideTotalsRecord => ({
  matches: 0,
  wins: 0,
  points: 0,
  launched: 0,
  intercepted: 0,
});

export const docksideRegistration: GameRegistration<
  DocksideStats,
  DocksideTotals,
  DocksideTotalsRecord
> = {
  id: "dockside",
  minRatedRoundTicks: 20,
  isBot: isBotId,
  parseStats: parseDocksideStats,
  validField: validDocksideField,
  emptyTotals: () => ({ totals: emptyDocksideTotals() }),
  credit: (player) => ({
    matches: 1,
    wins: player.matchPlacement === 1 ? 1 : 0,
    points: player.points,
    launched: player.launched,
    intercepted: player.intercepted,
  }),
  addTotals(standing, credit) {
    for (const key of TOTAL_KEYS) standing.totals[key] += credit[key];
  },
  parseTotals(document) {
    if (document.totals === undefined) return { totals: emptyDocksideTotals() };
    const stored = document.totals;
    if (
      !plain(stored) ||
      !TOTAL_KEYS.every((key) => count(stored[key], Number.MAX_SAFE_INTEGER))
    )
      return;
    const totals = emptyDocksideTotals();
    for (const key of TOTAL_KEYS) totals[key] = stored[key] as number;
    return { totals };
  },
};
