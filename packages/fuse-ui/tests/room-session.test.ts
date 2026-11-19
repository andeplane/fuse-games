import assert from "node:assert/strict";
import test from "node:test";
import { safeStore } from "../src/room-session.js";
import { createMemoryStorage } from "../src/safe-storage.js";

test("room storage probes once and keeps the store it opened", () => {
  const backing = createMemoryStorage();
  const reads: string[] = [];
  let opens = 0;
  const store = safeStore(() => {
    assert.equal(++opens, 1);
    return {
      ...backing,
      getItem(key) {
        reads.push(key);
        return backing.getItem(key);
      },
    };
  });
  assert.deepEqual(reads, ["probe"]);
  store.setItem("room", "member");
  assert.equal(store.getItem("room"), "member");
  store.removeItem("room");
  assert.equal(backing.getItem("room"), null);
  assert.equal(opens, 1);
  assert.deepEqual(reads, ["probe", "room"]);
});
