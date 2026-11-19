import assert from "node:assert/strict";
import { launchSelected } from "./lib/browser.js";
import { startViteServer } from "./lib/server.js";

// Real entry points: catch controls clipped by a dialog or the viewport, even
// when the document itself hides horizontal overflow. Run with ONLINE_URL to
// inspect a built preview, or without it to exercise current source via Vite.
const server = process.env.ONLINE_URL ? undefined : await startViteServer();
const base = process.env.ONLINE_URL ?? server!.url;
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
const sizes = [
  { width: 360, height: 800 },
  { width: 844, height: 390 },
  { width: 1440, height: 1000 },
];

try {
  for (const hasTouch of [false, true]) {
    const context = await browser.newContext({ hasTouch });
    const page = await context.newPage();
    await page.goto(new URL("fusemania/?mute", base).href);
    await page
      .locator(".fui-main-menu")
      .getByRole("button", { name: "Play", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Single player", exact: true })
      .click();
    const dialog = page.locator("dialog[open]");
    for (const size of sizes) {
      await page.setViewportSize(size);
      for (const name of ["Back", "Scroll speed", "Play"]) {
        const control = dialog.getByRole("button", {
          name: new RegExp(`^${name}$`, "i"),
        });
        assert.ok(
          await control.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const bar = node
              .closest(".fui-dialog-bar")!
              .getBoundingClientRect();
            return (
              rect.width >= 44 &&
              rect.height >= 44 &&
              rect.left >= bar.left &&
              rect.right <= bar.right + 1
            );
          }),
          `Fusemania ${name} fits at ${size.width}px (touch=${hasTouch})`,
        );
      }
      await dialog.getByRole("button", { name: /^scroll speed$/i }).click();
      await page.locator(".fui-player-options-panel:not([hidden])").waitFor();
      await page.keyboard.press("Escape");
      assert.equal(
        await dialog.isVisible(),
        true,
        "Escape closes options before leaving song select",
      );
    }
    await page.goto(new URL("graveyardshift/?solo=1&mute", base).href);
    for (const size of sizes) {
      await page.setViewportSize(size);
      const controls = page.locator(".pad:visible button");
      if (await controls.count())
        assert.ok(
          await controls.evaluateAll((nodes) =>
            nodes.every((node) => {
              const rect = node.getBoundingClientRect();
              return (
                rect.width >= 44 &&
                rect.height >= 44 &&
                rect.left >= 0 &&
                rect.right <= innerWidth
              );
            }),
          ),
          `Graveyard Shift controls fit at ${size.width}px (touch=${hasTouch})`,
        );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
    }
    await page.setViewportSize(sizes[0]!);
    await page.goto(new URL("fuseriders/?solo=1&mute", base).href);
    await page.locator(".online-arena").waitFor();
    // Starting a round closes the phone tools. Rotate during play, after the transition.
    await page
      .locator('.mobile-control-hints[data-phase="playing"]')
      .waitFor({ state: "attached" });
    if (!hasTouch) {
      // The solo boot starts with five AI. Fill the two remaining seats, then
      // restart from the lobby so all eight riders are in the round itself.
      await page.setViewportSize(sizes[1]!);
      const addAI = page.getByRole("button", { name: "Add AI", exact: true });
      const scoreCards = page.locator(".online-score-card:visible");
      for (const expected of [7, 8]) {
        await addAI.click();
        await scoreCards.nth(expected - 1).waitFor();
      }
      await page.getByRole("button", { name: /^back to lobby$/i }).click();
      await page.getByRole("button", { name: /^start race$/i }).click();
      await scoreCards.nth(7).waitFor();
      await page
        .locator('.mobile-control-hints[data-phase="playing"]')
        .waitFor({ state: "attached" });
      assert.equal(await scoreCards.count(), 8);
      const arena = await page.locator(".online-arena").boundingBox();
      assert.ok(
        arena && arena.height >= sizes[1]!.height * 0.75,
        "Eight mouse-and-keyboard standings leave most of a short landscape window for the arena",
      );
      const lastCard = scoreCards.nth(7);
      await lastCard.scrollIntoViewIfNeeded();
      assert.ok(
        await lastCard.evaluate((card) => {
          const bounds = card.getBoundingClientRect();
          return bounds.top >= 0 && bounds.bottom <= innerHeight + 1;
        }),
        "All eight standings are reachable in the short window",
      );
    }
    for (const size of [sizes[1]!, sizes[2]!, sizes[0]!]) {
      await page.setViewportSize(size);
      const portrait = size.height > size.width;
      const phone = portrait || (hasTouch && size.width === 844);
      const layout = phone
        ? portrait
          ? "#app.mobile-play.mobile-portrait"
          : "#app.mobile-play:not(.mobile-portrait)"
        : "#app:not(.mobile-play)";
      const toggle = page
        .locator(layout)
        .locator(phone ? ".mobile-tools-toggle" : ".fui-top-bar-toggle");
      await toggle.waitFor();
      const box = await toggle.boundingBox();
      assert.ok(
        box && box.width > 0 && box.x >= 0 && box.x + box.width <= size.width,
        `Riders menu is inside ${size.width}px after rotation (touch=${hasTouch})`,
      );
      await toggle.click();
      const opened = phone
        ? page.locator("#app.mobile-tools-open")
        : page.getByRole("dialog", { name: /^game menu$/i });
      await opened.waitFor();
      if (phone) await toggle.click();
      else await page.keyboard.press("Escape");
      await opened.waitFor({ state: "hidden" });
    }
    await page.goto(new URL("fuselane/?mute", base).href);
    await page.locator(".fui-main-menu").waitFor();
    assert.equal(
      await page
        .locator("body")
        .evaluate((body) => getComputedStyle(body).backgroundColor),
      "rgb(3, 9, 25)",
      "Fusetown's attract scene has a dark backing for light menu text",
    );
    for (const kind of ["help", "join", "settings"]) {
      await page.goto(new URL("hookhavok/?mute", base).href);
      const main = page.locator(".fui-main-menu");
      if (kind === "join") {
        await main.getByRole("button", { name: "Play", exact: true }).click();
        await main
          .getByRole("button", { name: "Join room", exact: true })
          .click();
      } else if (kind === "settings") {
        await page.getByRole("button", { name: "Open game menu" }).click();
        await page.getByRole("button", { name: /^player options$/i }).click();
      } else {
        await main
          .getByRole("button", {
            name: "How to play",
            exact: true,
          })
          .click();
      }
      const sheet =
        kind === "settings"
          ? page.getByRole("dialog", { name: /^player options$/i })
          : page.locator(`#entrance-${kind}[open]`);
      for (const size of sizes) {
        await page.setViewportSize(size);
        const last =
          kind === "settings"
            ? sheet.getByRole("slider").last()
            : sheet.locator("p").last();
        await last.scrollIntoViewIfNeeded();
        assert.ok(
          await sheet
            .getByRole("button", { name: "Back", exact: true })
            .evaluate((button) => {
              const rect = button.getBoundingClientRect();
              return (
                rect.left >= 0 &&
                rect.right <= innerWidth &&
                rect.top >= 0 &&
                rect.bottom <= innerHeight
              );
            }),
          `Hook Havok ${kind} keeps Back in reach at ${size.width}px`,
        );
      }
      await sheet.getByRole("button", { name: "Back", exact: true }).click();
      assert.equal(await sheet.count(), 0);
    }
    await context.close();
  }
  console.log(
    "Responsive real flows: Fusemania actions/options, Graveyard Shift pads, Riders rotation/menu and Fusetown menu backing pass with mouse and emulated touch.",
  );
} finally {
  await browser.close();
  await server?.stop();
}
