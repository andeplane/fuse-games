import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { parsePortalEntry } from "../packages/fuse-ui/src/portal.js";

const gamesRoot = new URL("../games/", import.meta.url);
const publicRoot = new URL("../public/", import.meta.url);

test("every game on the portal shows a gameplay capture, not its lettermark", () => {
  const listed = readdirSync(gamesRoot).filter((id) =>
    existsSync(new URL(`${id}/portal.json`, gamesRoot)),
  );
  assert.ok(listed.length > 0);
  const missing: string[] = [];
  for (const id of listed) {
    const entry = parsePortalEntry(
      JSON.parse(readFileSync(new URL(`${id}/portal.json`, gamesRoot), "utf8")),
    );
    assert.ok(entry, `games/${id}/portal.json is valid`);
    if (!entry.screenshot || !existsSync(new URL(entry.screenshot, publicRoot)))
      missing.push(id);
  }
  assert.deepEqual(
    missing,
    [],
    "add a recipe to scripts/gallery-capture.ts, run `pnpm gallery:capture <id>` and set `screenshot` in portal.json",
  );
});

test("every portal game has three to five distinct, available carousel images", () => {
  for (const id of readdirSync(gamesRoot)) {
    const portal = new URL(`${id}/portal.json`, gamesRoot);
    if (!existsSync(portal)) continue;
    const entry = parsePortalEntry(JSON.parse(readFileSync(portal, "utf8")));
    assert.ok(entry, `${id} has valid portal metadata`);
    const paths = entry.screenshots;
    assert.ok(paths, `${id} needs Fusteam carousel screenshots`);
    assert.ok(paths.length >= 3 && paths.length <= 5, `${id} needs 3–5 images`);
    assert.equal(
      new Set(paths).size,
      paths.length,
      `${id} repeats an image path`,
    );
    assert.ok(
      entry.screenshot && paths.includes(entry.screenshot),
      `${id} includes its gameplay cover`,
    );
    const contents = paths.map((path) => {
      const file = new URL(path, publicRoot);
      assert.ok(existsSync(file), `${id} carousel image ${path} exists`);
      return readFileSync(file).toString("base64");
    });
    assert.equal(
      new Set(contents).size,
      paths.length,
      `${id} repeats an image under another filename`,
    );
  }
});
