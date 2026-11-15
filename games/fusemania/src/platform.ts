import type { GameRegistration, PlayerResult } from "fuse-platform";
import { LIBRARY } from "./songs.js";
import { BATTLE_MODE, SCORE_MODE, type Library } from "./engine/index.js";
import {
  CAPACITY,
  MOST_NOTES,
  MOST_RATING,
  isBotId,
  validName,
} from "./basics.js";

/**
 * Fusemania's part of the shared backend (`fuse-platform`): what a player's reported stats are and what a confirmed
 * match adds to an account. The room service registers it beside the other games' in `service/history.ts`;
 * attestation, settlement, Elo and storage are the platform's. Canonical song/chart metadata validates activity
 * context; the separate verified song-score extension replays input evidence before updating highscores.
 */

/** One player's result as the platform stores it; the room's result module (`online/result.ts`) reports the same shape. */
export interface FusemaniaStats extends PlayerResult {
  /** Canonical song/chart context on new receipts; absent on older stored results. */
  songId?: string;
  chart?: number;
  mode?: number;
  /** Selected playlist size; song receipts carry this context, aggregate matches require it. */
  sessionLength?: number;
  /** The score out of 1,000,000 for the chart played. */
  rating: number;
  /** The longest combo. */
  combo: number;
  marvelous: number;
  perfect: number;
  great: number;
  /** Notes hit at all. */
  steps: number;
  misses: number;
}
export const TOTAL_KEYS = [
  "matches",
  "wins",
  "steps",
  "marvelous",
  "misses",
] as const;
export type FusemaniaTotalsRecord = Record<(typeof TOTAL_KEYS)[number], number>;
/** An account's standing in Fusemania beside its rating. */
export interface FusemaniaTotals {
  totals: FusemaniaTotalsRecord;
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
  "rating",
  "combo",
  "marvelous",
  "perfect",
  "great",
  "steps",
  "misses",
] as const satisfies readonly (keyof FusemaniaStats)[];
type Counter = Exclude<(typeof KEYS)[number], "playerId" | "name">;
/** The most each counter can be in one match: a forged report can inflate the reporter's totals by no more. */
const MOST: Record<Counter, number> = {
  slot: 15,
  roundsPlayed: 10,
  roundWins: 10,
  matchScoreUnits: MOST_RATING * 10,
  matchPlacement: 16,
  earlyExits: 10,
  rating: MOST_RATING,
  combo: MOST_NOTES,
  marvelous: MOST_NOTES * 10,
  perfect: MOST_NOTES * 10,
  great: MOST_NOTES * 10,
  steps: MOST_NOTES * 10,
  misses: MOST_NOTES * 10,
};
const COUNTERS = Object.keys(MOST) as Counter[];

const count = (value: unknown, most: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= most;
const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The storage and wire boundary for one player: every field checked, unknown ones refused, rebuilt in one key order.
 * Song receipts have length one; playlist aggregates have their selected length and no singular song/chart.
 */
export function parseFusemaniaStats(
  raw: unknown,
  rounds: number,
  library: Library = LIBRARY,
  validId: (value: unknown) => value is string = (value): value is string =>
    typeof value === "string" &&
    (/^[a-f0-9]{24}$/.test(value) || isBotId(value)),
): FusemaniaStats | undefined {
  if (!plain(raw) || ![1, 3, 5, 10].includes(rounds)) return;
  if (
    !Object.keys(raw).every(
      (key) =>
        (KEYS as readonly string[]).includes(key) ||
        ["songId", "chart", "mode", "sessionLength"].includes(key),
    ) ||
    !KEYS.every((key) => Object.hasOwn(raw, key))
  )
    return;
  const hasContext = ["songId", "chart", "mode"].some((key) =>
    Object.hasOwn(raw, key),
  );
  const sessionLength = raw.sessionLength;
  if (
    sessionLength !== undefined &&
    ![3, 5, 10].includes(sessionLength as number)
  )
    return;
  if (rounds > 1 && (sessionLength !== rounds || hasContext)) return;
  if (hasContext) {
    const song =
      typeof raw.songId === "string" ? library.song(raw.songId) : undefined;
    if (
      rounds !== 1 ||
      !song ||
      !count(raw.chart, song.charts.length - 1) ||
      (raw.mode !== SCORE_MODE && raw.mode !== BATTLE_MODE)
    )
      return;
  } else if (rounds === 1 && sessionLength !== undefined) return;
  const { playerId, name } = raw;
  if (!validId(playerId) || !validName(name)) return;
  if (!COUNTERS.every((key) => count(raw[key], MOST[key]))) return;
  const number = (key: Counter) => raw[key] as number;
  if (
    number("roundsPlayed") < 1 ||
    number("roundsPlayed") > rounds ||
    number("roundWins") > number("roundsPlayed") ||
    number("earlyExits") > number("roundsPlayed") ||
    number("slot") >= (rounds === 1 ? CAPACITY : 16) ||
    number("matchPlacement") < 1 ||
    number("matchPlacement") > (rounds === 1 ? CAPACITY : 16) ||
    (rounds === 1 &&
      number("roundWins") !== (number("matchPlacement") === 1 ? 1 : 0)) ||
    number("matchScoreUnits") > number("roundsPlayed") * MOST_RATING ||
    number("rating") !== Math.floor(number("matchScoreUnits") / rounds) ||
    number("marvelous") + number("perfect") + number("great") >
      number("steps") ||
    number("combo") > number("steps") ||
    number("steps") + number("misses") > number("roundsPlayed") * MOST_NOTES
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
    rating: number("rating"),
    combo: number("combo"),
    marvelous: number("marvelous"),
    perfect: number("perfect"),
    great: number("great"),
    steps: number("steps"),
    misses: number("misses"),
    ...(hasContext
      ? {
          songId: raw.songId as string,
          chart: raw.chart as number,
          mode: raw.mode as number,
        }
      : {}),
    ...(sessionLength === undefined
      ? {}
      : { sessionLength: sessionLength as number }),
  };
}

/** The whole field: one to five players in distinct seats and distinct places 1 to n, a higher rating never placed lower. */
export function validFusemaniaField(
  players: readonly FusemaniaStats[],
): boolean {
  const first = players[0];
  if (!first) return false;
  const aggregate =
    first?.sessionLength !== undefined && first.songId === undefined;
  if (players.length < 1 || players.length > (aggregate ? 16 : CAPACITY))
    return false;
  if (
    players.some(
      (player) =>
        player.songId !== first?.songId ||
        player.mode !== first.mode ||
        player.sessionLength !== first.sessionLength,
    )
  )
    return false;
  const slots = new Set(players.map((player) => player.slot)),
    places = new Set(players.map((player) => player.matchPlacement));
  if (
    slots.size !== players.length ||
    places.size !== players.length ||
    [...slots].some((slot) => slot >= players.length) ||
    [...places].some((place) => place > players.length)
  )
    return false;
  const ranked = [...players].sort(
    (a, b) => a.matchPlacement - b.matchPlacement,
  );
  return ranked.every(
    (player, index) =>
      index === 0 ||
      player.matchScoreUnits <= ranked[index - 1]!.matchScoreUnits,
  );
}

export const emptyFusemaniaTotals = (): FusemaniaTotalsRecord => ({
  matches: 0,
  wins: 0,
  steps: 0,
  marvelous: 0,
  misses: 0,
});

export const fusemaniaRegistration: GameRegistration<
  FusemaniaStats,
  FusemaniaTotals,
  FusemaniaTotalsRecord
> = {
  id: "fusemania",
  minRatedRoundTicks: 20, // fuse-netcode/clock.ts TICK_MS = 50
  isBot: isBotId,
  parseStats: parseFusemaniaStats,
  validField: validFusemaniaField,
  activity(result): {
    title?: string;
    context?: Record<string, string | number | boolean>;
  } {
    if (result.length > 1)
      return {
        title: `${result.length}-song session`,
        context: {
          scoreUnit: "percent",
          scoreDivisor: result.length,
          sessionLength: result.length,
        },
      };
    const player = result.players[0],
      song = player?.songId ? LIBRARY.song(player.songId) : undefined;
    return song
      ? {
          title: song.title,
          context: {
            songId: song.id,
            scoreUnit: "percent",
            playStyle: player?.mode === BATTLE_MODE ? "Battle" : "Score",
            ...(player?.sessionLength
              ? { sessionLength: player.sessionLength }
              : {}),
          },
        }
      : { context: { scoreUnit: "percent" } };
  },
  activityPlayer(player) {
    const chart =
      player.songId && player.chart !== undefined
        ? LIBRARY.song(player.songId)?.charts[player.chart]
        : undefined;
    return {
      ...(chart ? { label: `${chart.name} ${chart.meter}` } : {}),
      stats: {
        combo: player.combo,
        marvelous: player.marvelous,
        perfect: player.perfect,
        great: player.great,
        steps: player.steps,
        misses: player.misses,
      },
    };
  },
  emptyTotals: () => ({ totals: emptyFusemaniaTotals() }),
  credit: (player) => ({
    matches: 1,
    wins: player.matchPlacement === 1 ? 1 : 0,
    steps: player.steps,
    marvelous: player.marvelous,
    misses: player.misses,
  }),
  addTotals(standing, credit) {
    for (const key of TOTAL_KEYS) standing.totals[key] += credit[key];
  },
  parseTotals(document) {
    if (document.totals === undefined)
      return { totals: emptyFusemaniaTotals() };
    const stored = document.totals;
    if (
      !plain(stored) ||
      !TOTAL_KEYS.every((key) => count(stored[key], Number.MAX_SAFE_INTEGER))
    )
      return;
    const totals = emptyFusemaniaTotals();
    for (const key of TOTAL_KEYS) totals[key] = stored[key] as number;
    return { totals };
  },
};
