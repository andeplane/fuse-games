import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createSongHold } from "../src/app/song-hold.js";

test("the song hold displays actual percentage and bytes, then a distinct decode phase", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const hold = createSongHold(document);
  const bar = hold.element.querySelector("progress")!;
  hold.update([], false, { phase: "downloading", received: 1024, total: 4096 });
  assert.match(hold.element.textContent!, /25% · 1 KB \/ 4 KB/);
  assert.equal(bar.value, 0.25);
  assert.equal(bar.getAttribute("aria-valuetext"), "25 percent downloaded");
  hold.update([], false, { phase: "decoding", received: 4096, total: 4096 });
  assert.match(hold.element.textContent!, /PREPARING AUDIO/);
  assert.equal(bar.hasAttribute("value"), false);
  hold.update(["Alice"], true);
  assert.match(hold.element.textContent!, /WAITING FOR ALICE/);
  assert.equal(bar.hidden, true);
});

test("an unknown length is indeterminate and a retry clears the previous percentage", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const hold = createSongHold(document);
  const bar = hold.element.querySelector("progress")!;
  hold.update([], false, { phase: "downloading", received: 2048 });
  assert.match(hold.element.textContent!, /2 KB received/);
  assert.equal(bar.hasAttribute("value"), false);
  hold.update([], false, { phase: "retrying", received: 0 });
  assert.match(hold.element.textContent!, /RETRYING DOWNLOAD/);
  assert.doesNotMatch(hold.element.textContent!, /%/);
});
