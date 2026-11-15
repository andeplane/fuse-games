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
