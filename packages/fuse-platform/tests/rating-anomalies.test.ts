import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ratingAnomalies } from "../src/rating-anomalies.js";
import { opaqueOpponent } from "../src/settlement.js";

test("F-06 private report identifies velocity, repeated opponents and isolated groups", () => {
  const guard = (opponent: string, rounds: number, movement: number) => ({
    day: 3,
    confidence: 1,
    movement,
    opponents: { [opaqueOpponent(opponent)]: { rounds, movement } },
  });
  const report = ratingAnomalies(
    [
      { uid: "alice", guard: guard("bob", 9, 20) },
      { uid: "bob", guard: guard("alice", 9, 20) },
      { uid: "carol", guard: guard("dave", 4, 5) },
      { uid: "dave", guard: guard("carol", 4, 5) },
      { uid: "old", guard: { ...guard("alice", 1, 1), day: 2 } },
      { uid: "bad", guard: {} },
    ],
    3,
  );
  assert.equal(report.accounts, 4);
  assert.equal(report.invalid, 1);
  assert.equal(report.velocity[0]!.movement, 20);
  assert.equal(report.pairs[0]!.rounds, 9);
  assert.equal(report.disjointComponents.length, 1);
  assert.equal(report.disjointComponents[0]!.length, 2);
  assert.ok(!JSON.stringify(report).includes("alice"));
});
