import test from "node:test";
import assert from "node:assert/strict";
import { ARENA_SIZE, arenaCamera } from "../src/render/present.js";
import { present } from "../src/app/presenter.js";
import { createArena } from "../src/engine/state.js";
import { view } from "../src/engine/view.js";

test("HUD shows countdown, launch, damage, spectating and corrected results from state", () => {
  const arena = createArena([
    { id: "solo", name: "You", slot: 0, bot: false },
    { id: "bot-1", name: "Sparks", slot: 1, bot: true },
  ]);
  const hud = () => present(view(arena.tick, "match", arena))!;
  assert.equal(present(view(0, "lobby", null)), undefined);
  assert.equal(hud().time, "02:00");
  assert.equal(hud().toast, "GET READY · 3");
  arena.tick = 60;
  arena.phase = "playing";
  assert.equal(hud().toast, "SPACE TO LAUNCH");
  arena.balls[0]!.held = null;
  arena.tick = 100;
  assert.equal(hud().toast, "");
  assert.equal(hud().time, "01:58");
  arena.bases[0]!.blocks[0]!.alive = false;
  assert.equal(hud().cards[0]!.armor, "47 / 48");
  arena.bases[0]!.alive = false;
  assert.equal(hud().cards[0]!.armor, "CORE LOST");
  assert.equal(hud().cards[0]!.label, "SPECTATING");
  assert.equal(hud().toast, "CORE LOST · WATCH THE FINISH");
  arena.phase = "over";
  arena.winner = "bot-1";
  arena.bases[0]!.saves = 4;
  arena.bases[1]!.broken = 7;
  arena.bases[1]!.blocks[0]!.alive = false;
  assert.equal(hud().toast, "");
  // The last core standing first; a solo run is its own host.
  assert.deepEqual(hud().result, {
    title: "SPARKS WINS",
    map: hud().map,
    rows: [
      {
        id: "bot-1",
        slot: 1,
        name: "Sparks",
        you: false,
        bot: true,
        place: 1,
        alive: true,
        saves: 0,
        broken: 7,
        armor: 47,
      },
      {
        id: "solo",
        slot: 0,
        name: "You",
        you: true,
        bot: false,
        place: 2,
        alive: false,
        saves: 4,
        broken: 0,
        armor: 47,
      },
    ],
    winnerSlot: 1,
    solo: true,
    host: true,
    waiting: "",
  });
  // In a room only the host leads on; everybody else waits.
  const room = (host: boolean) =>
    present(view(arena.tick, "match", arena), "solo", host)!.result!;
  assert.deepEqual(
    [room(false).solo, room(false).host, room(false).waiting],
    [false, false, "Waiting for the host"],
  );
  assert.deepEqual([room(true).host, room(true).waiting], [true, ""]);
  // A draw at the time limit: whoever still stands shares first place, the most blocks broken leading.
  arena.winner = null;
  arena.tick = 2460;
  arena.bases[0]!.alive = true;
  assert.equal(hud().result!.title, "ROUND DRAW");
  assert.equal(hud().result!.winnerSlot, -1);
  assert.deepEqual(
    hud().result!.rows.map((row) => [row.id, row.place]),
    [
      ["bot-1", 1],
      ["solo", 1],
    ],
  );
  // Nobody left standing is a draw too.
  arena.bases.forEach((base) => (base.alive = false));
  assert.deepEqual(
    hud().result!.rows.map((row) => row.place),
    [1, 1],
  );
  assert.equal(hud().time, "00:00");
  // A corrected snapshot restores the player's armor and removes the speculative result.
  arena.bases[0]!.alive = true;
  arena.bases[0]!.blocks[0]!.alive = true;
  arena.phase = "playing";
  assert.equal(hud().result, undefined);
  assert.equal(hud().cards[0]!.armor, "48 / 48");
});

test("phone camera extends the station without stretching or cropping the square arena", () => {
  for (const [width, height] of [
    [360, 800],
    [844, 390],
    [1000, 1000],
  ] as const) {
    const frame = arenaCamera(width, height);
    assert.equal(Math.min(frame.width, frame.height), ARENA_SIZE);
    assert.ok(Math.abs(frame.width * frame.zoom - width) < 1e-9);
    assert.ok(Math.abs(frame.height * frame.zoom - height) < 1e-9);
  }
});
