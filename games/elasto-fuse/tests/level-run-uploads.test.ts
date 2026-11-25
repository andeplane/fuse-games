import test from "node:test";
import assert from "node:assert/strict";
import { RULES } from "../src/engine/index.js";
import {
  createLevelRunUploads,
  type LevelRunPorts,
} from "../src/app/level-run-uploads.js";
import type { LevelRun } from "../src/level-times.js";

const run = (level: number): LevelRun => ({
  rules: RULES,
  level,
  steps: 100,
  inputs: [[0, 1]],
});
/** A board that records what was posted, with a switchable account and outcome. */
function fakeBoard() {
  const posted: { level: number; token: string }[] = [];
  const board = {
    token: undefined as string | undefined,
    fail: false,
    posted,
  };
  const ports: LevelRunPorts = {
    token: async () => board.token,
    post: async (sent, token) => {
      if (board.fail) throw new Error("offline");
      posted.push({ level: sent.level, token });
      return true;
    },
  };
  return { board, ports };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("every race's finish is sent once, in solo and rooms alike", async () => {
  const { board, ports } = fakeBoard();
  board.token = "t";
  const uploads = createLevelRunUploads(ports);
  uploads.offer("m1:0", run(0), true);
  uploads.offer("m1:0", run(0), true);
  uploads.offer("m1:1", run(1), true);
  uploads.offer("m2:0", run(2), true);
  await settle();
  assert.deepEqual(
    board.posted.map((each) => each.level),
    [0, 1, 2],
  );
  assert.deepEqual(uploads.summary("m1"), {
    status: "2 of 2 times sent to the level boards",
    failed: false,
  });
  assert.deepEqual(uploads.summary("m2"), {
    status: "Leaderboard time saved",
    failed: false,
  });
  assert.equal(uploads.summary("m3"), undefined);
});

test("a run finished signed out waits for the sign-in, and a failed send can be retried", async () => {
  const { board, ports } = fakeBoard();
  const uploads = createLevelRunUploads(ports);
  uploads.offer("m1:0", run(3), false);
  uploads.signedIn();
  await settle();
  assert.equal(board.posted.length, 0, "the token was not there yet");
  assert.equal(uploads.summary("m1")?.status, "Sign in to save your time");
  uploads.signedIn();
  await settle();
  assert.equal(
    board.posted.length,
    0,
    "asked once per sign-in, not every frame",
  );

  uploads.offer("m2:0", run(4), false);
  board.token = "t";
  board.fail = true;
  uploads.signedIn();
  await settle();
  assert.deepEqual(uploads.summary("m2"), {
    status: "Could not save leaderboard time",
    failed: true,
  });
  board.fail = false;
  uploads.retry("m2");
  await settle();
  assert.deepEqual(board.posted, [{ level: 4, token: "t" }]);
  assert.equal(uploads.summary("m2")?.failed, false);
  uploads.retry("m1");
  await settle();
  assert.deepEqual(
    board.posted.map((each) => each.level),
    [4, 3],
    "retry also sends a run that waited for an account",
  );
});
