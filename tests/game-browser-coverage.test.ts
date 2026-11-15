import assert from "node:assert/strict";
import { test } from "node:test";
import { gameSourcePath } from "../scripts/lib/game-browser-coverage.js";

test("coverage resolves canonical public aliases to stable game source paths", () => {
  for (const [alias, id] of [
    ["fusebirds", "fuse-birds"],
    ["graveyardshift", "graveyard-shift"],
    ["fusero", "fusero"],
  ]) {
    assert.equal(
      gameSourcePath(`/${alias}/src/app/main.ts`, id),
      `/games/${id}/src/app/main.ts`,
    );
    assert.equal(
      gameSourcePath(`/games/${id}/src/app/main.ts`, id),
      `/games/${id}/src/app/main.ts`,
    );
  }
});

test("coverage mapping preserves other-game identity and rejects non-source URLs", () => {
  assert.equal(
    gameSourcePath("/fusero/src/app/main.ts", "fuse-birds"),
    "/games/fusero/src/app/main.ts",
  );
  assert.equal(
    gameSourcePath("/fusebirds/assets/atlas.png", "fuse-birds"),
    undefined,
  );
  assert.equal(
    gameSourcePath("/packages/fuse-ui/src/main-menu.ts", "fuse-birds"),
    undefined,
  );
});
