import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStorage } from "fuse-ui/safe-storage";
import { LEVELS } from "../src/engine/index.js";
import { createProgression } from "../src/app/progression.js";
import { keys } from "../src/app/session.js";

test("Continue resumes the first uncleared level and recognizes existing solo bests", () => {
  const store = createMemoryStorage();
  const names = keys("elasto-fuse");
  store.setItem(names.level, "54");
  store.setItem(names.best(LEVELS[0]!.id), "3250");
  store.setItem(names.clear(LEVELS[1]!.id), "invalid");
  const progress = createProgression(store, names);
  assert.equal(progress.next, 1);
  progress.record(3);
  assert.equal(createProgression(store, names).next, 1);
  progress.record(1);
  assert.equal(progress.next, 2);
  progress.record(2);
  assert.equal(createProgression(store, names).next, 4);
});
