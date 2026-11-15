/** Real game menus inside FuseOS, with no real account or production writes. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "vite";
import { launchSelected } from "./lib/browser.js";
import { readdir, readFile } from "node:fs/promises";

const vite = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
await vite.listen();
const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
const browser = await launchSelected("chrome", { headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/?mute`);
  await page.getByRole("dialog", { name: "Connect To", exact: true }).waitFor();
  for (const title of ["Fusteam", "MSN Messenger"])
    assert.equal(
      await page.getByRole("dialog", { name: title, exact: true }).count(),
      1,
    );
  assert.equal(
    await page.getByRole("region", { name: "Winamp", exact: true }).count(),
    1,
  );
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Connect To", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => localStorage.getItem("fuseos.network.connected")),
    "1",
  );
  await page.reload();
  await page
    .getByRole("dialog", { name: "MSN Messenger", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("dialog", { name: "Connect To", exact: true }).count(),
    0,
  );
  console.log(
    "PASS first boot opens three apps; completed dial-up survives reload",
  );
  await context.close();

  const games = [];
  for (const id of await readdir(new URL("../games/", import.meta.url))) {
    try {
      const entry = JSON.parse(
        await readFile(
          new URL(`../games/${id}/portal.json`, import.meta.url),
          "utf8",
        ),
      ) as { name: string };
      games.push({ id, name: entry.name });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const frames = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await frames.addInitScript(() => {
    if (window.self !== window.top) return;
    localStorage.setItem("fuseos.network.connected", "1");
    localStorage.setItem(
      "fuseos.state.v1",
      JSON.stringify({ version: 1, windows: [], assistantHidden: true }),
    );
  });
  const gamePage = await frames.newPage();
  gamePage.on("pageerror", (error) => errors.push(error.message));
  for (const game of games) {
    await gamePage.goto(`${origin}/?mute&open=${game.id}`);
    const frame = gamePage.frameLocator(`iframe[title="${game.name}"]`);
    await frame
      .getByRole("button", { name: "Open game menu", exact: true })
      .click();
    const friends = frame.locator(".friends-button").filter({ visible: true });
    await friends.first().waitFor();
    await friends.first().click();
    const messenger = gamePage.getByRole("dialog", {
      name: "MSN Messenger",
      exact: true,
    });
    await messenger.waitFor();
    await gamePage.waitForFunction(() => {
      const windows = JSON.parse(
        localStorage.getItem("fuseos.state.v1") ?? "{}",
      ).windows as { kind: string }[] | undefined;
      return windows?.at(-1)?.kind === "friends";
    });
    assert.equal(
      await frame.locator(".friends-dialog[open]").count(),
      0,
      `${game.id} handed friends to desktop`,
    );
    console.log(`PASS ${game.id}: iframe Friends opens MSN Messenger`);
  }
  await frames.close();
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await vite.close();
}
