/** Run against the local Fuse service. Host, guest and TV use separate browser profiles. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Page } from "playwright";
import {
  FREE_WORKSHOP,
  PART_KINDS,
} from "../games/incredible-fuse/src/game/machine-parts.js";
import { launchSelected } from "./lib/browser.js";
import { startGameCoverage } from "./lib/game-browser-coverage.js";
import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
import { workbenchScreenPoint } from "./lib/play-recipes.js";
import { startRoomService } from "./lib/server.js";
import { smokeTimeout } from "./smoke-timeout.js";

async function tapBoard(page: Page, x: number, y: number) {
  const point = await workbenchScreenPoint(page, x, y);
  await page.touchscreen.tap(point.x, point.y);
}

async function savedWorkshop(page: Page, url: URL) {
  await page.goto(url.href);
  await openPlayOptions(page, "single");
  await page
    .getByLabel("Puzzle", { exact: true })
    .selectOption(String(FREE_WORKSHOP));
  await page
    .getByRole("button", { name: "Open workshop", exact: true })
    .click();
  const board = page.getByRole("group", { name: "Machine workbench" });
  await board.waitFor();
  const icons = page.locator(".if-bench-part canvas");
  assert.equal(await icons.count(), PART_KINDS.length);
  const missing = await icons.evaluateAll((canvases) =>
    canvases.flatMap((element) => {
      if (!(element instanceof HTMLCanvasElement)) return ["Missing canvas"];
      const image = element
        .getContext("2d")
        ?.getImageData(0, 0, element.width, element.height);
      return image?.data.some((alpha, i) => i % 4 === 3 && alpha > 0)
        ? []
        : [element.parentElement?.getAttribute("aria-label")];
    }),
  );
  assert.deepEqual(missing, [], "all stocked parts have a visible tray icon");
  await page.getByRole("button", { name: "Incline", exact: true }).click();
  await board.press("Enter");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.and(page.locator(":enabled")).waitFor();
  await board.press("ArrowRight");
  await board.press("Enter");
  await board.press("f");
  await board.press("Delete");
  await undo.click();
  const run = page.getByRole("button", { name: "Run machine", exact: true });
  await run.click();
  await page.getByRole("button", { name: "Rewind", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save machine", exact: true }).click();
  const download = await downloaded;
  const file = await download.path();
  assert.ok(file, "the saved machine is downloadable");
  const buffer = await readFile(file);

  await page.goto(url.href);
  await openPlayOptions(page, "single");
  await page.getByText("Open a saved machine", { exact: true }).click();
  await page.locator('.machine-import input[type="file"]').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/json",
    buffer,
  });
  await page.getByText("1 parts loaded.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Open workbench", exact: true })
    .click();
  await board.waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Save machine", exact: true })
      .isVisible(),
    true,
  );
}

const service = process.env.ONLINE_URL ? undefined : await startRoomService();
const url = new URL(
  "incrediblefuse/?mute",
  process.env.ONLINE_URL ?? service!.url,
);
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
try {
  const host = await browser.newPage();
  const guest = await browser.newPage({
    viewport: { width: 360, height: 800 },
    hasTouch: true,
  });
  const tv = await browser.newPage();
  const coverage = await Promise.all(
    [host, guest, tv].map((page) =>
      startGameCoverage(page, { gameId: "incredible-fuse" }),
    ),
  );
  const errors: string[] = [];
  for (const page of [host, guest, tv]) {
    page.setDefaultTimeout(smokeTimeout(12_000));
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
  }
  await host.goto(url.href);
  await host.getByRole("button", { name: "Play", exact: true }).click();
  await host.getByRole("button", { name: "Host room", exact: true }).click();
  await host.waitForURL((where) => where.searchParams.has("room"));
  await takeHostSeat(host, "Aster");
  await host.getByRole("checkbox", { name: /Shared TV/i }).check();
  const invite = new URL(host.url());
  invite.searchParams.set("mute", "");
  await guest.goto(invite.href);
  await takeHostSeat(guest, "Birch");
  invite.searchParams.set("display", "1");
  await tv.goto(invite.href);
  await host.getByRole("heading", { name: "Players 2 / 5" }).waitFor();
  await host.getByRole("button", { name: "Start puzzle", exact: true }).click();
  for (const page of [host, guest, tv])
    await page.locator(".if-bench-board:visible").waitFor();
  assert.equal(
    await tv.getByRole("button", { name: "Run machine" }).count(),
    0,
  );
  const incline = guest.getByRole("button", { name: "Incline", exact: true });
  await incline.click();
  const feedback = guest.locator(".if-bench-feedback");
  assert.match(await feedback.innerText(), /Flip to reverse the slope/);
  const board = guest.locator(".if-bench-board");
  await tapBoard(guest, 2, 60);
  assert.match(await feedback.innerText(), /whole part inside/);
  assert.equal(await incline.getAttribute("aria-pressed"), "true");
  for (let i = 0; i < 20; i++) await board.press("ArrowRight");
  await board.press("Enter");
  assert.match(await feedback.innerText(), /Another part is centered here/);
  assert.equal(await incline.getAttribute("aria-pressed"), "true");
  await tapBoard(guest, 160, 140);
  await host
    .locator(".if-bench-tools button:enabled")
    .filter({ hasText: "Undo" })
    .waitFor();
  await tapBoard(guest, 160, 140);
  for (let i = 0; i < 10; i++) await board.press("ArrowUp");
  await board.press("Enter");
  assert.match(await feedback.innerText(), /Another part is centered here/);
  assert.equal(
    await guest.getByRole("button", { name: "Flip", exact: true }).isEnabled(),
    true,
  );
  await guest.reload();
  await guest
    .locator(".if-bench-tools button:enabled")
    .filter({ hasText: "Undo" })
    .waitFor();
  // The basket is centered at (306, 288), with a 49-unit halo. A sprite-sized
  // fill used to cut it off at 38 units above and below the center.
  const basketHalo = () =>
    host
      .locator("canvas.if-bench-board")
      .evaluate((canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext("2d")!;
        return [-42, 42].map(
          (offset) =>
            ctx.getImageData(
              Math.floor((306 * canvas.width) / 640),
              Math.floor(((288 + offset) * canvas.height) / 400),
              1,
              1,
            ).data[1]!,
        );
      });
  const unlit = await basketHalo();
  await host.getByRole("button", { name: "Run machine", exact: true }).click();
  for (const page of [host, guest, tv])
    await page.locator('main[data-phase="over"]').waitFor();
  for (const page of [host, guest, tv]) {
    await page.locator('.if-bench[data-mode="solved"]:visible').waitFor();
    await page.getByRole("dialog", { name: "Puzzle complete" }).waitFor();
  }
  await host.keyboard.press("Escape");
  const lit = await basketHalo();
  assert.ok(
    lit.every((green, i) => green > unlit[i]! + 2),
    "the solved basket glows beyond both former clipping edges",
  );
  await guest.getByRole("button", { name: /View machine/ }).tap();
  await guest.getByRole("button", { name: /View result/ }).tap();
  await host.getByRole("button", { name: /View result/ }).click();
  await host.locator('.fui-results button[data-action="replay"]').click();
  for (const page of [host, guest, tv])
    await page.locator('main[data-phase="running"]').waitFor();
  await savedWorkshop(host, url);
  assert.deepEqual(errors, []);
  await Promise.all(coverage.map((finish) => finish()));
  console.log(
    "Host, touch guest and TV shared a solve, recovered the edit after reload and replayed. The solo workshop rendered its parts, edited a machine and reopened its saved blueprint.",
  );
} finally {
  await browser.close();
  await service?.stop();
}
