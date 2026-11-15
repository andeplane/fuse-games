import test from "node:test";
import assert from "node:assert/strict";
import {
  generateRoomCode,
  reserveRoomCode,
  validRoomCode,
  ROOM_CODE_SPACE,
} from "../src/room-code.js";
test("six-character codes uniformly map their full space and reject biased random tail", () => {
  assert.equal(
    generateRoomCode(() => 0),
    "000000",
  );
  assert.equal(
    generateRoomCode(() => ROOM_CODE_SPACE - 1),
    "ZZZZZZ",
  );
  let calls = 0;
  assert.equal(
    generateRoomCode(() => (++calls === 1 ? 2 ** 32 - 1 : 142)),
    "00003Y",
  );
  assert.equal(calls, 2);
  assert.throws(() => generateRoomCode(() => -1), /Invalid random/);
  assert.throws(() => generateRoomCode(() => 2 ** 32 - 1), /rejection limit/);
});
test("room identities validate six uppercase alphanumeric characters", () => {
  for (const code of ["AB42AA", "ZZ99AA"])
    assert.equal(validRoomCode(code), true);
  for (const code of [
    "ab42",
    "A142",
    "ABC1",
    "1234",
    "AB420",
    "AB42AA/",
    "AABBCCDDEE",
  ])
    assert.equal(validRoomCode(code), false);
});
test("collision reservation is bounded and never masks noncollision failure", async () => {
  let attempts = 0;
  assert.equal(
    await reserveRoomCode(
      async () => ++attempts === 3,
      () => `AA00${attempts}A`,
    ),
    "AA002A",
  );
  assert.equal(attempts, 3);
  attempts = 0;
  assert.equal(
    await reserveRoomCode(
      async () => {
        attempts++;
        return false;
      },
      () => "AA00AA",
    ),
    undefined,
  );
  assert.equal(attempts, 12);
  await assert.rejects(
    reserveRoomCode(async () => {
      throw new Error("database unavailable");
    }),
    /database unavailable/,
  );
});
