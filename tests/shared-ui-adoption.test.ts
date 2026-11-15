import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Every game on the portal is built from the same fuse-ui pieces: the top bar, the room, the results screen and the
// portal button. A game that grows its own lobby, header or end screen drifts from the others, and every rule Anders
// sets for "all games" then has to be ported by hand. This test catches a new game, or a rewrite, that skips one.
// Pig (`games/dice`) has no portal.json and is not checked, though it uses them too.

const gamesDir = join(import.meta.dirname, "..", "games");

/** The pieces a portal game must use, each with the identifiers that count as using it. */
const REQUIRED: ReadonlyArray<{ piece: string; uses: RegExp }> = [
  { piece: "the shared top bar (createTopBar)", uses: /\bcreateTopBar\b/ },
  {
    piece: "the shared room (createRoomLayout or roomLayoutMarkup)",
    uses: /\b(createRoomLayout|roomLayoutMarkup)\b/,
  },
  {
    piece: "the shared results screen (createResultsScreen or renderResults)",
    uses: /\b(createResultsScreen|renderResults)\b/,
  },
  { piece: "the app portal (createAppPortal)", uses: /\bcreateAppPortal\b/ },
];

/** Source with comments removed, so a name mentioned in a comment does not count as using it. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sourceOf = (dir: string): string => {
  let text = "";
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      if (statSync(child).isDirectory()) walk(child);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
        text += stripComments(readFileSync(child, "utf8"));
    }
  };
  walk(dir);
  return text;
};

const portalGames = readdirSync(gamesDir).filter((id) =>
  existsSync(join(gamesDir, id, "portal.json")),
);

test("there are portal games to check", () => {
  assert.ok(portalGames.length > 1, "found no games/<id>/portal.json");
});

for (const id of portalGames) {
  test(`${id} uses the shared fuse-ui top bar, room, results screen and portal`, () => {
    const source = sourceOf(join(gamesDir, id, "src"));
    assert.match(
      source,
      /from "fuse-ui/,
      `games/${id} imports nothing from fuse-ui`,
    );
    const missing = REQUIRED.filter(({ uses }) => !uses.test(source)).map(
      ({ piece }) => piece,
    );
    assert.deepEqual(
      missing,
      [],
      `games/${id} does not use ${missing.join(", ")}. Build it from packages/fuse-ui (see its README, "Menu patterns") rather than a game-local copy.`,
    );
  });
}
