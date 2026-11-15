import assert from "node:assert/strict";
import { test } from "node:test";
import { createHowToPlay, createLandingCard } from "fuse-ui";
import { page } from "./dom-fixture.js";

test("instructions render safe key/action pairs, touch gestures and rules in reading order", () => {
  const { document } = page();
  const help = createHowToPlay({
    document,
    goal: "Reach the exit",
    controls: [{ keys: "Ctrl + X", action: "<script>Fire</script>" }],
    touchControls: [{ keys: "Fire pad", action: "Hold to fire" }],
    rules: ["Reload before firing again"],
  });
  assert.equal(help.querySelector("kbd")?.textContent, "Ctrl + X");
  assert.equal(help.querySelector("script"), null);
  assert.deepEqual(
    [...help.querySelectorAll("dd")].map((n) => n.textContent),
    ["<script>Fire</script>", "Hold to fire"],
  );
  assert.equal(
    help.querySelector("li")?.textContent,
    "Reload before firing again",
  );
});

test("landing forwards structured instructions and refreshes configurable keys on each opening", () => {
  const { document } = page();
  let key = "Ctrl";
  const card = createLandingCard({
    document,
    title: "Game",
    tagline: "A tagline",
    onCreate() {},
    valid: () => false,
    onJoin() {},
    howToPlay: () => ({
      goal: "Reach the exit",
      controls: [{ keys: key, action: "Fire" }],
    }),
  });
  document.body.append(card.element);
  card.menu.dialog.showModal = () => {
    card.menu.dialog.open = true;
  };
  const how = [...card.element.querySelectorAll("button")].find(
    (n) => n.textContent === "How to play",
  )!;
  how.click();
  assert.equal(card.menu.help.querySelector("kbd")?.textContent, "Ctrl");
  card.menu.dialog.open = false;
  key = "Option";
  how.click();
  assert.equal(card.menu.help.querySelector("kbd")?.textContent, "Option");
  assert.equal(card.menu.help.textContent?.includes("A tagline"), false);
});
