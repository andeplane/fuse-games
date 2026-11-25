import test from "node:test";
import assert from "node:assert/strict";
import { playtestState } from "../src/app/playtest-state.js";
import { started } from "./fixtures/lane.js";

test("the report snapshot preserves match state and omits names, raw ids and free text", () => {
  const room = started();
  room.players.a!.bank = 500;
  room.players.a!.groceries = 4;
  room.players.a!.notices.push("private player notice");
  room.players.a!.msg = "private action message";
  const captured = playtestState(room, "a");
  const state = JSON.parse(captured);
  assert.equal(state.week, room.week);
  assert.equal(state.rng, room.rng);
  assert.equal(state.reporter, 0);
  assert.equal(state.players[0].state.bank, 500);
  assert.equal(state.players[0].state.groceries, 4);
  assert.equal(state.players[0].id, undefined);
  assert.equal(state.players[0].name, undefined);
  assert.doesNotMatch(
    captured,
    /Ada|private player notice|private action message/,
  );
});
