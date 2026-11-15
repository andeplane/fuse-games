import { ELO_K, type EloPlayer } from "./elo.js";

// UTC-day budgets are deliberately generous for a long session, but do not establish fair play.
export const PAIR_DAILY_ROUNDS = 200;
export const PAIR_DAILY_ELO = 400;
export const ACCOUNT_DAILY_ELO = 1000;
export const CONFIDENCE_ROUNDS = 20;
const MAX_OPPONENTS = 600;

export interface RatingGuard {
  day: number;
  movement: number;
  confidence: number;
  opponents: Record<string, { rounds: number; movement: number }>;
}

export function parseRatingGuard(raw: unknown): RatingGuard | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const v = raw as Record<string, unknown>;
  if (
    !Number.isSafeInteger(v.day) ||
    (v.day as number) < 0 ||
    !Number.isSafeInteger(v.confidence) ||
    (v.confidence as number) < 0 ||
    (v.confidence as number) > CONFIDENCE_ROUNDS ||
    typeof v.movement !== "number" ||
    !Number.isFinite(v.movement) ||
    v.movement < 0 ||
    !v.opponents ||
    typeof v.opponents !== "object" ||
    Array.isArray(v.opponents)
  )
    return;
  const entries = Object.entries(v.opponents);
  if (entries.length > MAX_OPPONENTS) return;
  const opponents: RatingGuard["opponents"] = {};
  for (const [key, value] of entries) {
    if (
      !/^[a-f0-9]{64}$/.test(key) ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      return;
    const pair = value as Record<string, unknown>;
    if (
      !Number.isSafeInteger(pair.rounds) ||
      (pair.rounds as number) < 0 ||
      typeof pair.movement !== "number" ||
      !Number.isFinite(pair.movement) ||
      pair.movement < 0
    )
      return;
    opponents[key] = { rounds: pair.rounds as number, movement: pair.movement };
  }
  return {
    day: v.day as number,
    movement: v.movement,
    confidence: v.confidence as number,
    opponents,
  };
}

/** Calculate and reserve the pairwise exchanges in one transaction, using both players' budgets. */
export function guardedElo(
  players: readonly (EloPlayer & {
    uid: string;
    opponentKey: string;
    guard?: RatingGuard;
  })[],
  now: number,
): { values: Map<string, number>; guards: Map<string, RatingGuard> } {
  const day = Math.max(
    Math.floor(now / 86_400_000),
    ...players.map((p) => p.guard?.day ?? 0),
  );
  const guards = new Map(
    players.map((p) => [
      p.uid,
      p.guard?.day === day
        ? structuredClone(p.guard)
        : {
            day,
            movement: 0,
            confidence: p.guard?.confidence ?? 0,
            opponents: {},
          },
    ]),
  );
  const deltas = new Map(players.map((p) => [p.id, 0]));
  for (let i = 0; i < players.length; i++)
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]!,
        b = players[j]!;
      const ga = guards.get(a.uid)!,
        gb = guards.get(b.uid)!;
      if (
        (!ga.opponents[b.opponentKey] &&
          Object.keys(ga.opponents).length >= MAX_OPPONENTS) ||
        (!gb.opponents[a.opponentKey] &&
          Object.keys(gb.opponents).length >= MAX_OPPONENTS)
      )
        continue;
      const pa = (ga.opponents[b.opponentKey] ??= { rounds: 0, movement: 0 });
      const pb = (gb.opponents[a.opponentKey] ??= { rounds: 0, movement: 0 });
      if (pa.rounds >= PAIR_DAILY_ROUNDS || pb.rounds >= PAIR_DAILY_ROUNDS)
        continue;
      pa.rounds++;
      pb.rounds++;
      const order = a.score - b.score || a.wins - b.wins;
      const actual = order === 0 ? 0.5 : order > 0 ? 1 : 0;
      const expected = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
      const confidence = Math.min(
        1,
        0.25 +
          (0.75 * Math.min(ga.confidence, gb.confidence)) / CONFIDENCE_ROUNDS,
      );
      const raw =
        (ELO_K * (actual - expected) * confidence) / (players.length - 1);
      const amount = Math.max(
        0,
        Math.min(
          Math.abs(raw),
          PAIR_DAILY_ELO - pa.movement,
          PAIR_DAILY_ELO - pb.movement,
          ACCOUNT_DAILY_ELO - ga.movement,
          ACCOUNT_DAILY_ELO - gb.movement,
        ),
      );
      const delta = Math.sign(raw) * amount;
      pa.movement += amount;
      pb.movement += amount;
      ga.movement += amount;
      gb.movement += amount;
      deltas.set(a.id, deltas.get(a.id)! + delta);
      deltas.set(b.id, deltas.get(b.id)! - delta);
    }
  if (players.length > 1)
    for (const guard of guards.values())
      guard.confidence = Math.min(CONFIDENCE_ROUNDS, guard.confidence + 1);
  return {
    values: new Map(players.map((p) => [p.id, p.rating + deltas.get(p.id)!])),
    guards,
  };
}
