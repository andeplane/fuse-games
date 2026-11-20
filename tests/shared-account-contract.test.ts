import { seatPlayerName } from "../packages/fuse-platform/src/player-name.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  validAccountName,
  suggestAccountName,
} from "../packages/fuse-ui/src/account-name.js";
import {
  validRiderName,
  suggestRiderName,
} from "../games/fuse-riders/src/engine/rider-name.js";
import { validName as validGraveyardName } from "../games/graveyard-shift/src/online/names.js";
import { validName as validDriverName } from "../games/fuse-drivers/src/game/basics.js";
test("shared username UI agrees with existing engine and backend name rules", () => {
  for (const name of [
    "Ada",
    "",
    " Ada",
    "x".repeat(18),
    "x".repeat(19),
    "🦊".repeat(18),
    "a\n",
    "\ud800",
    "<b>Ada</b>",
  ]) {
    assert.equal(validAccountName(name), validRiderName(name), name);
    assert.equal(validAccountName(name), validGraveyardName(name), name);
    assert.equal(validAccountName(name), validDriverName(name), name);
    assert.equal(suggestAccountName(name), suggestRiderName(name), name);
  }
});

test("shared seating strips lone surrogates and preserves the code-point limit", () => {
  const foxes = "🦊".repeat(17);
  assert.equal(seatPlayerName(" \ud800" + foxes + " y "), foxes);
  assert.equal(seatPlayerName("🦊".repeat(19)), "🦊".repeat(18));
  assert.equal(seatPlayerName("x".repeat(19) + "\u007f"), undefined);
});
