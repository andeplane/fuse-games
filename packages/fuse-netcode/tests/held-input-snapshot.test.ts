import assert from "node:assert/strict";
import test from "node:test";
import { createHeldInputDecoder } from "../src/index.js";

const decode = createHeldInputDecoder({
  capacity: 2,
  playerKey: (value): value is string => value === "a" || value === "b",
  isInput: (value): value is number =>
    value === 0 || value === 1 || value === 2,
});

test("checkpoint held inputs require unique member keys and nonzero valid inputs", () => {
  assert.deepEqual(decode([]), {});
  assert.deepEqual(
    decode([
      ["a", 2],
      ["b", 1],
    ]),
    { a: 2, b: 1 },
  );
  for (const raw of [
    [["a", 0]],
    [["a", 3]],
    [["c", 1]],
    [
      ["a", 1],
      ["a", 2],
    ],
    [["a", 1, false]],
    [{ id: "a", input: 1 }],
    [
      ["a", 1],
      ["b", 1],
      ["a", 1],
    ],
    { a: 1 },
  ])
    assert.equal(decode(raw), undefined);
});
