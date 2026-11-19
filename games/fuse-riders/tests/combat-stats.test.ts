import assert from "node:assert/strict";
import test from "node:test";
import { emptyCombat, parseCombat } from "../src/engine/combat-stats.js";
import { MAX_PLAYERS } from "../src/engine/tuning.js";

test("a combat record counts a place for every seat, and ones written for five or six seats are still read", () => {
  const current = emptyCombat();
  assert.equal(current.roundPlaces.length, MAX_PLAYERS);
  current.roundPlaces[MAX_PLAYERS - 1] = 2;
  assert.deepEqual(parseCombat(current, 100), current);

  // Stored careers and match details from before the seventh and eighth seats carry five or six places.
  const pad = (places: number[]) => [
    ...places,
    ...Array.from({ length: MAX_PLAYERS - places.length }, () => 0),
  ];
  for (const roundPlaces of [
    [3, 0, 1, 0, 2],
    [3, 0, 1, 0, 2, 4],
  ])
    assert.deepEqual(
      parseCombat({ ...emptyCombat(), roundPlaces }, 100)?.roundPlaces,
      pad(roundPlaces),
      `${roundPlaces.length} places are padded with empty places`,
    );
  for (const roundPlaces of [
    [1, 2, 3, 4],
    [1, 2, 3, 4, 5, 6, 7],
    Array.from({ length: MAX_PLAYERS + 1 }, () => 0),
    [],
    "12345",
  ])
    assert.equal(
      parseCombat({ ...emptyCombat(), roundPlaces }, 100),
      undefined,
      JSON.stringify(roundPlaces),
    );
});
