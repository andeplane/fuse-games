import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";

// A real, normal-time skirmish: the unattended human loses to the ordinary AI.
// This checks the actual result/reset flow; it does not inject a finished world.
const url =
  process.argv[2] ??
  process.env.FUSE_CRAFT_URL ??
  "http://127.0.0.1:5174/games/fuse-craft/?mute";
const output = "/tmp/neural-finish-smoke";
await mkdir(output, { recursive: true });
await Promise.all(
  (
    [
      ["chromium", chromium],
      ["webkit", webkit],
    ] as const
  ).map(async ([name, engine]) => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 568, height: 320 },
        isMobile: true,
        hasTouch: true,
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      // This offline match must survive the full normal-time run. Disable the
      // dev server's reload socket so unrelated edits cannot restart the page.
      // The local skirmish uses no application WebSocket transport.
      await page.routeWebSocket("**", (socket) => socket.close());
      await page.goto(url);
      await page.locator('[data-action="new-game"]').click();
      await page.locator('[data-action="mode-skirmish"]').click();
      await page.locator('[data-action="start"]').click();
      await page
        .locator("#match-result:not([hidden])")
        .waitFor({ state: "visible", timeout: 450_000 });
      // The shared results screen draws its title in capitals.
      assert.match(
        await page.locator("#match-result .fui-results-victory h2").innerText(),
        /Defeat/i,
      );
      const viewport = page.viewportSize()!;
      for (const button of await page
        .locator("#match-result .fui-results-actions button")
        .all()) {
        const box = (await button.boundingBox())!;
        assert.ok(
          box.y >= 0 && box.y + box.height <= viewport.height,
          "result buttons remain reachable",
        );
      }
      await page.screenshot({ path: `${output}/${name}-defeat-landscape.png` });
      await page.locator('#match-result [data-action="rematch"]').click();
      assert.equal(
        await page.locator('[data-action="confirm-reset"]').count(),
        0,
        "finished rematches restart immediately",
      );
      await page.locator("#match-result").waitFor({ state: "hidden" });
      assert.equal(await page.locator(".structure-brain").count(), 2);
      assert.deepEqual(errors, []);
      console.log(
        `${name}: normal-time defeat, landscape result buttons and rematch passed`,
      );
    } finally {
      await browser.close();
    }
  }),
);
