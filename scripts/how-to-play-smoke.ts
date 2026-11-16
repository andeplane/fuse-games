import assert from "node:assert/strict";
import { launchSelected } from "./lib/browser.js";
import { startRoomService } from "./lib/server.js";

const server = process.env.ONLINE_URL ? undefined : await startRoomService();
const base = process.env.ONLINE_URL ?? server!.url;
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
try {
  const page = await browser.newPage();
  for (const game of [
    "fusero",
    "fusedrivers",
    "fusebombers",
    "fuselane",
    "dice",
    "graveyardshift",
  ]) {
    await page.goto(new URL(`${game}/?mute`, base).href);
    await page
      .locator(".fui-main-menu")
      .getByRole("button", { name: "How to play", exact: true })
      .click();
    const content = page.locator("dialog[open] .fui-how-to-play");
    await content.waitFor();
    const colors = await content.evaluate((node) => {
      const dialog = node.closest("dialog")!;
      return {
        goal: [
          getComputedStyle(node.querySelector("p")!).color,
          getComputedStyle(dialog).backgroundColor,
        ],
        action: [
          getComputedStyle(node.querySelector("dd")!).color,
          getComputedStyle(dialog).backgroundColor,
        ],
        heading: [
          getComputedStyle(node.querySelector("h3")!).color,
          getComputedStyle(dialog).backgroundColor,
        ],
        header: [
          getComputedStyle(dialog.querySelector(".fui-dialog-title")!).color,
          getComputedStyle(dialog.querySelector(".fui-dialog-bar")!)
            .backgroundColor,
        ],
      };
    });
    for (const [part, pair] of Object.entries(colors)) {
      const values = pair.map((color) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return (
          channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
        );
      });
      const ratio = (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
      assert.ok(
        ratio >= 4.5,
        `${game} ${part} contrast is ${ratio.toFixed(2)}:1`,
      );
    }
    assert.ok(await content.locator("dd").count(), `${game} teaches actions`);
    if (game !== "fuselane")
      assert.ok(
        await content.locator("kbd").count(),
        `${game} teaches actual keys`,
      );
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 844, height: 390 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      assert.equal(
        await content.evaluate(
          (node) => node.scrollWidth > node.clientWidth + 1,
        ),
        false,
        `${game} fits ${viewport.width}px`,
      );
      await content.locator("dd").last().scrollIntoViewIfNeeded();
      await page
        .locator("dialog[open]")
        .getByRole("button", { name: "Back", exact: true })
        .scrollIntoViewIfNeeded();
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await page
      .locator(".fui-main-menu")
      .getByRole("button", { name: "How to play", exact: true })
      .click();
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "Back", exact: true })
      .click();
    assert.equal(await page.locator("dialog[open]").count(), 0);
  }
  await page.goto(new URL("fusero/?solo=1&mute", base).href);
  await page.getByRole("button", { name: "START MATCH", exact: true }).click();
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await page
    .locator(".fui-top-bar-menu[open]")
    .getByRole("button", { name: /^Game controls$/i })
    .click();
  await page
    .locator(".fui-top-bar-menu[open]")
    .getByRole("button", { name: /^Controls$/i })
    .click();
  await page.locator(".fui-controls-list kbd").first().waitFor();
  assert.ok(
    (await page.locator(".fui-controls-list").innerText()).includes("Fire"),
  );
  await page.keyboard.press("Escape");
  console.log(
    "Shared How to Play: six real pages pass controls, responsive scrolling, Back and Escape; in-game keycaps render",
  );
} finally {
  await browser.close();
  await server?.stop();
}
