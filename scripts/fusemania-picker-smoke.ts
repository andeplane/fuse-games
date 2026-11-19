import assert from "node:assert/strict";
import { launchSelected } from "./lib/browser.js";

type ProbeWindow = Window & {
  fusemania?: { clock(): { roomMs?: number } };
  pickerReads(): number;
  storeBest(song: string): void;
};

const base = process.env.ONLINE_URL ?? "http://127.0.0.1:5237/";
const browser = await launchSelected("chrome", { headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const probe = window as unknown as ProbeWindow;
    const read = Storage.prototype.getItem;
    const keys = new Set<string>();
    let hiddenReads = 0;
    probe.pickerReads = () => hiddenReads;
    probe.storeBest = (song) => {
      const prefix = `fusemania-best-${song}-`;
      for (const key of keys) {
        if (key.startsWith(prefix)) localStorage.setItem(key, "988000");
      }
    };
    Storage.prototype.getItem = function (key: string) {
      if (key.startsWith("fusemania-best-")) {
        keys.add(key);
        if (
          document.querySelector(
            'main[data-screen="play"][data-stage="running"]',
          )
        )
          hiddenReads++;
      }
      return read.call(this, key);
    };
  });
  await page.goto(new URL("fusemania/?solo=1&mute", base).href);
  await page
    .locator('main[data-screen="play"][data-stage="running"]')
    .waitFor();
  const waitForRoomTime = (ms: number) =>
    page.waitForFunction(
      (target) =>
        ((window as unknown as ProbeWindow).fusemania?.clock().roomMs ?? 0) >=
        target,
      ms,
    );
  const reads = () =>
    page.evaluate(() => (window as unknown as ProbeWindow).pickerReads());
  await waitForRoomTime(1_000);
  const before = await reads();
  await waitForRoomTime(3_000);
  const hiddenReads = (await reads()) - before;
  assert.equal(
    hiddenReads,
    0,
    "the hidden song picker skips personal-best lookups",
  );

  const main = page.locator("main[data-screen]");
  const song = await main.getAttribute("data-song");
  assert.ok(song);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "SONG SELECT", exact: true }).click();
  const selectedBest = page.locator(
    'main[data-screen="lobby"] .fm-picker-chip[aria-pressed="true"] .fm-picker-chip-best',
  );
  await selectedBest.waitFor({ state: "attached" });
  await page.evaluate(
    (id) => (window as unknown as ProbeWindow).storeBest(id),
    song,
  );
  await selectedBest.filter({ hasText: "98.80%" }).waitFor();
  assert.equal(await main.getAttribute("data-song"), song);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ hiddenReads, personalBestRefreshed: true }));
} finally {
  await browser.close();
}
