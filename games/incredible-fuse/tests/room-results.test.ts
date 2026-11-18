import assert from "node:assert/strict";
import test from "node:test";
import { ACTION, JOIN, LEAVE, SETTINGS, World } from "fuse-netcode";
import {
  DEFAULT_SETTINGS,
  EDIT,
  createRoom,
  incredibleFuseGame,
  matchResult,
  privateWorkshopGame,
} from "../src/game/index.js";
import { FREE_WORKSHOP, type WorkshopBlueprint } from "../src/game/machine.js";

test("solving one puzzle freezes a shared win, and rematch starts the next selected puzzle", () => {
  const w = new World(
    incredibleFuseGame,
    createRoom("lobby", DEFAULT_SETTINGS),
    "a",
    "a",
  );
  const a = w.stream("a", 1);
  a.append(1, [JOIN, "a", "Ada", 0, "cat", 1]);
  a.append(1, [JOIN, "b", "Ben", 1, "cat", 2]);
  a.append(2, [ACTION, "start", "match-a"]);
  a.append(3, [
    EDIT,
    "match-a",
    1,
    { type: "place", kind: "ramp", x: 160, y: 140 },
  ]);
  a.append(4, [EDIT, "match-a", 1, { type: "run" }]);
  w.advance(60);
  const result = matchResult(w.state);
  assert.ok(result);
  assert.deepEqual(result.finishers, ["a", "b"]);
  assert.ok(
    result.players.every((p) => p.roundWins === 1 && p.matchPlacement === 1),
  );
  a.append(61, [LEAVE, "b"]);
  w.advance(61);
  assert.deepEqual(matchResult(w.state), result);
  const decoded = incredibleFuseGame.checkpoint.decode(
    incredibleFuseGame.checkpoint.encode(w.state),
    61,
  );
  assert.deepEqual(decoded?.history, w.state.history);
  a.append(62, [SETTINGS, { display: false, puzzleIndex: 1 }]);
  a.append(63, [ACTION, "rematch", "match-b"]);
  a.append(64, [EDIT, "match-a", 1, { type: "run" }]);
  w.advance(64);
  assert.equal(w.state.machine.puzzle, 1);
  assert.equal(w.state.machine.mode, "build");
  assert.equal(w.state.history.length, 0);
});
test("solo imported start and return to lobby rebuild from owned immutable layout; normal room rejects its snapshot", () => {
  const blueprint: WorkshopBlueprint = {
    air: 42,
    gravity: 200,
    links: [],
    parts: [{ id: 1, kind: "ball", x: 50, y: 50, fixed: false, flip: false }],
  };
  const game = privateWorkshopGame(blueprint);
  blueprint.parts.length = 0;
  const settings = { puzzleIndex: FREE_WORKSHOP, display: false };
  const w = new World(game, game.createRoom("lobby", settings), "a", "a");
  const a = w.stream("a", 1);
  a.append(1, [JOIN, "a", "Ada", 0, "cat", 1]);
  a.append(2, [ACTION, "start", "machine"]);
  a.append(3, [EDIT, "machine", 1, { type: "remove", id: 1 }]);
  w.advance(3);
  assert.equal(w.state.machine.parts.length, 0);
  a.append(4, [ACTION, "lobby", "next"]);
  w.advance(4);
  assert.equal(w.state.machine.parts.length, 1);
  assert.equal(w.state.machine.air, 42);
  const fields = game.checkpoint.encode(w.state);
  assert.equal(incredibleFuseGame.checkpoint.decode(fields, 4), undefined);
  assert.deepEqual(game.checkpoint.decode(fields, 4), w.state);
});
