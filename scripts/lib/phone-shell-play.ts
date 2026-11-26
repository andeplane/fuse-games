import assert from "node:assert/strict";
import type { Browser } from "playwright";

/** Real phone launcher, arena, Home and lobby. The live iframe must survive a visit to Home. */
export async function checkPhoneShellPlay(browser: Browser, base: string) {
  const viewport = { width: 844, height: 390 };
  const context = await browser.newContext({
    viewport,
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    const landing = new URL(base);
    landing.searchParams.set("mute", "");
    await page.goto(landing.href);
    await page.getByRole("button", { name: "Skip", exact: true }).tap();
    await page.getByRole("button", { name: "Games", exact: true }).tap();
    await page
      .getByRole("button", { name: "Show Fuse Front", exact: true })
      .tap();
    await page
      .getByRole("button", { name: "Play Fuse Front", exact: true })
      .tap();
    const iframe = page.locator(".phone-game");
    const game = page.frameLocator(".phone-game");
    const home = page.getByRole("button", { name: "Home", exact: true });
    await home.waitFor();
    await game.getByRole("button", { name: "Play", exact: true }).tap();
    await game
      .getByRole("button", { name: "Single player", exact: true })
      .tap();
    await game.locator(".ff-in-match canvas.ff-board").waitFor();
    await home.waitFor({ state: "hidden" });
    assert.deepEqual(await iframe.boundingBox(), { x: 0, y: 0, ...viewport });
    let gameNavigations = 0;
    page.on("framenavigated", (frame) => {
      if (frame.parentFrame()) gameNavigations++;
    });
    const menu = game.getByRole("button", {
      name: "Open game menu",
      exact: true,
    });
    await menu.tap();
    const gameHome = game.getByRole("button", {
      name: "FuseOS Home",
      exact: true,
    });
    const size = await gameHome.boundingBox();
    assert.ok(size && size.width >= 44 && size.height >= 44);
    await gameHome.tap();
    await page
      .getByRole("heading", { name: "Fuse Games", exact: true })
      .waitFor();
    await home.waitFor();
    await iframe.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Fuse Front", exact: true }).tap();
    await game.locator(".ff-in-match canvas.ff-board").waitFor();
    await home.waitFor({ state: "hidden" });
    assert.equal(
      gameNavigations,
      0,
      "Home and reopen preserve the same running game",
    );
    await menu.tap();
    await game.getByRole("button", { name: /^back to lobby$/i }).tap();
    await game.locator(".fui-room-layout").waitFor();
    await home.waitFor();
    const restored = await iframe.boundingBox();
    assert.ok(
      restored && restored.width < viewport.width,
      "the lobby restores the phone Home strip",
    );
  } finally {
    await context.close();
  }
}
