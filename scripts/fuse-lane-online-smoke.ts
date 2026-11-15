import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { startRoomService } from "./lib/server.js";

// Uses the real menu, room service and WebRTC transport. Build before running.
const service = await startRoomService({
  logFile: "artifacts/fuse-lane-online-service.log",
});
const browser = await chromium.launch();
const errors: string[] = [];
await mkdir("artifacts", { recursive: true });
async function page(phone = false): Promise<Page> {
  const context = await browser.newContext({
    viewport: phone
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  });
  const result = await context.newPage();
  result.on("pageerror", (error) => errors.push(error.message));
  return result;
}
/** Hosts a room from the menu. `shared` ticks Shared TV in the room and leaves the host without a seat: the TV. */
async function create(host: Page, shared: boolean): Promise<string> {
  await host.goto(`${service.url}fuse-lane/?mute`);
  await openPlayOptions(host);
  assert.equal(
    await host.getByRole("button", { name: "SHARED TV", exact: true }).count(),
    0,
    "the menu has no hosting options: Shared TV is the room's",
  );
  await host.getByRole("button", { name: "Host room", exact: true }).click();
  await host.waitForURL(/[?&]room=/);
  const code = new URL(host.url()).searchParams.get("room")!;
  // The code is said once in the room, by the QR code.
  await host
    .locator(".fl-lobby .fui-room-code")
    .filter({ hasText: code })
    .waitFor();
  assert.equal(
    await host.getByText(code, { exact: true }).count(),
    1,
    "the room code is shown once",
  );
  if (shared) {
    await host.locator(".fl-shared-tv input").check();
    await host.locator(".fl-shared-tv .fui-room-tv-screen").waitFor();
  } else await takeHostSeat(host, "Host");
  return code;
}
async function join(phone: Page, code: string, name: string): Promise<void> {
  await phone.goto(`${service.url}fuse-lane/?room=${code}&mute`);
  await takeHostSeat(phone, name);
  await phone.locator(".fui-roster-name").filter({ hasText: name }).waitFor();
}
async function running(target: Page, layout: string): Promise<void> {
  await target
    .locator(
      `.fl-room[data-phase="running"][data-part="week"][data-layout="${layout}"]`,
    )
    .waitFor();
}
try {
  const host = await page();
  const guest = await page(true);
  const code = await create(host, false);
  await join(guest, code, "Guest");
  await host.getByRole("button", { name: "START MATCH", exact: true }).click();
  await running(host, "board");
  await running(guest, "board");
  // The match fills the screen: the app's bar is away, and the room's line stays quiet while all is well.
  await host.locator(".fl-top").waitFor({ state: "hidden" });
  assert.equal(await host.locator(".fl-status").isVisible(), false);
  await guest.getByRole("button", { name: "MENU", exact: true }).click();
  await guest.getByRole("button", { name: "CONTROLS", exact: true }).click();
  await guest.locator(".fui-game-menu-controls .fui-controls-list").waitFor();
  await guest.keyboard.press("Escape");
  await guest.locator(".fui-game-menu-panel").waitFor({ state: "hidden" });
  await host
    .getByRole("button", { name: "CALL IT A WEEK", exact: true })
    .click();
  await host.locator(".fl-waiting").waitFor();
  assert.match(await host.locator(".fl-waiting").innerText(), /Guest/);
  await guest
    .getByRole("button", { name: "CALL IT A WEEK", exact: true })
    .click();
  await host.locator('.fl-room[data-week="2"]').waitFor();
  await guest.locator('.fl-room[data-week="2"]').waitFor();
  await host.screenshot({ path: "artifacts/fuse-lane-devices.png" });
  await host.context().close();
  await guest.context().close();

  const tv = await page();
  const first = await page(true);
  const second = await page(true);
  const sharedCode = await create(tv, true);
  await join(first, sharedCode, "First");
  await join(second, sharedCode, "Second");
  await tv.locator(".fui-roster-name").filter({ hasText: "Second" }).waitFor();
  assert.equal(
    await tv.locator(".fui-roster-name").count(),
    2,
    "the TV holds no seat",
  );
  await tv.getByRole("button", { name: "START MATCH", exact: true }).click();
  await running(tv, "tv");
  await running(first, "controller");
  await running(second, "controller");
  await tv.getByRole("button", { name: "MENU", exact: true }).click();
  await tv.getByRole("button", { name: "CONTROLS", exact: true }).click();
  await tv
    .getByText(
      "Shared screen: watch here. Players use their own phones or devices.",
    )
    .waitFor();
  await tv.locator(".fui-game-menu-controls .fui-controls-list").waitFor();
  await tv.keyboard.press("Escape");
  await first.getByRole("button", { name: "FreshCo", exact: true }).click();
  await first.locator(".fl-panel:not([hidden])").waitFor();
  await first
    .locator(".fl-panel:not([hidden]) .fl-card:not([disabled])")
    .first()
    .waitFor();
  await first.reload();
  await running(first, "controller");
  await first.locator(".fl-panel:not([hidden])").waitFor();
  await first
    .locator(".fl-panel:not([hidden]) .fl-card:not([disabled])")
    .first()
    .waitFor();
  await first
    .locator(".fl-panel:not([hidden])")
    .screenshot({ path: "artifacts/fuse-lane-rejoined-phone.png" });
  await tv.screenshot({ path: "artifacts/fuse-lane-shared-tv.png" });
  await second
    .getByRole("button", { name: "CALL IT A WEEK", exact: true })
    .click();
  await first.locator(".fl-panel:not([hidden]) .fl-close").click();
  await first
    .getByRole("button", { name: "CALL IT A WEEK", exact: true })
    .click();
  await tv.locator('.fl-room[data-week="2"]').waitFor();
  await tv.getByText("GET READY · PHONE CONTROLS", { exact: true }).waitFor();
  assert.deepEqual(errors, [], "no browser exceptions");
  console.log(
    "Chromium: device room to week 2; shared TV + two phone viewports; shop refresh recovers mid-week; shared week 2; no page errors",
  );
} finally {
  await browser.close();
  await service.stop();
}
