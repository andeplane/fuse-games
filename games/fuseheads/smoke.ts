/** Verify the real room transport. Set FUSEHEADS_URL to run against a development server. */
import assert from "node:assert/strict";
import { launchSelected } from "../../scripts/lib/browser.js";
import { startGameCoverage } from "../../scripts/lib/game-browser-coverage.js";
import { startRoomService } from "../../scripts/lib/server.js";
import { openPlayOptions, takeHostSeat } from "../../scripts/lib/main-menu.js";
import { openTopMenu } from "../../scripts/lib/top-menu.js";
import type { Page } from "playwright";

const serverUrl = process.env.FUSEHEADS_URL ?? process.env.ONLINE_URL;
const server = serverUrl ? undefined : await startRoomService();
const root = new URL("fuseheads/", serverUrl ?? server!.url);
const browser = await launchSelected(
  process.env.FUSE_GAME_COVERAGE_DIR ? "chrome" : "chromium",
);
const problems: string[] = [];
const coverage = new Map<Page, () => Promise<void>>();
const portrait = { width: 360, height: 800 };
const landscape = { width: 844, height: 390 };
const pageFor = async (touchViewport?: typeof portrait) => {
  const context = await browser.newContext(
    touchViewport
      ? {
          viewport: touchViewport,
          hasTouch: true,
          isMobile: true,
        }
      : { viewport: { width: 1440, height: 900 } },
  );
  const page = await context.newPage();
  page.on("pageerror", (err) => problems.push(err.message));
  coverage.set(page, await startGameCoverage(page, { gameId: "fuseheads" }));
  return page;
};
async function closePage(page: Page) {
  await coverage.get(page)?.();
  coverage.delete(page);
  await page.context().close();
}
const playfield = (page: Page) =>
  page.locator('.fuseheads-arena[data-ready="true"]');
async function checkTouchOverlay(page: Page) {
  const arena = await playfield(page).boundingBox();
  const stage = page.locator(".fuseheads-play.fui-play-stage");
  const bounds = await stage.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(arena);
  assert.ok(bounds && viewport);
  assert.deepEqual(bounds, { x: 0, y: 0, ...viewport });
  const turned = viewport.height > viewport.width;
  assert.deepEqual(arena, bounds);
  const backing = await playfield(page).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const { width, height } = canvas;
    const boardLeft = (width - (height * 4) / 3) / 2;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, width, 1).data;
    // The top scenery continues at each side at the board's proportions, with a dark tint.
    const samples = Array.from({ length: 12 }, (_, i) =>
      Math.round(boardLeft - 4 - i * 3),
    );
    const matches = samples.filter((x) => {
      const reflected = Math.floor(2 * boardLeft - x - 1);
      return [5, 9, 17].every((tint, c) => {
        const from = pixels[reflected * 4 + c]!;
        const to = pixels[x * 4 + c]!;
        return Math.abs(to - (from * 0.52 + tint * 0.48)) <= 4;
      });
    }).length;
    return { width, height, matches };
  });
  assert.deepEqual(
    [backing.width, backing.height],
    turned
      ? [viewport.height, viewport.width]
      : [viewport.width, viewport.height],
  );
  assert.ok(backing.matches >= 9, "the side scenery mirrors the board edge");
  assert.equal(
    await page.locator("html").getAttribute("data-fui-play"),
    turned ? "turned" : "phone",
  );
  const shortSide = Math.min(viewport.width, viewport.height);
  const longSide = Math.max(viewport.width, viewport.height);
  const boardWidth = (shortSide * 4) / 3;
  const hudLeft = (longSide - boardWidth) / 2;
  const hudTop = shortSide * (416 / 480);
  for (const name of ["Left", "Right", "Jump"]) {
    const control = await page
      .getByRole("button", { name, exact: true })
      .boundingBox();
    assert.ok(control && control.width >= 44 && control.height >= 44);
    assert.ok(control.x >= 0 && control.y >= 0);
    assert.ok(control.x + control.width <= viewport.width);
    assert.ok(control.y + control.height <= viewport.height);
    const left = turned ? control.y : control.x;
    const right = left + (turned ? control.height : control.width);
    const bottom = turned
      ? viewport.width - control.x
      : control.y + control.height;
    assert.ok(
      right <= hudLeft || left >= hudLeft + boardWidth || bottom <= hudTop,
      name + " leaves the score and lives visible",
    );
  }
}
const enter = async (page: Page) => {
  await page.goto(new URL("?mute", root).href);
};
async function startSolo(page: Page) {
  await openPlayOptions(page, "single");
  const pack = page.getByRole("combobox", { name: "Level pack" });
  await pack.press("ArrowDown");
  assert.equal(await pack.inputValue(), "bonus");
  await page.getByRole("button", { name: "START GAME", exact: true }).click();
  await playfield(page).waitFor();
}
async function downArrowConsumed(page: Page) {
  await page.evaluate(() => {
    window.addEventListener(
      "keydown",
      (event) => {
        queueMicrotask(() => {
          document.body.dataset.downArrowConsumed = String(
            event.defaultPrevented,
          );
        });
      },
      { once: true },
    );
  });
  await page.keyboard.press("ArrowDown");
  return page.locator("body").getAttribute("data-down-arrow-consumed");
}
try {
  const solo = await pageFor(portrait);
  await enter(solo);
  await solo.getByRole("button", { name: /^how to play$/i }).click();
  assert.match(await solo.locator("dialog[open]").innerText(), /stun|bump/i);
  await solo.keyboard.press("Escape");
  await startSolo(solo);
  assert.equal(await downArrowConsumed(solo), "true");
  await checkTouchOverlay(solo);
  await solo.getByRole("button", { name: "Jump", exact: true }).tap();
  await openTopMenu(solo);
  await solo
    .locator(".fui-top-bar-menu[open]")
    .getByRole("button", { name: "Back", exact: true })
    .tap({ trial: true });
  await solo.keyboard.press("Escape");
  await solo.locator(".fui-top-bar-menu").waitFor({ state: "hidden" });
  assert.ok(
    (await solo.locator("body").boundingBox())!.width <= portrait.width,
  );
  await closePage(solo);
  // Start at the target viewport because Chromium cannot resize a fullscreen window.
  const wideSolo = await pageFor(landscape);
  await enter(wideSolo);
  await startSolo(wideSolo);
  await checkTouchOverlay(wideSolo);
  await wideSolo.getByRole("button", { name: "Right", exact: true }).tap();
  await openTopMenu(wideSolo);
  await wideSolo.keyboard.press("Escape");
  await closePage(wideSolo);
  const host = await pageFor();
  await enter(host);
  await openPlayOptions(host);
  await host.getByRole("button", { name: /^host room$/i }).click();
  await takeHostSeat(host, "Grag");
  const start = host.getByRole("button", { name: /^start match$/i });
  await start.waitFor();
  await start.click();
  await playfield(host).waitFor();
  assert.equal(await host.locator("html").getAttribute("data-fui-play"), null);
  await openTopMenu(host);
  await host.getByRole("button", { name: /^back to lobby$/i }).click();
  await start.waitFor();
  const room = new URL(host.url());
  const guest = await pageFor(portrait);
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
  assert.equal(await guest.locator("html").getAttribute("data-fui-play"), null);
  assert.deepEqual(problems, []);
  await Promise.all([...coverage.values()].map((finish) => finish()));
  console.log(
    "Passed solo bonus, touch, Help/Back, landscape, one-seat room, host, guest, shared TV and guest reload.",
  );
} finally {
  await browser.close();
  await server?.stop();
}
