import assert from "node:assert/strict";
import { test } from "node:test";
import { forwardWorld } from "../src/index.js";

test("a non-finite lead keeps the committed picture without stepping", () => {
  const world = { tick: 0 };
  for (const lead of [NaN, Infinity, -Infinity]) {
    const sample = forwardWorld(world, lead, undefined, {
      copy: (source) => ({ ...source }),
      beginTick: () => assert.fail("a non-finite lead must not query inputs"),
      step: () => assert.fail("a non-finite lead must not step the world"),
      decided: () => false,
    });
    assert.deepEqual(sample.copy, world);
    assert.notEqual(sample.copy, world);
    assert.equal(sample.next, undefined);
    assert.equal(sample.part, 0);
  }
});
