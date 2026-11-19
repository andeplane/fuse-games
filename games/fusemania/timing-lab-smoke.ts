import assert from "node:assert/strict";
import { launchSelected } from "../../scripts/lib/browser.js";
import { startGameCoverage } from "../../scripts/lib/game-browser-coverage.js";
import { smokeTimeout } from "../../scripts/smoke-timeout.js";
import type { TimingScreen } from "./src/app/timing-screen.js";

interface TimingWindow extends Window {
  fusemania?: {
    timing: TimingScreen["snapshot"];
    timingState: TimingScreen["state"];
  };
}

const base = process.env.ONLINE_URL;
if (!base) throw new Error("Run the timing smoke against a served Fuse Mania");
const url = new URL(
  "fusemania/?timing&mute&debugtiming&seconds=7&rate=180",
  base,
);
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(smokeTimeout(15_000));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const finishCoverage = await startGameCoverage(page, { gameId: "fusemania" });
  await page.goto(url.href);
  const start = page.getByRole("button", { name: /check the picture by eye/i });
  await start.waitFor();
  assert.equal(
    await page.getByRole("button", { name: /start by ear/i }).isVisible(),
    false,
  );
  await start.click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await start.click();

  const run = await page.evaluate(() =>
    (window as TimingWindow).fusemania!.timingState(),
  );
  assert.equal(run.kind, "eye");
  // The app is muted and uses the page clock. Send ordinary key presses
  // consistently late, allowing a whole frame and keyboard dispatch jitter.
  const beat = 60_000 / run.bpm;
  for (let tick = run.countIn; tick < run.countIn + run.ticks; tick++) {
    await page.waitForFunction(
      (due) => {
        const heard = (window as TimingWindow).fusemania?.timingState().heardMs;
        return heard !== undefined && heard >= due;
      },
      tick * beat + 30,
    );
    await page.keyboard.press("ArrowUp");
  }
  const apply = page.getByRole("button", { name: "Apply", exact: true });
  await apply.waitFor();
  const result = await page.evaluate(() =>
    (window as TimingWindow).fusemania!.timingState(),
  );
  const expected = result.advice?.apply?.visualMs;
  assert.ok(
    expected && expected >= 20 && expected < 100,
    "late taps propose a positive visual offset",
  );
  await apply.click();
  assert.match(
    await page.locator(".fm-ts-measured").innerText(),
    /Visual offset set/,
  );
  await page.reload();
  await start.waitFor();
  const saved = await page.evaluate(
    () => (window as TimingWindow).fusemania!.timing().offsets.visualMs,
  );
  assert.equal(
    saved,
    expected,
    "applying calibration persists the suggested offset",
  );
  assert.deepEqual(errors, []);
  await finishCoverage();
  console.log(
    "Muted timing controls stop, record taps, apply advice and restore the visual offset.",
  );
} finally {
  await browser.close();
}
