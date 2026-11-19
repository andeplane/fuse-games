/** Run against the local Fuse service. Host, guest and TV use separate browser profiles. */
import assert from "node:assert/strict";
import { launchSelected } from "./lib/browser.js";
import { takeHostSeat } from "./lib/main-menu.js";
import { startRoomService } from "./lib/server.js";

const service = process.env.ONLINE_URL ? undefined : await startRoomService();
const url = new URL(
  "incrediblefuse/?mute",
  process.env.ONLINE_URL ?? service!.url,
);
const browser = await launchSelected("chromium", {
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
  const errors: string[] = [];
  for (const page of [host, guest, tv]) {
    page.setDefaultTimeout(12_000);
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
  const bounds = await board.boundingBox();
  assert.ok(bounds);
  await board.tap({
    position: { x: (bounds.width * 2) / 640, y: (bounds.height * 60) / 400 },
  });
  assert.match(await feedback.innerText(), /whole part inside/);
  assert.equal(await incline.getAttribute("aria-pressed"), "true");
  for (let i = 0; i < 20; i++) await board.press("ArrowRight");
  await board.press("Enter");
  assert.match(await feedback.innerText(), /Another part is centered here/);
  assert.equal(await incline.getAttribute("aria-pressed"), "true");
  await board.tap({
    position: { x: (bounds.width * 160) / 640, y: (bounds.height * 140) / 400 },
  });
  await host
    .locator(".if-bench-tools button:enabled")
    .filter({ hasText: "Undo" })
    .waitFor();
  await board.tap({
    position: { x: (bounds.width * 160) / 640, y: (bounds.height * 140) / 400 },
  });
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
  await host.getByRole("button", { name: "Run machine", exact: true }).click();
  for (const page of [host, guest, tv])
    await page.locator('main[data-phase="over"]').waitFor();
  for (const page of [host, guest, tv]) {
    await page.locator('.if-bench[data-mode="solved"]:visible').waitFor();
    await page.getByRole("dialog", { name: "Puzzle complete" }).waitFor();
  }
  await host.keyboard.press("Escape");
  await guest.getByRole("button", { name: /View machine/ }).tap();
  await guest.getByRole("button", { name: /View result/ }).tap();
  await host.getByRole("button", { name: /View result/ }).click();
  await host.locator('.fui-results button[data-action="replay"]').click();
  for (const page of [host, guest, tv])
    await page.locator('main[data-phase="running"]').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Host, touch guest and TV shared a solve, recovered the edit after reload and replayed.",
  );
} finally {
  await browser.close();
  await service?.stop();
}
