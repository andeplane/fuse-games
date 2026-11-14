import assert from "node:assert/strict";
import test from "node:test";
import { emptyCombat, parseCombat } from "../src/engine/combat-stats.js";
import { MAX_PLAYERS } from "../src/engine/tuning.js";

test("a combat record counts a place for every seat, and one written for five seats is still read", () => {
  const current = emptyCombat();
  assert.equal(current.roundPlaces.length, MAX_PLAYERS);
  current.roundPlaces[MAX_PLAYERS - 1] = 2;
  assert.deepEqual(parseCombat(current, 100), current);

  // Stored careers and match details from before the sixth seat carry five places.
  const legacy = { ...emptyCombat(), roundPlaces: [3, 0, 1, 0, 2] };
  assert.deepEqual(
    parseCombat(legacy, 100)?.roundPlaces,
    [3, 0, 1, 0, 2, 0],
    "an empty sixth place is added",
  );
  for (const roundPlaces of [[1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7], [], "12345"])
    assert.equal(
      parseCombat({ ...emptyCombat(), roundPlaces }, 100),
      undefined,
      JSON.stringify(roundPlaces),
    );
});
