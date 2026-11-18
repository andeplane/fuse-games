import test from "node:test";
import assert from "node:assert/strict";
import { levelResult } from "../src/game/index.js";
import { dueReports } from "../src/app/reports.js";
import { started } from "./fixtures/fuseheads.js";

test("a cleared level credits both partners and reports only once the deciding frame settles", () => {
  const room = started(),
    world = structuredClone(room.world!);
  world.outcome = "cleared";
  const result = levelResult(room, world);
  assert.deepEqual(
    result.players.map((p) => [p.matchPlacement, p.roundWins]),
    [
      [1, 1],
      [1, 1],
    ],
  );
  assert.deepEqual(result.finishers, ["a", "b"]);
  room.receipts = [{ tick: 123, result }];
  assert.deepEqual(dueReports(room, "a", 122, new Set()), []);
  assert.equal(dueReports(room, "a", 123, new Set()).length, 1);
  assert.deepEqual(dueReports(room, "tv", 123, new Set()), []);
  assert.deepEqual(dueReports(room, "a", 130, new Set([result.matchId])), []);
});
