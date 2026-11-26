import assert from "node:assert/strict";
import type { Page } from "playwright";
import { launchSelected } from "../../scripts/lib/browser.js";
import { startGameCoverage } from "../../scripts/lib/game-browser-coverage.js";
import { startRoomService } from "../../scripts/lib/server.js";
import { LEVELS } from "./src/engine/index.js";
import { keys } from "./src/app/session.js";

const names = keys("elasto-fuse");
const serverUrl = process.env.ONLINE_URL;
const service = serverUrl ? undefined : await startRoomService();
try {
  const browser = await launchSelected(
    process.env.FUSE_GAME_COVERAGE_DIR ? "chrome" : "chromium",
    { headless: true },
  );
  try {
    const host = await browser.newPage();
    const guest = await browser.newPage();
    const coverage = await Promise.all(
      [host, guest].map((page) =>
        startGameCoverage(page, { gameId: "elasto-fuse" }),
      ),
    );
    const home = new URL("elastofuse/?mute", serverUrl ?? service!.url);
    const name = (page: Page, text: string) =>
      page.getByRole("button", { name: text, exact: true });
    const selectLevels = (page: Page, label: string) =>
      page.getByRole("combobox", { name: label }).evaluate((select) =>
        Array.from((select as HTMLSelectElement).options)
          .filter((option) => !option.disabled)
          .map((option) => option.value),
      );
    const chooseSolo = async (page: Page) => {
      await name(page, "Play").click();
      await name(page, "Single player").click();
    };
    const main = host.locator(".ef-room");
    await host.goto(home.href);
    assert.equal(
      await host.getByRole("button", { name: /^Continue/ }).count(),
      0,
    );
    await chooseSolo(host);
    assert.deepEqual(await selectLevels(host, "Level"), ["random", "0"]);
    await host.getByRole("combobox", { name: "Level" }).selectOption("random");
    await name(host, "PLAY SOLO").click();
    await host.waitForURL(/random=1/);
    await host.waitForFunction(() =>
      document.querySelector(".ef-room")?.getAttribute("data-level"),
    );
    assert.ok(Number(await main.getAttribute("data-level")) < LEVELS.length);

    await host.goto(new URL("?mute&solo=1&level=100", home).href);
    await host.locator('.ef-room[data-level="0"]').waitFor();
    await host.evaluate(
      ([key, nameKey]) => {
        localStorage.setItem(key, "1024");
        localStorage.setItem(nameKey, "Ada");
      },
      [names.best(LEVELS[0]!.id), names.name] as const,
    );
    await host.goto(home.href);
    const continueButton = name(host, "Continue · Level 2");
    await host.setViewportSize({ width: 844, height: 390 });
    const playBounds = await name(host, "Play").boundingBox();
    assert.ok(
      playBounds && playBounds.y + playBounds.height <= 390,
      "Play fits below Continue in phone landscape",
    );
    assert.equal(
      await continueButton.evaluate(
        (button) => button.nextElementSibling?.textContent,
      ),
      "Play",
    );
    await continueButton.click();
    await host.locator('.ef-room[data-level="1"]').waitFor();

    await host.goto(home.href);
    await name(host, "Play").click();
    await name(host, "Host room").click();
    await host.waitForURL(/room=/);
    const startingLevel = host.getByRole("combobox", {
      name: "Starting level",
    });
    await startingLevel
      .locator('option[value="1"]:enabled')
      .waitFor({ state: "attached" });
    assert.deepEqual(await selectLevels(host, "Starting level"), ["0", "1"]);
    await guest.addInitScript(
      ([nameKey, ...bestKeys]) => {
        localStorage.setItem(nameKey!, "Bo");
        for (const key of bestKeys) localStorage.setItem(key, "1024");
      },
      [names.name, ...LEVELS.slice(0, 3).map(({ id }) => names.best(id))],
    );
    await guest.goto(host.url());
    await startingLevel
      .locator('option[value="3"]:enabled')
      .waitFor({ state: "attached" });
    assert.deepEqual(await selectLevels(host, "Starting level"), [
      "0",
      "1",
      "2",
      "3",
    ]);
    await startingLevel.selectOption("3");
    await name(host, "START RACE").click();
    await Promise.all(
      [host, guest].map((page) =>
        page.locator('.ef-room[data-level="3"]').waitFor(),
      ),
    );
    await Promise.all(coverage.map((finish) => finish()));
    console.log(
      "Elasto Fuse: fresh, Random, Continue, locked links, and room guest unlocks passed",
    );
  } finally {
    await browser.close();
  }
} finally {
  await service?.stop();
}
