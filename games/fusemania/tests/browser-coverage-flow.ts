import assert from "node:assert/strict";
import { launchSelected } from "../../../scripts/lib/browser.js";
import { startGameCoverage } from "../../../scripts/lib/game-browser-coverage.js";

const browser = await launchSelected("chrome", { args: ["--mute-audio"] });
try {
  const lab = await browser.newPage();
  // Keep this smoke's notes out of the developer's shared chart-lab folder.
  await lab.route("**/__chart-lab/notes", async (route) => {
    await route.fulfill({
      status: route.request().method() === "GET" ? 404 : 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  const finishLab = await startGameCoverage(lab, { gameId: "fusemania" });
  await lab.goto(
    new URL(
      "fusemania/chart-lab.html?mute",
      process.env.ONLINE_URL ?? "http://127.0.0.1:5173/",
    ).href,
  );
  await lab.locator(".lab-canvas").waitFor();
  await lab.locator('select[title="Spectrogram"]').selectOption("model");
  await lab
    .locator('input[title="Draw 16th lines over the spectrogram"]')
    .uncheck();
  assert.equal(
    await lab.locator('select[title="Spectrogram"]').inputValue(),
    "model",
  );
  assert.equal(
    await lab
      .locator('input[title="Draw 16th lines over the spectrogram"]')
      .isChecked(),
    false,
  );
  await lab.keyboard.press("+");
  await lab.keyboard.press("x");
  const song = await lab.locator('select[title="Song"]').inputValue();
  assert.notEqual(
    await lab.evaluate(
      (id) => localStorage.getItem(`fusemania-lab:marker:${id}`),
      song,
    ),
    null,
  );
  await lab.keyboard.press("Enter");
  const canvas = lab.locator(".lab-canvas");
  const box = await canvas.boundingBox();
  assert.ok(box);
  await lab.mouse.move(box.x + 80, box.y + 100);
  await lab.mouse.down();
  await lab.mouse.move(box.x + 100, box.y + 200, { steps: 4 });
  await lab.mouse.up();
  const note = lab.getByPlaceholder(
    "What do you hear? What should the chart do here?",
  );
  await note.fill("The chart needs a stronger beat here.");
  await note.press("Enter");
  assert.match(await lab.locator(".lab-notes").innerText(), /stronger beat/);
  await lab.locator(".lab-notes li").click();
  await lab.locator('.lab-notes button[title="Delete this note"]').click();
  assert.equal(await lab.locator(".lab-notes li").count(), 0);
  await lab.locator('input[title^="Record mode"]').check();
  assert.equal(
    await lab
      .locator("body")
      .evaluate((body) => body.classList.contains("lab-recording")),
    true,
  );
  await lab.locator('input[title^="Record mode"]').uncheck();
  const chartToggle = lab.locator('.lab-chips input[type="checkbox"]').first();
  const wasChecked = await chartToggle.isChecked();
  await chartToggle.setChecked(!wasChecked);
  assert.equal(await chartToggle.isChecked(), !wasChecked);
  await chartToggle.setChecked(wasChecked);
  await lab
    .locator('input[title="Click a lane to add or remove a tap"]')
    .check();
  await canvas.click({ position: { x: 80, y: 150 } });
  await lab.getByRole("button", { name: "Reset edits" }).click();
  assert.equal(
    await lab.evaluate(
      (id) => localStorage.getItem(`fusemania-lab:edits:${id}`),
      song,
    ),
    null,
  );
  await lab
    .locator('select[title="Playback speed (the pitch drops with it)"]')
    .selectOption("0.5");
  await finishLab();
} finally {
  await browser.close();
}
