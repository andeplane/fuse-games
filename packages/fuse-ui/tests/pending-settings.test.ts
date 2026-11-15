import test from "node:test";
import assert from "node:assert/strict";
import { createPendingSettings } from "../src/pending-settings.js";

interface Settings {
  level: number;
  weekSeconds: number;
  display: boolean;
}
const ROOM: Settings = { level: 1, weekSeconds: 60, display: false };

function pendingAt(start = 0) {
  let time = start;
  const pending = createPendingSettings<Settings>(() => time, 2000);
  /** Sends `patch` the way the room's actions do, and says what went out. */
  const send = (frame: Settings, patch: Partial<Settings>) => {
    const sent = pending.with(frame, patch);
    pending.sent(patch);
    return sent;
  };
  return { pending, send, wait: (ms: number) => (time += ms) };
}

test("two choices within one frame: the second command keeps the first instead of sending its old value back", () => {
  const { send } = pendingAt();
  assert.deepEqual(send(ROOM, { display: true }), { ...ROOM, display: true });
  // The frame still shows the old settings; the level's command must not untick the TV.
  assert.deepEqual(send(ROOM, { level: 2 }), {
    level: 2,
    weekSeconds: 60,
    display: true,
  });
  // A newer choice for the same setting replaces the older one.
  assert.deepEqual(send(ROOM, { display: false }), {
    level: 2,
    weekSeconds: 60,
    display: false,
  });
});

test("a choice the room answered is the room's again: a later change by someone else is not overwritten", () => {
  const { pending, send } = pendingAt();
  send(ROOM, { display: true });
  pending.answered({ ...ROOM, display: true });
  // Another device's host turned it off since; this device's next command sends what the room has.
  const frame = { ...ROOM, display: false };
  assert.deepEqual(send(frame, { level: 0 }), { ...frame, level: 0 });
});

test("a choice the room never took stops riding along after the hold", () => {
  const { pending, send, wait } = pendingAt();
  send(ROOM, { display: true });
  pending.answered(ROOM);
  wait(1999);
  assert.equal(pending.with(ROOM, { level: 2 }).display, true);
  wait(1);
  assert.equal(pending.with(ROOM, { level: 2 }).display, false);
});

test("a command the room refused leaves nothing pending", () => {
  const { pending } = pendingAt();
  // `with` alone is what a refused command built; nothing was `sent`.
  pending.with(ROOM, { display: true });
  assert.deepEqual(pending.with(ROOM, { level: 2 }), { ...ROOM, level: 2 });
});

test("leaving a settings context cancels unanswered choices before another edit", () => {
  const { pending, send } = pendingAt();
  send(ROOM, { display: true });
  pending.clear();
  assert.deepEqual(send(ROOM, { level: 2 }), { ...ROOM, level: 2 });
});
