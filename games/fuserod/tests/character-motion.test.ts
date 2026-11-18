import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { carhopPose, END_FRAMES } from "../src/art/character-motion";
import { scenePlayback } from "../src/garage/scene-playback";

test("carhop enters with eleven poses, pauses at the window, then leaves with ten poses", () => {
  const ticks = Array.from({ length: 231 }, (_, i) => carhopPose(i));
  for (const [returning, count] of [
    [false, 11],
    [true, 10],
  ] as const) {
    const pass = ticks.filter((p) => p?.returning === returning);
    assert.equal(new Set(pass.map((p) => p?.frame)).size, count);
    assert.equal(pass[0]?.progress, 0);
    assert.equal(pass.at(-1)?.progress, 1);
  }
  assert.equal(ticks.at(-1), undefined);
  assert.deepEqual(carhopPose(232), carhopPose(0));
});

test("scene redraw stops upon disposal and reduced motion shows a settled composition", async () => {
  const window = new Window();
  try {
    window.happyDOM.setViewport({ width: 480, height: 360 });
    const canvas = window.document.createElement(
      "canvas",
    ) as unknown as HTMLCanvasElement;
    canvas.ownerDocument.body.append(canvas);
    const frames: number[] = [];
    const release = scenePlayback(canvas, "champion", (frame) =>
      frames.push(frame),
    );

    await Promise.resolve();
    assert.equal(frames.at(-1), 0);
    release();
    const calls = frames.length;
    canvas.ownerDocument.dispatchEvent(
      new window.Event("visibilitychange") as unknown as Event,
    );
    await Promise.resolve();
    assert.equal(frames.length, calls);
    window.happyDOM.settings.device.prefersReducedMotion = "reduce";
    const stopStill = scenePlayback(canvas, "champion", (f) => frames.push(f));
    await Promise.resolve();
    assert.equal(frames.at(-1), END_FRAMES - 1);
    stopStill();
  } finally {
    await window.happyDOM.close();
  }
});
