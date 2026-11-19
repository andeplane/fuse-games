/** Run against a local Cyberfuse preview with its room service: ONLINE_URL=http://localhost:<port>/ pnpm exec tsx scripts/cyberfuse-smoke.ts */
import assert from "node:assert/strict";
import { launchBrowser } from "./lib/browser.js";
import { startGameCoverage } from "./lib/game-browser-coverage.js";
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
async function walkKeyboard(
  page: Page,
  old: Awaited<ReturnType<typeof current>>,
  keys: readonly string[],
) {
  for (const key of keys) {
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
  await brief
    .getByRole("combobox", { name: "Campaign", exact: true })
    .selectOption({ label: "Ogre Rampage" });
  await brief.getByText("Mission password", { exact: true }).click();
  const password = brief.getByLabel("Password", { exact: true });
  await password.fill("bad-code");
  await brief
    .getByRole("button", { name: "Use password", exact: true })
    .click();
  assert.match(
    await brief.locator(".cf-resume [role=status]").innerText(),
    /unknown password/i,
  );
  // DOS seed zero, one-player Ogre Rampage, mission two.
  await password.fill("Q4SKDB");
  await password.press("Enter");
  const missionTitle = "Retrieve the stolen data";
  await brief
    .getByRole("heading", { name: missionTitle, exact: true })
    .waitFor();
  assert.ok((await brief.locator("fieldset input:checked").count()) >= 2);
  await brief.getByRole("button", { name: "Deploy", exact: true }).click();
  await phase(page, "running");
  await page
    .locator(".cf-objective strong")
    .filter({ hasText: missionTitle })
    .waitFor();
  await frameFits(page);
  await page.getByLabel("Cyberfuse mission", { exact: true }).focus();
  await walkKeyboard(page, await current(page), [
    "KeyD",
    "KeyW",
    "KeyA",
    "KeyS",
  ]);
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
  const stopped = await pausedClock(page);
  await map.getByRole("button", { name: "Close map", exact: true }).click();
  await map.waitFor({ state: "hidden" });
  await page.waitForFunction(
    (previous) => window.__cyberfuseProbe!().tick! >= previous + 2,
    stopped,
  );
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  const menu = page.getByRole("dialog", { name: "Game menu", exact: true });
  await menu.waitFor();
  const stoppedAgain = await pausedClock(page);
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  await page.waitForFunction(
    (previous) => window.__cyberfuseProbe!().tick! >= previous + 2,
    stoppedAgain,
  );
  console.log(
    "Solo campaign briefing, help, movement, shooting, cycling and map passed",
  );
}
async function pausedClock(page: Page) {
  return page.evaluate(async () => {
    const first = window.__cyberfuseProbe!().tick!;
    const until = performance.now() + 350;
    while (performance.now() < until) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (window.__cyberfuseProbe!().tick !== first)
        throw new Error("The solo clock advanced during inspection");
    }
    return first;
  });
}
async function keyboardCoop(page: Page) {
  await page.goto(address());
  await openPlayOptions(page, "single");
  const brief = page.getByRole("dialog", {
    name: "Single player",
    exact: true,
  });
  const secondPlayer = brief.getByRole("checkbox", {
    name: "Two players on this keyboard",
    exact: true,
  });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 360, height: 780 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(
      await secondPlayer.evaluate((input) => {
        const label = input.closest("label")!;
        const range = document.createRange();
        range.selectNodeContents(label.lastChild!);
        const text = range.getBoundingClientRect(),
          box = input.getBoundingClientRect();
        return (
          box.height <= 20 &&
          box.right < text.left &&
          Math.abs((box.top + box.bottom - text.top - text.bottom) / 2) <= 2
        );
      }),
      "shared-keyboard checkbox sits beside its label",
    );
  }
  await secondPlayer.check();
  await brief.getByRole("button", { name: "Deploy", exact: true }).click();
  await phase(page, "lobby");
  assert.ok(
    (await page
      .getByRole("group", { name: /^Player 2 loadout/ })
      .locator("input:checked")
      .count()) >= 2,
  );
  await page.getByRole("group", { name: /^Loadout/ }).waitFor();
  await page
    .getByRole("button", { name: "Start mission", exact: true })
    .click();
  await phase(page, "running");
  const first = await current(page);
  const second = await page.evaluate(
    (id) =>
      window.__cyberfuseProbe!().actors.find(
        (a) => a.seat !== null && a.seat !== id,
      ),
    first.seat,
  );
  assert.ok(second?.seat);
  await page.getByLabel("Cyberfuse mission", { exact: true }).focus();
  await walkKeyboard(page, first, [
    "ArrowRight",
    "ArrowDown",
    "ArrowLeft",
    "ArrowUp",
  ]);
  await walkKeyboard(page, second, ["KeyD", "KeyS", "KeyA", "KeyW"]);
  const shot = async (seat: string, key: string) => {
    const start = await page.evaluate(
      (id) =>
        window.__cyberfuseProbe!().actors.find((a) => a.seat === id)!.lastShot,
      seat,
    );
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(
        ({ seat, start }) =>
          window.__cyberfuseProbe!().actors.some(
            (a) => a.seat === seat && a.lastShot > start,
          ),
        { seat, start },
      );
    } finally {
      await page.keyboard.up(key);
    }
  };
  await shot(first.seat!, "Space");
  assert.equal(
    await page.evaluate(
      (id) =>
        window.__cyberfuseProbe!().actors.find((a) => a.seat === id)!.lastShot,
      second.seat,
    ),
    second.lastShot,
  );
  await shot(second.seat, "KeyF");
  await page.keyboard.press("KeyG", { delay: 140 });
  await page.waitForFunction(
    (old) =>
      window.__cyberfuseProbe!().actors.some(
        (a) => a.seat === old.seat && a.weapon !== old.weapon,
      ),
    second,
  );
  assert.equal((await current(page)).weapon, first.weapon);
  console.log(
    "Shared-keyboard co-op, both control sets and independent weapons passed",
  );
}
async function finishWithDynamite(page: Page, mode: "campaign" | "dogfight") {
  await page.goto(address());
  await openPlayOptions(page, "single");
  const brief = page.getByRole("dialog", {
    name: "Single player",
    exact: true,
  });
  await brief
    .getByRole("combobox", { name: "Game mode", exact: true })
    .selectOption(mode);
  if (mode === "dogfight") {
    await brief
      .getByRole("combobox", { name: "Arena", exact: true })
      .selectOption("0");
  } else {
    await brief
      .getByRole("combobox", { name: "Campaign", exact: true })
      .selectOption({ label: "Ogre Rampage" });
  }
  const guns = brief.locator("fieldset");
  // Choose dynamite through the armory; repeated point-blank blasts end a real round.
  const original = await guns
    .locator("label:has(input:checked)")
    .allTextContents();
  for (const name of original.slice(1))
    await guns.getByRole("checkbox", { name, exact: true }).click();
  await guns.getByRole("checkbox", { name: "Dynamite", exact: true }).click();
  await guns.getByRole("checkbox", { name: original[0]!, exact: true }).click();
  assert.deepEqual(
    await guns.locator("label:has(input:checked)").allTextContents(),
    ["Dynamite"],
  );
  await brief.getByRole("button", { name: "Deploy", exact: true }).click();
  await phase(page, "running");
  assert.equal(
    await page.getByRole("button", { name: "Map", exact: true }).isVisible(),
    mode === "campaign",
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
  if (mode === "campaign") {
    await page
      .locator(".fui-results-report")
      .getByText(/^Squad lost$/i)
      .waitFor();
  }
  const next = page.getByRole("button", {
    name: /^(next round|play again)\b/i,
  });
  await next.click();
  await phase(page, "running");
  const after = await page.evaluate(() => window.__cyberfuseProbe!().round);
  assert.ok(
    after === round + 1 || after === 1,
    "next round or rematch reset the playing state",
  );
  console.log(
    mode === "dogfight"
      ? "Dogfight loadout, a completed round and replay passed"
      : "Campaign defeat report and rematch passed",
  );
}
async function online(host: Page, peer: Page, tv: Page, extra: Page[]) {
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
  await peer.locator(".fui-roster-name", { hasText: "Ada" }).waitFor();
  await takeHostSeat(peer, "Bo");
  await host.locator(".fui-roster-name", { hasText: "Bo" }).waitFor();
  for (const [index, page] of extra.entries()) {
    const name = "Operative " + (index + 3);
    await page.goto(address("room=" + code));
    await page.locator(".fui-roster-name", { hasText: "Ada" }).waitFor();
    await takeHostSeat(page, name);
    await host.locator(".fui-roster-name", { hasText: name }).waitFor();
  }
  await host.getByRole("checkbox", { name: /^Shared TV/ }).check();
  await tv.goto(address("room=" + code + "&display=1"));
  await phase(tv, "lobby");
  await host
    .getByRole("button", { name: "Start mission", exact: true })
    .click();
  const players = [host, peer, ...extra];
  await Promise.all([...players, tv].map((p) => phase(p, "running")));
  for (const page of [...players, tv]) {
    const seats = await page.evaluate(() =>
      window.__cyberfuseProbe!()
        .actors.map((a) => a.seat)
        .filter(Boolean),
    );
    assert.equal(new Set(seats).size, 6);
  }
  await Promise.all(extra.map(hashAgreement));
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
  const map = peer.getByRole("button", { name: "Map", exact: true });
  const [mapBounds, topBarBounds] = await Promise.all([
    map.boundingBox(),
    peer.locator(".fui-top-bar").boundingBox(),
  ]);
  assert.ok(
    mapBounds &&
      topBarBounds &&
      mapBounds.y >= topBarBounds.y + topBarBounds.height,
    "the whole landscape Map button sits below the top bar",
  );
  await peer.screenshot({ path: "artifacts/cyberfuse-landscape-map-button.png" });
  peer.on("console", message => {
    if (message.text().startsWith("MAP-PROBE")) console.log(message.text());
  });
  await map.evaluate(node => {
    const trace = (value: unknown) => console.log("MAP-PROBE", JSON.stringify(value));
    const r = node.getBoundingClientRect();
    trace({ map: r.toJSON(), viewport: { width: visualViewport?.width, height: visualViewport?.height, scale: visualViewport?.scale }, hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.outerHTML.slice(0, 180) });
    for (const name of ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "touchcancel", "click"]) {
      document.addEventListener(name, event => {
        const target = event.target instanceof Element ? event.target : null;
        trace({name, target:target?.outerHTML.slice(0, 100), x: event instanceof MouseEvent ? event.clientX : null, y: event instanceof MouseEvent ? event.clientY : null, expanded:node.getAttribute("aria-expanded")});
      }, true);
    }
    new MutationObserver(() => trace({changed:node.getAttribute("aria-expanded")})).observe(node,{attributes:true,attributeFilter:["aria-expanded"]});
  });
  await map.tap();
  await peer.getByRole("button", { name: "Close map", exact: true }).waitFor();
  await peer.screenshot({ path: "artifacts/cyberfuse-landscape-map-open.png" });
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
    "Six seated browsers plus TV, touch movement, phone landscape and post-reconnect hash convergence passed",
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
  const extra = await Promise.all(
    Array.from({ length: 4 }, () =>
      browser.newPage({ viewport: { width: 480, height: 360 } }),
    ),
  );
  const pages = [host, peer, tv, arena, ...extra];
  const coverage = await Promise.all(
    pages.map((page) => startGameCoverage(page, { gameId: "cyberfuse" })),
  );
  for (const p of pages) {
    p.setDefaultTimeout(15000);
    p.on("pageerror", (e) => errors.push(e.message));
  }
  await Promise.all([
    finishWithDynamite(arena, "dogfight").then(() =>
      finishWithDynamite(arena, "campaign"),
    ),
    solo(host)
      .then(() => keyboardCoop(host))
      .then(() => online(host, peer, tv, extra)),
  ]);
  assert.deepEqual(errors, []);
  await Promise.all(coverage.map((finish) => finish()));
} catch (error) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      const summary = await page
        .evaluate(() => {
          const probe = window.__cyberfuseProbe?.();
          return {
            path: location.pathname,
            phase: probe?.phase,
            tick: probe?.tick,
            checks: probe?.hashChecks,
            mismatches: probe?.mismatches,
            actors: probe?.actors
              .filter((a) => a.seat !== null)
              .map((a) => ({ hp: a.hp, weapon: a.weapon })),
            visibleText: document.body.innerText.slice(-1000),
          };
        })
        .catch(() => null);
      console.error("Cyberfuse browser at failure", summary);
    }
  }
  throw error;
} finally {
  await browser.close();
}
