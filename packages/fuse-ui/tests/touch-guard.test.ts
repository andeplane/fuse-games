import assert from "node:assert/strict";
import { test } from "node:test";
import { installTouchGuard, type TouchGuardDevice } from "fuse-ui";
import { event, page } from "./dom-fixture.js";

function build(device: Partial<TouchGuardDevice> = {}) {
  const { document, window } = page();
  let asked = 0;
  const full: TouchGuardDevice = {
    touch: () => true,
    phone: () => true,
    embedded: () => false,
    fullscreen: () => false,
    enterFullscreen: async () => {
      asked++;
    },
    ...device,
  };
  installTouchGuard(document, full);
  const label = document.createElement("button");
  label.textContent = "GAS";
  const field = document.createElement("input");
  document.body.append(label, field);
  const fire = (target: Element, type: string) => {
    const sent = event(window, type);
    target.dispatchEvent(sent);
    return sent.defaultPrevented;
  };
  return { document, label, field, fire, asked: () => asked };
}

test("on a touch screen nothing but a field starts a selection or a callout; a link keeps its long press", () => {
  const { document, label, field, fire } = build();
  for (const type of ["selectstart", "contextmenu"]) {
    assert.equal(fire(label, type), true, `${type} on a button`);
    assert.equal(fire(field, type), false, `${type} in a field`);
  }
  const link = document.createElement("a");
  link.href = "https://example.test/invite";
  link.append(document.createElement("span"));
  document.body.append(link);
  assert.equal(fire(link.firstElementChild!, "contextmenu"), false);
  assert.equal(
    fire(label, "dblclick"),
    false,
    "a page's own double tap still works",
  );
});

test("a mouse keeps its selection and its menus", () => {
  const { label, fire } = build({ touch: () => false });
  assert.equal(fire(label, "selectstart"), false);
  assert.equal(fire(label, "contextmenu"), false);
});

test("the first tap on a phone asks for full screen, once while it is pending", () => {
  const { label, fire, asked, document } = build();
  assert.ok(document.documentElement.classList.contains("fui-touch-guard"));
  fire(label, "touchend");
  assert.equal(asked(), 0, "a touch that ended a scroll is no gesture");
  fire(label, "click");
  fire(label, "click");
  assert.equal(asked(), 1);
});

test("a framed page, a desktop or a page already full screen is not asked", () => {
  for (const device of [
    { embedded: () => true },
    { phone: () => false },
    { touch: () => false },
    { fullscreen: () => true },
  ]) {
    const { label, fire, asked } = build(device);
    fire(label, "click");
    assert.equal(asked(), 0);
  }
});

test("a refused full screen is not an error, and the next tap asks again", async () => {
  let asked = 0;
  const { label, fire } = build({
    enterFullscreen: () => {
      asked++;
      return Promise.reject(new Error("refused"));
    },
  });
  fire(label, "click");
  await new Promise((resolve) => setImmediate(resolve));
  fire(label, "click");
  assert.equal(asked, 2);
});
