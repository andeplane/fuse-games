import assert from "node:assert/strict";
import { test } from "node:test";
import { createLeadChain } from "../src/index.js";

test("a non-finite sample retains the newest cached stage without advancing", () => {
  const initial = { step: 0 };
  const sample = createLeadChain<typeof initial>();
  const base = { key: "revision", start: () => initial };
  const one = sample({
    ...base,
    advance: () => ({ step: 1 }),
    steps: () => 1,
  });
  for (const ahead of [NaN, Infinity, -Infinity]) {
    const frame = sample({
      ...base,
      advance: () => assert.fail("a non-finite sample must not advance"),
      steps: () => ahead,
    });
    assert.equal(frame.current, one.current);
    assert.equal(frame.previous, initial);
    assert.equal(frame.next, undefined);
  }
});
