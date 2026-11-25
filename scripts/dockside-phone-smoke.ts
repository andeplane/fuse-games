/** Run against the built app to check Dockside's camera, controls and Shared TV on real room paths. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { launchSelected } from "./lib/browser.js";
import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
import { startRoomService } from "./lib/server.js";
import { openTopMenu, closeTopMenu } from "./lib/top-menu.js";

const service = await startRoomService();
const browser = await launchSelected("chromium", {
  headless: true,
  args: ["--mute-audio"],
});
const home = new URL("dockside/?mute", service.url);
const arena = 'canvas[aria-label="Canal Lock arena"]';
const pad = ".dockside-controls";
const shots = process.env.DOCKSIDE_SMOKE_SHOTS;
const portrait = { width: 360, height: 800 };
const landscape = { width: 844, height: 390 };
const desktop = { width: 1440, height: 900 };
const pageErrors: string[] = [];

async function device(
  viewport: { width: number; height: number },
  phone: boolean,
) {
  const page = await browser.newPage({
    viewport,
    hasTouch: phone,
    isMobile: phone,
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return page;
}

async function screenshot(page: Page, name: string) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: join(shots, name + ".png") });
}

async function singlePlayer(page: Page) {
  await page.goto(home.href);
  await openPlayOptions(page, "single");
  await page.locator(arena).waitFor();
}

async function arenaLayout(page: Page, identity: string) {
  await page.locator(arena).waitFor();
  await page
    .locator(".dockside-hud")
    .getByText(identity, { exact: true })
    .waitFor();
  await page.locator(".fui-round-controls").waitFor({ state: "hidden" });
  const layout = await page.evaluate(
    ({ arena, pad }) => {
      const canvas = document.querySelector(arena)!;
      const controls = document.querySelector(pad)!;
      const hud = document.querySelector(".dockside-hud")!;
      const bounds = canvas.getBoundingClientRect();
      const hudBounds = hud.getBoundingClientRect();
      return {
        wholeScreen:
          bounds.left === 0 &&
          bounds.top === 0 &&
          bounds.width === innerWidth &&
          bounds.height === innerHeight,
        fits: document.documentElement.scrollHeight === innerHeight,
        overlay: controls.parentElement === canvas.parentElement,
        hudFits:
          hudBounds.left >= 0 &&
          hudBounds.top >= 0 &&
          hudBounds.right <= innerWidth &&
          hudBounds.bottom <= innerHeight,
        targets: Array.from(controls.querySelectorAll("button"), (button) => {
          const { width, height, left, right, top, bottom } =
            button.getBoundingClientRect();
          return {
            action: button.getAttribute("aria-label"),
            large: width >= 44 && height >= 44,
            inside:
              left >= bounds.left &&
              right <= bounds.right &&
              top >= bounds.top &&
              bottom <= bounds.bottom,
            unobstructed: button.contains(
              document.elementFromPoint(left + width / 2, top + height / 2),
            ),
          };
        }),
      };
    },
    { arena, pad },
  );
  assert.ok(
    layout.wholeScreen && layout.fits && layout.overlay && layout.hudFits,
    JSON.stringify(layout),
  );
  assert.equal(layout.targets.length, 15);
  assert.deepEqual(
    layout.targets.filter(
      (target) => !target.large || !target.inside || !target.unobstructed,
    ),
    [],
  );
}

async function transform(page: Page, touch: boolean) {
  const hud = page.locator(".dockside-hud");
  await hud.getByText(/Walker/).waitFor();
  if (touch)
    await page.getByRole("button", { name: "Transform chassis" }).tap();
  else await page.keyboard.press("Shift");
  await hud.getByText(/Travel/).waitFor();
}

async function room(shared: boolean) {
  const host = await device(portrait, true);
  const guest = await device(landscape, true);
  await host.goto(home.href);
  await openPlayOptions(host);
  await host.getByRole("button", { name: "Host room", exact: true }).click();
  await host.waitForURL(/[?&]room=/);
  await takeHostSeat(host, "West pilot");
  if (shared) {
    await host.getByRole("checkbox", { name: /Shared TV/ }).check();
    await host.getByRole("button", { name: /Open TV screen/i }).waitFor();
  }
  const invite = new URL(host.url());
  await guest.goto(invite.href);
  await takeHostSeat(guest, "East pilot");
  const tv = shared ? await device(desktop, false) : undefined;
  if (tv) {
    invite.searchParams.set("display", "1");
    await tv.goto(invite.href);
  }
  await host.getByRole("button", { name: "START MATCH", exact: true }).click();
  return { host, guest, tv };
}

try {
  const desktopPilot = await device(desktop, false);
  await singlePlayer(desktopPilot);
  assert.equal(await desktopPilot.locator(pad).isVisible(), false);
  assert.equal(
    await desktopPilot.locator("html").getAttribute("data-fui-play"),
    null,
  );
  await screenshot(desktopPilot, "desktop");
  await transform(desktopPilot, false);
  await desktopPilot.context().close();

  for (const [name, viewport] of [
    ["portrait", portrait],
    ["landscape", landscape],
  ] as const) {
    const pilot = await device(viewport, true);
    await singlePlayer(pilot);
    await arenaLayout(pilot, "WEST · YOU");
    await screenshot(pilot, name);
    await openTopMenu(pilot);
    assert.equal(
      await pilot.locator(".fui-top-bar-menu[open]").isVisible(),
      true,
    );
    await closeTopMenu(pilot);
    await transform(pilot, true);
    await pilot.context().close();
  }

  const { host, guest } = await room(false);
  await Promise.all([
    arenaLayout(host, "WEST · YOU"),
    arenaLayout(guest, "EAST · YOU"),
  ]);
  await Promise.all([host.context().close(), guest.context().close()]);

  const shared = await room(true);
  for (const [index, controller] of [shared.host, shared.guest].entries()) {
    await controller.locator(".dockside-controller-map canvas").waitFor();
    assert.equal(
      await controller.locator(".dockside-stage").isVisible(),
      false,
    );
    assert.equal(
      await controller.locator("html").getAttribute("data-fui-play"),
      null,
    );
    const buttons = controller.locator(
      ".dockside-table > .controller-only button:visible",
    );
    assert.equal(await buttons.count(), 14);
    assert.ok(
      await buttons.evaluateAll((elements) =>
        elements.every((element) => {
          const { left, top, right, bottom, width, height } =
            element.getBoundingClientRect();
          return (
            width >= 44 &&
            height >= 44 &&
            left >= 0 &&
            top >= 0 &&
            right <= innerWidth &&
            bottom <= innerHeight
          );
        }),
      ),
    );
    assert.match(
      await controller.locator(".dockside-hud").innerText(),
      index === 0 ? /WEST · YOU/ : /EAST · YOU/,
    );
  }
  assert.ok(shared.tv);
  await shared.tv.locator(arena).waitFor();
  await shared.tv
    .locator(".dockside-hud")
    .getByText("CANAL LOCK", { exact: true })
    .waitFor();
  assert.equal(await shared.tv.locator(pad).isVisible(), false);
  assert.deepEqual(pageErrors, []);
  console.log(
    "PASS Dockside phone controls: solo portrait and landscape, individual room host and guest, Shared TV and desktop",
  );
} catch (error) {
  if (pageErrors.length) console.error("Dockside page errors", pageErrors);
  throw error;
} finally {
  await browser.close();
  await service.stop();
}
