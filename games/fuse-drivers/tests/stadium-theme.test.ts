import assert from "node:assert/strict";
import { test } from "node:test";
import { readStadiumTheme, storeStadiumTheme } from "../src/app/arena/theme.js";
import type { Store } from "fuse-ui/room-session";
import {
  courseAccent,
  coursePalette,
} from "../src/app/arena/course-palette.js";

test("course previews and arena rails share a distinct palette in both directions", () => {
  const courses = Array.from({ length: 8 }, (_, i) => "offroad-" + (i + 1));
  assert.equal(new Set(courses.map(courseAccent)).size, 8);
  assert.equal(new Set(courses.map((id) => coursePalette(id).dirt[3])).size, 8);
  for (const id of courses) {
    assert.equal(coursePalette(id + "-reverse"), coursePalette(id));
    assert.equal(courseAccent(id), coursePalette(id).accent);
  }
});

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
