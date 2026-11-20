import test from "node:test";
import assert from "node:assert/strict";
import { PRESENCE, packMessage, unpackMessage } from "fuse-netcode";
import { INPUT, encodeRoom, decodeRoom, hashRoom } from "../src/game/index.js";
import { fold, started } from "./fixtures/fuseheads.js";
test("a checkpoint restores a held input and an away seat, then continues identically", () => {
  const room = started();
  fold(room, {
    a: [[INPUT, "expedition", 1, 2]],
    b: [[PRESENCE, "b", false, 1]],
  });
  const fields = unpackMessage(packMessage(encodeRoom(room)));
  assert.ok(Array.isArray(fields));
  const copy = decodeRoom(fields, room.tick);
  assert.ok(copy);
  assert.equal(copy.seats.get("b")?.away, true);
  assert.equal(hashRoom(copy), hashRoom(room));
  for (let n = 0; n < 25; n++) {
    fold(room);
    fold(copy);
  }
  assert.equal(hashRoom(copy), hashRoom(room));
});
test("inconsistent snapshots fail atomically, including a wrong campaign, duplicate seat, invalid mask and malformed simulation", () => {
  const room = started(),
    original = hashRoom(room);
  const [h, s, seats, p, w, r] = encodeRoom(room);
  assert.ok(Array.isArray(h) && Array.isArray(seats) && Array.isArray(p));
  for (const fields of [
    [[h[0], 2, h[2], h[3], h[4]], s, seats, p, w, r],
    [h, s, [seats[0], seats[0]], p, w, r],
    [h, s, seats, [[...p[0].slice(0, 4), 8, [], 0], p[1]], w, r],
    [h, s, seats, p, { levelIndex: 0 }, r],
    [h, s, seats, [], w, r],
  ])
    assert.equal(decodeRoom(fields, room.tick), undefined);
  assert.equal(hashRoom(room), original);
});
