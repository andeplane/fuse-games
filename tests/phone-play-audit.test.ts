import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PHONE_PLAY_GAME_IDS,
  PHONE_PLAY_RECIPES,
  PHONE_PLAY_SURFACES,
} from "../scripts/lib/phone-play-cases.js";

test("each registered browser game has a phone gameplay recipe and real field selector", () => {
  const registered = [...PHONE_PLAY_GAME_IDS].sort();
  assert.deepEqual(Object.keys(PHONE_PLAY_RECIPES).sort(), registered);
  assert.deepEqual(Object.keys(PHONE_PLAY_SURFACES).sort(), registered);

  for (const id of registered) {
    assert.equal(typeof PHONE_PLAY_RECIPES[id], "function", id);
    assert.ok(PHONE_PLAY_SURFACES[id]?.field.trim(), id);
  }
});

test("registered browser games opt into viewport coverage and safe-area insets", async () => {
  const missing: string[] = [];
  for (const id of PHONE_PLAY_GAME_IDS) {
    const markup = await readFile(
      new URL(`../games/${id}/index.html`, import.meta.url),
      "utf8",
    );
    const viewport = markup
      .match(/<meta\s+[^>]+>/gi)
      ?.find((tag) => /\bname\s*=\s*["']viewport["']/i.test(tag));
    const content = viewport?.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    if (
      !content
        ?.split(",")
        .some((part) => /^\s*viewport-fit\s*=\s*cover\s*$/i.test(part))
    )
      missing.push(id);
  }
  assert.deepEqual(missing, []);
});
