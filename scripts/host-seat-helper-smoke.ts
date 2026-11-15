/** Browser-state regressions for the shared smoke helper; no room service or real account is needed. */
import assert from "node:assert/strict";
import { launchSelected } from "./lib/browser.js";
import { takeHostSeat } from "./lib/main-menu.js";

const browser = await launchSelected("chromium", { headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`
    <span class="fui-room-count">1 / 6</span>
    <button class="room-switch">SWAP TO SPECTATOR</button>
    <div class="fui-room-open-slot"><button hidden>Join</button></div>
  `);
  await takeHostSeat(page, "Already seated");
  assert.equal(await page.locator(".fui-room-count").innerText(), "1 / 6");
  assert.equal(
    await page.locator(".room-switch").innerText(),
    "SWAP TO SPECTATOR",
  );
  console.log("PASS: the host's own seated state skips hidden Join controls");

  const admission = `
    <span class="fui-room-count">1 / 6</span>
    <button class="room-switch">SWAP TO PLAYER</button>
    <div class="fui-room-open-slot"><button type="button" id="take-seat">Join</button></div>
    <dialog class="fui-slot-admission"><form method="dialog">
      <input name="player"><button type="submit">Join</button>
    </form></dialog>
    <script>
      (() => {
      const dialog = document.querySelector("dialog");
      document.querySelector("#take-seat").onclick = () => dialog.showModal();
      document.querySelector("form").onsubmit = () => {
        document.body.dataset.seatedName = document.querySelector("input").value;
        document.querySelector(".fui-room-count").textContent = "2 / 6";
        document.querySelector(".room-switch").textContent = "SWAP TO SPECTATOR";
        document.querySelector("#take-seat").hidden = true;
      };
      })();
    </script>`;
  await page.setContent(admission);
  await takeHostSeat(page, "Host");
  assert.equal(
    await page.locator("body").getAttribute("data-seated-name"),
    "Host",
  );
  assert.equal(await page.locator(".fui-room-count").innerText(), "2 / 6");
  assert.equal(await page.locator("dialog").isVisible(), false);
  console.log(
    "PASS: another rider's count and a watcher action do not skip explicit admission",
  );

  await page.setContent(admission);
  await page.locator("#take-seat").click();
  await takeHostSeat(page, "Open admission");
  assert.equal(
    await page.locator("body").getAttribute("data-seated-name"),
    "Open admission",
  );
  assert.equal(await page.locator("dialog").isVisible(), false);
  console.log(
    "PASS: an already-open admission form still fills and submits the requested name",
  );
} finally {
  await browser.close();
}
