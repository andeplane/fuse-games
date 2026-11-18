import assert from "node:assert/strict";
import { test } from "node:test";
import { readStadiumTheme, storeStadiumTheme } from "../src/app/arena/theme.js";
import type { Store } from "../src/app/session.js";

test("the public stadium and private reference launcher have distinct first-run themes", () => {
  const store = { getItem: () => null };
  assert.equal(readStadiumTheme(store, false), "fuse");
  assert.equal(readStadiumTheme(store, true), "classic");
  assert.equal(readStadiumTheme({ getItem: () => "unknown" }, false), "fuse");
});

test("the selected device theme takes precedence and is independent of race mode", () => {
  const values = new Map<string, string>();
  const store: Pick<Store, "getItem" | "setItem"> = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  storeStadiumTheme(store, "classic");
  assert.equal(readStadiumTheme(store, false), "classic");
  storeStadiumTheme(store, "fuse");
  assert.equal(readStadiumTheme(store, true), "fuse");
});
