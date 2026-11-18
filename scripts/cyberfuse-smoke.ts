/** Run against a local Cyberfuse preview with its room service: ONLINE_URL=http://localhost:<port>/ pnpm exec tsx scripts/cyberfuse-smoke.ts */
import assert from "node:assert/strict";
import { launchBrowser } from "./lib/browser.js";
import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
import type { Page } from "playwright";

interface Probe {
  phase?: string;
  round?: number;
  self: string;
  tick?: number;
  hashChecks: number;
  mismatches: number;
  actors: {
    seat: string | null;
    x: number;
    y: number;
    hp: number;
    weapon: number;
    lastShot: number;
  }[];
}
declare global {
  interface Window {
    __cyberfuseProbe?: () => Probe;
  }
}
const base = new URL(process.env.ONLINE_URL ?? "http://localhost:8797/");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname),
  "the read-only game probe is local-only",
);
function address(query = "") {
  const url = new URL("cyberfuse/", base);
  url.search = new URLSearchParams(query).toString();
  url.searchParams.set("mute", "");
  url.searchParams.set("probe", "");
  return url.href;
}
async function phase(page: Page, value: string) {
  await page.waitForFunction(
    (phase) => window.__cyberfuseProbe?.().phase === phase,
    value,
  );
}
async function current(page: Page) {
  const found = await page.evaluate(() => {
    const p = window.__cyberfuseProbe?.();
    return p?.actors.find((a) => a.seat === p.self);
  });
  assert.ok(found?.seat, "this browser has a playing seat");
  return found;
}
async function frameFits(page: Page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "viewport must not scroll sideways",
  );
  const box = await page
    .getByLabel("Cyberfuse mission", { exact: true })
    .boundingBox();
  assert.ok(
    box && box.width >= 300 && box.height >= 280,
    "real mission canvas fills the viewport",
  );
}
async function moved(page: Page, before: Awaited<ReturnType<typeof current>>) {
  return page.waitForFunction(
    (old) => {
      const actor = window
        .__cyberfuseProbe?.()
        .actors.find((a) => a.seat === old.seat);
      return actor && Math.hypot(actor.x - old.x, actor.y - old.y) >= 2;
    },
    before,
    { timeout: 1500 },
  );
}
async function walkKeyboard(page: Page) {
  const old = await current(page);
  for (const key of ["KeyD", "KeyW", "KeyA", "KeyS"]) {
    await page.keyboard.down(key);
    try {
      const changed = await moved(page, old).then(
        () => true,
        () => false,
      );
      if (changed) return;
    } finally {
      await page.keyboard.up(key);
    }
  }
  assert.fail("no movement in any direction");
}
async function walkTouch(controller: Page, observer: Page) {
  const old = await current(controller),
    bounds = await controller
      .getByLabel("Directional pad", { exact: true })
      .boundingBox();
  assert.ok(bounds, "direction pad is visible on a phone");
  const cdp = await controller.context().newCDPSession(controller);
  try {
    for (const [dx, dy] of [
      [0.85, 0.5],
      [0.5, 0.2],
      [0.15, 0.5],
      [0.5, 0.8],
    ] as const) {
      const point = (x: number, y: number) => ({
        x: bounds.x + bounds.width * x,
        y: bounds.y + bounds.height * y,
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point(0.5, 0.5)],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point(dx, dy)],
      });
      try {
        if (
          await moved(observer, old).then(
            () => true,
            () => false,
          )
        )
          return;
      } finally {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      }
    }
    assert.fail("TV never received movement from a phone swipe");
  } finally {
    await cdp.detach();
  }
}
async function hashAgreement(page: Page) {
  const before = await page.evaluate(
    () => window.__cyberfuseProbe!().hashChecks,
  );
  await page.waitForFunction(
    (n) => window.__cyberfuseProbe!().hashChecks >= n + 2,
    before,
  );
  assert.equal(
    await page.evaluate(() => window.__cyberfuseProbe!().mismatches),
    0,
    "online checkpoints agree",
  );
}
async function solo(page: Page) {
  await page.goto(address());
  await page.getByRole("heading", { name: "Cyberfuse", exact: true }).waitFor();
  await page.getByRole("button", { name: "How to play", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "How to play", exact: true });
  assert.match(await guide.innerText(), /slide/i);
  assert.match(await guide.innerText(), /direction pad/i);
  await page.keyboard.press("Escape");
  await guide.waitFor({ state: "hidden" });
  await openPlayOptions(page, "single");
  const brief = page.getByRole("dialog", {
    name: "Single player",
    exact: true,
  });
  const missionTitle = await brief.locator(".cf-briefing h3").innerText();
  assert.ok(missionTitle.length > 0);
  assert.ok((await brief.locator("fieldset input:checked").count()) >= 2);
  await brief.getByRole("button", { name: "Deploy", exact: true }).click();
  await phase(page, "running");
  await page
    .locator(".cf-objective strong")
    .filter({ hasText: missionTitle })
    .waitFor();
  await frameFits(page);
  await page.getByLabel("Cyberfuse mission", { exact: true }).focus();
  await walkKeyboard(page);
  const initial = await current(page);
  await page.keyboard.down("Space");
  try {
    await page.waitForFunction(
      (old) =>
        (window.__cyberfuseProbe!().actors.find((a) => a.seat === old.seat)
          ?.lastShot ?? -1) > old.lastShot,
      initial,
    );
  } finally {
    await page.keyboard.up("Space");
  }
  await page.keyboard.press("ShiftLeft", { delay: 140 });
  await page.waitForFunction(
    (old) =>
      window.__cyberfuseProbe!().actors.some(
        (a) => a.seat === old.seat && a.weapon !== old.weapon,
      ),
    initial,
  );
  await page.keyboard.press("KeyM");
  const map = page.getByRole("region", { name: "Mission map", exact: true });
  await map.waitFor();
  await map.getByRole("button", { name: "Close map", exact: true }).click();
  await map.waitFor({ state: "hidden" });
  console.log(
    "Solo campaign briefing, help, movement, shooting, cycling and map passed",
  );
}
async function dogfight(page: Page) {
  await page.goto(address());
  await openPlayOptions(page, "single");
  const brief = page.getByRole("dialog", {
    name: "Single player",
    exact: true,
  });
  await brief.getByLabel("Game mode", { exact: true }).selectOption("dogfight");
  await brief.getByLabel("Arena", { exact: true }).selectOption("0");
  const guns = brief.locator("fieldset");
  // Choose dynamite through the armory; repeated point-blank blasts end a real round.
  const current = guns.locator("input:checked");
  while ((await current.count()) > 1) await current.first().uncheck();
  await guns.getByLabel("Dynamite", { exact: true }).check();
  for (const label of await guns.locator("label").all()) {
    if (
      (await label.innerText()) !== "Dynamite" &&
      (await label.locator("input").isChecked())
    )
      await label.locator("input").uncheck();
  }
  await brief.getByRole("button", { name: "Deploy", exact: true }).click();
  await phase(page, "running");
  assert.equal(
    await page.getByRole("button", { name: "Map", exact: true }).isVisible(),
    false,
  );
  await page.getByLabel("Cyberfuse mission", { exact: true }).focus();
  await page.keyboard.down("Space");
  try {
    await page.waitForFunction(
      () =>
        ["between", "over"].includes(window.__cyberfuseProbe?.().phase ?? ""),
      undefined,
      { timeout: 120000 },
    );
  } finally {
    await page.keyboard.up("Space");
  }
  const round = await page.evaluate(() => window.__cyberfuseProbe!().round!);
  const next = page.getByRole("button", { name: /^(next round|play again)$/i });
  await next.click();
  await phase(page, "running");
  const after = await page.evaluate(() => window.__cyberfuseProbe!().round);
  assert.ok(
    after === round + 1 || after === 1,
    "next round or rematch reset the playing state",
  );
  console.log("Dogfight loadout, a completed round and replay passed");
}
async function online(host: Page, peer: Page, tv: Page) {
  await host.goto(address());
  await openPlayOptions(host);
  await host.getByRole("button", { name: "Host room", exact: true }).click();
  await host.waitForURL(/room=/);
  await phase(host, "lobby");
  const code = new URL(host.url()).searchParams.get("room");
  assert.ok(code);
  await takeHostSeat(host, "Ada");
  await host
    .getByRole("button", { name: "Start mission", exact: true })
    .click();
  await phase(host, "running");
  assert.equal(
    (
      await host.evaluate(() =>
        window.__cyberfuseProbe!().actors.filter((a) => a.seat !== null),
      )
    ).length,
    1,
    "one-seat room starts",
  );
  await host
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await host
    .getByRole("button", { name: "Game controls", exact: true })
    .click();
  await host.getByRole("button", { name: /^back to lobby$/i }).click();
  await phase(host, "lobby");
  await peer.goto(address("room=" + code));
  await takeHostSeat(peer, "Bo");
  await host.locator(".fui-roster-name", { hasText: "Bo" }).waitFor();
  await host.getByRole("checkbox", { name: /^Shared TV/ }).check();
  await tv.goto(address("room=" + code + "&display=1"));
  await phase(tv, "lobby");
  await host
    .getByRole("button", { name: "Start mission", exact: true })
    .click();
  await Promise.all([host, peer, tv].map((p) => phase(p, "running")));
  await frameFits(peer);
  await frameFits(tv);
  assert.equal(
    await tv.getByLabel("Directional pad", { exact: true }).isVisible(),
    false,
  );
  await walkTouch(peer, tv);
  const before = await current(peer);
  await peer.setViewportSize({ width: 780, height: 360 });
  await frameFits(peer);
  await peer.getByRole("button", { name: "Map", exact: true }).tap();
  await peer.getByRole("button", { name: "Close map", exact: true }).tap();
  await peer.setViewportSize({ width: 360, height: 780 });
  await hashAgreement(peer);
  await peer.reload();
  await phase(peer, "running");
  assert.equal(
    (await current(peer)).seat,
    before.seat,
    "restored own seat after reload",
  );
  await Promise.all([hashAgreement(peer), hashAgreement(tv)]);
  assert.equal(
    await peer.evaluate(
      (id) =>
        window.__cyberfuseProbe!().actors.filter((a) => a.seat === id).length,
      before.seat,
    ),
    1,
    "recovery did not duplicate player",
  );
  console.log(
    "One-player room, host/guest/TV, touch movement, phone landscape and post-reconnect hash convergence passed",
  );
}
const browser = await launchBrowser("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
const errors: string[] = [];
try {
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1440, height: 900 } }),
    browser.newContext({
      viewport: { width: 360, height: 780 },
      isMobile: true,
      hasTouch: true,
    }),
    browser.newContext({ viewport: { width: 1440, height: 900 } }),
    browser.newContext({ viewport: { width: 1000, height: 700 } }),
  ]);
  const [host, peer, tv, arena] = await Promise.all(
    contexts.map((c) => c.newPage()),
  );
  assert.ok(host && peer && tv && arena);
  for (const p of [host, peer, tv, arena])
    p.on("pageerror", (e) => errors.push(e.message));
  await Promise.all([
    dogfight(arena),
    solo(host).then(() => online(host, peer, tv)),
  ]);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
