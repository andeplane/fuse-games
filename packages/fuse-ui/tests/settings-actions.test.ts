import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlayerOptions, labelSettingsAction } from "fuse-ui";
import { page, event } from "./dom-fixture.js";

test("shared player options use unique accessible panels and close on Escape or outside press", () => {
  const { document, window } = page();
  const changes: boolean[] = [];
  const first = createPlayerOptions({
    document,
    content: [],
    onOpenChange: (open) => changes.push(open),
  });
  const second = createPlayerOptions({ document, content: [] });
  document.body.append(first.element, second.element);
  assert.notEqual(first.panel.id, second.panel.id);
  assert.equal(first.button.getAttribute("aria-controls"), first.panel.id);
  assert.equal(first.button.textContent, "Player options");
  assert.equal(
    first.button.querySelector("svg")?.getAttribute("aria-hidden"),
    "true",
  );
  first.button.click();
  assert.equal(first.panel.hidden, false);
  first.panel.dispatchEvent(event(window, "pointerdown"));
  assert.equal(first.panel.hidden, false);
  first.button.dispatchEvent(event(window, "keydown", { key: "Escape" }));
  assert.equal(first.panel.hidden, true);
  assert.equal(first.button.getAttribute("aria-expanded"), "false");
  first.button.click();
  second.button.dispatchEvent(event(window, "pointerdown"));
  assert.equal(first.panel.hidden, true);
  first.dispose();
  first.button.click();
  assert.equal(first.panel.hidden, true);
  second.dispose();
  assert.deepEqual(changes, [true, false, true, false]);
});

test("scope labels preserve existing disabled state and handlers", () => {
  const { document } = page();
  const action = document.createElement("button");
  let calls = 0;
  action.onclick = () => calls++;
  action.disabled = true;
  labelSettingsAction(action, "room");
  assert.equal(action.textContent, "Room settings");
  assert.equal(action.getAttribute("aria-label"), "Room settings");
  assert.equal(action.disabled, true);
  action.disabled = false;
  action.click();
  assert.equal(calls, 1);
});
