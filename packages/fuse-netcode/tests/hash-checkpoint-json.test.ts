import assert from "node:assert/strict";
import test from "node:test";
import { hashCheckpointJson } from "../src/index.js";

test("checkpoint hashes match the original room digest", () => {
  assert.equal(hashCheckpointJson([0]), "ba14edd98d93e5e0");
  assert.equal(
    hashCheckpointJson([7, { z: "Å🙂", a: [{ b: 2, a: 1 }, 3] }, 1]),
    "fb020943f6993d91",
  );
  assert.equal(
    hashCheckpointJson([
      12,
      { late: undefined, order: { "12": 12, "2": 2 }, n: Infinity },
      [undefined, NaN, -0, new Uint32Array([4, 8])],
    ]),
    "23b27416535243ce",
  );
});

test("checkpoint hashes ignore object insertion order and retain array order", () => {
  const hash = hashCheckpointJson({
    tick: 1,
    seats: [{ id: "a", slot: 0 }, "b"],
  });
  assert.equal(
    hash,
    hashCheckpointJson({ seats: [{ slot: 0, id: "a" }, "b"], tick: 1 }),
  );
  assert.notEqual(
    hash,
    hashCheckpointJson({ seats: ["b", { slot: 0, id: "a" }], tick: 1 }),
  );
});
