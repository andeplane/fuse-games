/** Verify the real room transport. Set FUSEHEADS_URL to run against a development server. */
import assert from "node:assert/strict";
import { launchSelected } from "./lib/browser.js";
import { startRoomService } from "./lib/server.js";
import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
import type { Page } from "playwright";

const server = process.env.FUSEHEADS_URL ? undefined : await startRoomService();
const root = new URL("fuseheads/", process.env.FUSEHEADS_URL ?? server!.url);
const browser = await launchSelected("chromium");
const problems: string[] = [];
const pageFor = async (touch = false) => {
  const context = await browser.newContext(
    touch
      ? {
          viewport: { width: 360, height: 800 },
          hasTouch: true,
          isMobile: true,
        }
      : { viewport: { width: 1440, height: 900 } },
  );
  const page = await context.newPage();
  page.on("pageerror", (err) => problems.push(err.message));
  return page;
};
const playfield = (page: Page) =>
  page.locator('.fuseheads-arena[data-ready="true"]');
const enter = async (page: Page) => {
  await page.goto(new URL("?mute", root).href);
};
try {
  const solo = await pageFor(true);
  await enter(solo);
  await solo.getByRole("button", { name: /^how to play$/i }).click();
  assert.match(await solo.locator("dialog[open]").innerText(), /stun|bump/i);
  await solo.keyboard.press("Escape");
  await openPlayOptions(solo, "single");
  await solo
    .getByRole("combobox", { name: "Level pack" })
    .selectOption("bonus");
  await solo.getByRole("button", { name: "START GAME", exact: true }).click();
  await playfield(solo).waitFor();
  await solo.getByRole("button", { name: "Jump", exact: true }).tap();
  const canvasBox = await playfield(solo).boundingBox();
  const barBox = await solo.locator(".fui-top-bar").boundingBox();
  assert.ok(barBox && canvasBox && canvasBox.y >= barBox.y + barBox.height);
  assert.ok((await solo.locator("body").boundingBox())!.width <= 360);
  await solo.setViewportSize({ width: 844, height: 390 });
  await solo.getByRole("button", { name: "Right", exact: true }).tap();
  await solo
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await solo.keyboard.press("Escape");
  await solo.context().close();
  const host = await pageFor();
  await enter(host);
  await openPlayOptions(host);
  await host.getByRole("button", { name: /^host room$/i }).click();
  await takeHostSeat(host, "Grag");
  const start = host.getByRole("button", { name: /^start match$/i });
  await start.waitFor();
  await start.click();
  await playfield(host).waitFor();
  await host.getByRole("button", { name: /^open game menu$/i }).click();
  await host.getByRole("button", { name: /^game controls$/i }).click();
  await host.getByRole("button", { name: /^back to lobby$/i }).click();
  await start.waitFor();
  const room = new URL(host.url());
  const guest = await pageFor(true);
  await guest.goto(room.href);
  await takeHostSeat(guest, "Thog");
  await host.getByText("Thog", { exact: true }).first().waitFor();
  const tv = await pageFor();
  room.searchParams.set("display", "1");
  await tv.goto(room.href);
  await host.locator('.fuseheads-tv-option input[type="checkbox"]').check();
  await start.click();
  await playfield(tv).waitFor();
  await guest
    .locator('.fuseheads-room[data-controller="true"] .fuseheads-pad')
    .waitFor();
  await guest.getByRole("button", { name: "Jump", exact: true }).tap();
  await guest.reload();
  await guest
    .locator('.fuseheads-room[data-controller="true"] .fuseheads-pad')
    .waitFor();
  assert.equal(await tv.locator(".fuseheads-pad").isVisible(), false);
  assert.deepEqual(problems, []);
  console.log(
    "Passed solo bonus, touch, Help/Back, landscape, one-seat room, host, guest, shared TV and guest reload.",
  );
} finally {
  await browser.close();
  await server?.stop();
}
