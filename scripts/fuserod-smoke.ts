import assert from "node:assert/strict";
import { launchSelected } from "./lib/browser.js";
import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
import { startRoomService } from "./lib/server.js";
import type { Page } from "playwright";
const server = process.env.FUSEROD_URL ? undefined : await startRoomService();
const url = new URL(
  "fuserod/?mute",
  (process.env.FUSEROD_URL ?? server!.url).replace(/\/?$/, "/"),
);
const browser = await launchSelected("chromium");
const errors: string[] = [];
const pages: Page[] = [];
async function page(width: number, height: number, touch = false) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: touch,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  pages.push(page);
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
async function ready(p: Page) {
  await p.locator('.rod-main[data-phase="running"]').waitFor();
}
async function drive(p: Page) {
  await p.keyboard.press("x");
  await p.keyboard.down("w");
  await p.waitForFunction(
    () =>
      parseInt(
        document.querySelectorAll(".rod-dash b")[1]?.textContent ?? "0",
      ) > 5,
  );
  await p.keyboard.up("w");
}
try {
  const solo = await page(360, 800, true);
  await solo.goto(url.href);
  await solo.getByRole("button", { name: /^how to play$/i }).click();
  await solo.getByRole("heading", { name: "Touch controls" }).waitFor();
  await solo.keyboard.press("Escape");
  await openPlayOptions(solo, "single");
  await solo.locator('[data-garage-key="kestrel"]').click();
  await solo.getByRole("button", { name: "Workshop", exact: true }).click();
  await solo.locator('[data-garage-key="engine"]').click();
  await solo.getByRole("button", { name: "Challenge", exact: true }).click();
  await solo.locator('[data-garage-key="race"]').click();
  await ready(solo);
  await solo.goBack();
  await solo.locator('[data-garage-key="resume"]').click();
  await ready(solo);
  await drive(solo);
  await solo.setViewportSize({ width: 844, height: 390 });
  assert(await solo.locator(".rod-pad").isVisible());
  await solo
    .locator('.fui-results button[data-action="garage"]')
    .click({ timeout: 90000 });
  await solo.getByRole("region", { name: "Campaign garage" }).waitFor();
  await solo.context().close();
  console.log(
    "Solo garage purchase, engine upgrade, driving, results and settlement passed.",
  );
  const host = await page(1440, 900);
  await host.goto(url.href);
  await openPlayOptions(host);
  await host.getByRole("button", { name: /^host room$/i }).click();
  await host.waitForURL(/room=[A-Z0-9]+/);
  const start = host.getByRole("button", { name: /^start race$/i });
  await host
    .getByRole("button", { name: "Add AI", exact: true })
    .first()
    .click();
  await host.getByRole("button", { name: "Room settings" }).click();
  await host
    .getByLabel("Race event", { exact: true })
    .selectOption("timed-strip");
  await host.keyboard.press("Escape");
  await start.and(host.locator(":disabled")).waitFor();
  await host.getByRole("button", { name: "Room settings" }).click();
  await host
    .getByLabel("Race event", { exact: true })
    .selectOption("street-strip");
  await host.keyboard.press("Escape");
  await host.getByRole("button", { name: "Remove bot" }).click();
  await takeHostSeat(host, "Driver One");
  await start.click();
  await ready(host);
  await drive(host);
  await host.getByRole("button", { name: "Open game menu" }).click();
  await host.getByRole("button", { name: /^game controls$/i }).click();
  await host
    .getByRole("button", { name: /back to lobby|return to lobby/i })
    .click();
  await start.waitFor();
  const guest = await page(360, 800, true);
  await guest.goto(host.url());
  await takeHostSeat(guest, "Driver Two");
  const tv = await page(844, 390);
  await tv.goto(host.url() + "&display=1");
  await start.click();
  await Promise.all([ready(host), ready(guest), ready(tv)]);
  assert(!(await tv.locator(".rod-pad").isVisible()));
  await Promise.all([drive(host), drive(guest)]);
  await guest.reload();
  await ready(guest);
  await host.getByRole("button", { name: "Gear +", exact: true }).click();
  await host.keyboard.down("w");
  await host.keyboard.press("x");
  await host
    .locator('.fui-results button[data-action="retry"]')
    .waitFor({ timeout: 250000 });
  await host.keyboard.up("w");
  for (const p of [guest, tv])
    await p.locator(".fui-results-report:visible").waitFor();
  await host.locator('.fui-results button[data-action="retry"]').click();
  await Promise.all([ready(host), ready(guest), ready(tv)]);
  assert.deepEqual(errors, []);
  console.log(
    "Single-seat room, host, guest, TV, recovery and rematch passed.",
  );
} catch (error) {
  for (const page of pages.filter((p) => !p.isClosed()))
    console.error(
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
      await page.locator(".fui-results-actions").allTextContents(),
      errors,
    );
  throw error;
} finally {
  await browser.close();
  await server?.stop();
}
