import assert from "node:assert/strict";
import test from "node:test";
import { ACTION, SETTINGS } from "fuse-netcode";
import { fuseheadsGame } from "../src/game/index.js";
import { fold, started } from "./fixtures/fuseheads.js";

test("pack changes apply to the next expedition; returning to the lobby discards held controls", () => {
  const room = started();
  fold(room, { a: [[SETTINGS, { display: true, pack: "bonus" }]] });
  assert.equal(room.world?.pack, "original");
  assert.equal(room.settings.pack, "bonus");
  fold(room, { a: [[ACTION, "lobby", "new-lobby"]] });
  assert.equal(fuseheadsGame.view(room).world, null);
  assert.equal(room.participants.length, 0);
  fold(room, { a: [[ACTION, "start", "new-expedition"]] });
  assert.equal(room.world?.pack, "bonus");
  assert.deepEqual(
    room.participants.map((p) => p.mask),
    [0, 0],
  );
});
test("detached frames remain valid after a subsequent movement tick", () => {
  const room = started(),
    frame = fuseheadsGame.view(room),
    before = structuredClone(frame);
  for (let i = 0; i < 15; i++) fold(room);
  assert.deepEqual(frame, before);
  assert.ok(frame.world);
  assert.ok(room.world && room.world.tick > frame.world.tick);
});
