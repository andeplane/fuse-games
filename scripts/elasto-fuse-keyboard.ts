import assert from "node:assert/strict";
import { launchSelected } from "./lib/browser.js";
import { startViteServer } from "./lib/server.js";

/** The actual menu/keyboard boundary: closing navigation must hand the arrows back to the bike. */
const server = process.env.HOME_URL ? undefined : await startViteServer();
const base = process.env.HOME_URL ?? server!.url;
const browser = await launchSelected("chrome", { headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const exit of ["Back", "Escape", "BACK TO GAME", "keyboard"] as const) {
    await page.goto(
      new URL("elasto-fuse/?solo=1&level=0&mute&probe", base).href,
    );
    await page.waitForFunction(() => {
      const frames = Reflect.get(window, "__elastoFrames");
      return frames?.at(-1)?.phase === "racing";
    });
    const toggle = page.getByRole("button", {
      name: "Open game menu",
      exact: true,
    });
    if (exit === "keyboard") {
      await toggle.focus();
      await page.keyboard.press("Space");
    } else await toggle.click();
    const dialog = page.getByRole("dialog", { name: "Game menu", exact: true });
    await dialog.waitFor({ state: "visible" });
    if (exit === "Escape") await page.keyboard.press("Escape");
    else if (exit === "BACK TO GAME") {
      await dialog
        .getByRole("button", { name: "Game controls", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "BACK TO GAME", exact: true })
        .click();
    } else
      await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(() =>
      document.activeElement?.classList.contains("ef-room"),
    );
    const before = await page.evaluate(
      () => Reflect.get(window, "__elastoFrames").at(-1).riders[0].x as number,
    );
    await page.keyboard.down("ArrowUp");
    try {
      await page.waitForFunction(
        (x) =>
          Math.abs(
            Reflect.get(window, "__elastoFrames").at(-1).riders[0].x - x,
          ) > 0.15,
        before,
      );
    } finally {
      await page.keyboard.up("ArrowUp");
    }
    assert.equal(
      await toggle.getAttribute("aria-expanded"),
      "false",
      `${exit}: gas must not reopen the menu`,
    );
    console.log(`${exit}: focus returned to play and ArrowUp drove the bike`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server?.stop();
}
