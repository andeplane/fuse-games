import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  guardedElo,
  ACCOUNT_DAILY_ELO,
  PAIR_DAILY_ELO,
  PAIR_DAILY_ROUNDS,
  parseRatingGuard,
  type RatingGuard,
} from "../src/rating-guard.js";

test("F-06: same pair stops exchanging Elo after its daily round budget", () => {
  let a = 1000,
    b = 1000;
  let ga: RatingGuard | undefined, gb: RatingGuard | undefined;
  for (let i = 0; i < PAIR_DAILY_ROUNDS; i++) {
    const next = guardedElo(
      [
        {
          id: "a",
          uid: "a",
          opponentKey: "a".repeat(64),
          rating: a,
          score: 1,
          wins: 1,
          guard: ga,
        },
        {
          id: "b",
          uid: "b",
          opponentKey: "b".repeat(64),
          rating: b,
          score: 0,
          wins: 0,
          guard: gb,
        },
      ],
      1,
    );
    a = next.values.get("a")!;
    b = next.values.get("b")!;
    ga = next.guards.get("a");
    gb = next.guards.get("b");
  }
  const next = guardedElo(
    [
      {
        id: "a",
        uid: "a",
        opponentKey: "a".repeat(64),
        rating: a,
        score: 1,
        wins: 1,
        guard: ga,
      },
      {
        id: "b",
        uid: "b",
        opponentKey: "b".repeat(64),
        rating: b,
        score: 0,
        wins: 0,
        guard: gb,
      },
    ],
    1,
  );
  assert.ok(a > 1000);
  assert.equal(next.values.get("a"), a);
  assert.equal(next.values.get("b"), b);
  assert.ok(Math.abs(a + b - 2000) < 1e-8);
});

test("F-06: a saturated account budget prevents exchanges with a fresh opponent", () => {
  const next = guardedElo(
    [
      {
        id: "a",
        uid: "a",
        opponentKey: "a".repeat(64),
        rating: 1000,
        score: 1,
        wins: 1,
        guard: {
          day: 0,
          movement: ACCOUNT_DAILY_ELO,
          confidence: 20,
          opponents: {},
        },
      },
      {
        id: "b",
        uid: "b",
        opponentKey: "b".repeat(64),
        rating: 1000,
        score: 0,
        wins: 0,
      },
    ],
    1,
  );
  assert.equal(next.values.get("a"), 1000);
  assert.equal(next.values.get("b"), 1000);
});

test("F-06: both directions consume the same pair budget and the next UTC day resets it", () => {
  const a: RatingGuard = {
    day: 0,
    movement: 399,
    confidence: 20,
    opponents: { ["b".repeat(64)]: { rounds: 2, movement: 399 } },
  };
  const b: RatingGuard = {
    day: 0,
    movement: 399,
    confidence: 20,
    opponents: { ["a".repeat(64)]: { rounds: 2, movement: 399 } },
  };
  const players = [
    {
      id: "a",
      uid: "a",
      opponentKey: "a".repeat(64),
      rating: 1000,
      score: 0,
      wins: 0,
      guard: a,
    },
    {
      id: "b",
      uid: "b",
      opponentKey: "b".repeat(64),
      rating: 1000,
      score: 1,
      wins: 1,
      guard: b,
    },
  ];
  const limited = guardedElo(players, 1);
  assert.equal(limited.values.get("b"), 1001);
  assert.equal(
    limited.guards.get("a")!.opponents["b".repeat(64)]!.movement,
    PAIR_DAILY_ELO,
  );
  const reset = guardedElo(players, 86_400_000);
  assert.equal(reset.values.get("b"), 1016);
  assert.equal(reset.guards.get("b")!.confidence, 20);
  assert.equal(parseRatingGuard({ ...a, confidence: -1 }), undefined);
});
