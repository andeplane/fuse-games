import assert from "node:assert/strict";
import test from "node:test";
import { scoreRhythm } from "../src/lab/rhythm-score.js";

test("a chord is one reference row; repeated guesses cannot score the same row twice", () => {
  const score = scoreRhythm([1, 1, 2], [1, 1.01, 2.01], 0.02);
  assert.equal(score.reference, 2);
  assert.equal(score.detected, 3);
  assert.equal(score.matched, 2);
  assert.equal(score.recall, 1);
  assert.equal(score.precision, 2 / 3);
});

test("matching maximizes count rather than consuming a later row with a locally nearest guess", () => {
  const score = scoreRhythm([0, 0.04], [0.03, 0.07], 0.04);
  assert.equal(score.matched, 2);
  assert.equal(score.f1, 1);
  assert.ok(Math.abs(score.meanSignedErrorMs! - 30) < 1e-8);
});

test("sorting, duplicate times, inclusive tolerance and empty results have explicit semantics", () => {
  assert.equal(scoreRhythm([2, 1, 1], [2.04, 1.04], 0.04).f1, 1);
  assert.equal(scoreRhythm([1], [1.041], 0.04).matched, 0);
  assert.deepEqual(scoreRhythm([], [], 0.04), {
    reference: 0,
    detected: 0,
    matched: 0,
    precision: 0,
    recall: 0,
    f1: 0,
    meanErrorMs: null,
    meanSignedErrorMs: null,
  });
  assert.throws(() => scoreRhythm([NaN], [], 0.04));
  assert.throws(() => scoreRhythm([], [], -1));
});
