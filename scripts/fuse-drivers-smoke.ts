import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchSelected } from "./lib/browser.js";
import type { Page } from "playwright";

interface RaceProbe {
  mode?: string;
  theme?: string;
  held?: (string | null)[];
  bombs?: number;
  phase?: string;
  track?: string;
  tick: number;
  hashChecks: number;
  mismatches: number;
  trucks?: { x: number; y: number; nitros: number; tires?: number }[];
}

declare global {
  interface Window {
    __driversRaceProbe?: () => RaceProbe;
  }
}

async function renderedArena(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".fd-arena");
    if (canvas?.dataset.ready !== "true") return false;
    const box = canvas.getBoundingClientRect();
    return box.width > innerWidth * 0.6 && box.bottom <= innerHeight;
  });
}

const origin = process.env.ONLINE_URL ?? "http://localhost:8797/";
const browser = await launchSelected("chrome");
const failures: string[] = [];
await mkdir("artifacts/fuse-drivers", { recursive: true });
const contexts = await Promise.all([
  browser.newContext({ viewport: { width: 1440, height: 900 } }),
  browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  }),
  browser.newContext({ viewport: { width: 1440, height: 900 } }),
]);
try {
  const host = await contexts[0]!.newPage();
  const peer = await contexts[1]!.newPage();
  const tv = await contexts[2]!.newPage();
  for (const page of [host, peer, tv])
    page.on("pageerror", (error) => failures.push(error.message));
  await host.goto(new URL("fuse-drivers/?mute", origin).href);
  await host.getByRole("button", { name: "Fuse games", exact: true }).click();
  await host.getByRole("link", { name: /Fuse Drivers/ }).click();
  assert.equal(new URL(host.url()).searchParams.has("mute"), true);
  await host.goto(new URL("fuse-drivers/?solo=1&mute&probe", origin).href);
  const rules = host.getByLabel("Rules", { exact: true });
  assert.equal(await rules.inputValue(), "classic");
  const graphics = host.getByLabel("Graphics", { exact: true });
  await graphics.selectOption("classic");
  const classicPreview = await host
    .getByRole("button", { name: "Wipeout", exact: true })
    .locator("img")
    .getAttribute("src");
  await graphics.selectOption("fuse");
  assert.notEqual(
    await host
      .getByRole("button", { name: "Wipeout", exact: true })
      .locator("img")
      .getAttribute("src"),
    classicPreview,
  );
  await host.getByRole("button", { name: "Wipeout", exact: true }).click();
  await host.getByLabel("Direction", { exact: true }).selectOption("-reverse");
  await host.getByLabel("Races", { exact: true }).selectOption("1");
  await host.getByRole("button", { name: "Remove CPU 4" }).click();
  await host.getByRole("button", { name: "START RACE", exact: true }).click();
  await host.locator(".fui-round-controls").waitFor({ state: "visible" });
  const centered = await host
    .locator(".fd-arena-box > .fui-round-controls")
    .evaluate((guide) => {
      const box = guide.parentElement!.getBoundingClientRect();
      const hint = guide.getBoundingClientRect();
      return (
        Math.abs(hint.top + hint.height / 2 - box.top - box.height / 2) < 2 &&
        Math.abs(hint.left + hint.width / 2 - box.left - box.width / 2) < 2
      );
    });
  assert.ok(
    centered,
    "the desktop countdown guide sits in the middle of the track",
  );
  await host.waitForFunction(() => {
    const race = window.__driversRaceProbe?.();
    return race?.track === "offroad-7-reverse" && race.trucks?.length === 3;
  });
  assert.equal(await host.locator(".fd-pad").isVisible(), false);
  assert.equal(
    await host
      .locator(".fui-round-controls")
      .innerText()
      .then((text) => text.includes("Battle item")),
    false,
  );
  await host.locator(".fd-hud").filter({ hasText: "LAP" }).waitFor();
  await host.locator(".fd-arena").waitFor({ state: "visible" });
  await renderedArena(host);
  await host.screenshot({ path: "artifacts/fuse-drivers/solo.png" });
  await host.goto(new URL("fuse-drivers/?mute", origin).href);
  await openPlayOptions(host);
  await host.getByRole("button", { name: "Host room", exact: true }).click();
  await host.waitForURL(/room=/);
  const code = new URL(host.url()).searchParams.get("room")!;
  await takeHostSeat(host, "Ada");
  await peer.goto(
    new URL(`fuse-drivers/?room=${code}&mute&probe`, origin).href,
  );
  await peer.locator(".fui-roster-name", { hasText: "Ada" }).waitFor();
  await takeHostSeat(peer, "Bo");
  await host.locator(".fui-roster-name", { hasText: "Bo" }).waitFor();
  await rules.selectOption("battle");
  const guestRules = peer.getByLabel("Rules", { exact: true });
  await peer.waitForFunction(
    () =>
      document.querySelector<HTMLSelectElement>('select[aria-label="Rules"]')
        ?.value === "battle",
  );
  assert.equal(await guestRules.isDisabled(), true);
  await peer.getByLabel("Graphics", { exact: true }).selectOption("classic");
  assert.equal(await graphics.inputValue(), "fuse");
  if (process.env.OFFROAD_CAMPAIGN_SMOKE === "1") {
    await host
      .getByRole("button", { name: /^add ai$/i })
      .first()
      .click();
    await host.locator(".fui-roster-name", { hasText: "CPU" }).waitFor();
  }
  // Shared TV is the room's choice: the host ticks it in the room, and the button beside it opens the screen.
  await host.getByRole("checkbox", { name: /^Shared TV/ }).check();
  await host
    .getByRole("button", { name: "OPEN TV SCREEN", exact: true })
    .waitFor();
  await tv.goto(
    new URL(`fuse-drivers/?room=${code}&display=1&mute&probe`, origin).href,
  );
  await host.screenshot({ path: "artifacts/fuse-drivers/room-lobby.png" });
  await host.getByRole("button", { name: "START RACE", exact: true }).click();
  await Promise.all(
    [host, peer].map((page) =>
      page.locator(".fd-hud").filter({ hasText: "LAP" }).waitFor(),
    ),
  );
  await tv.locator(".fd-arena").waitFor({ state: "visible" });
  await renderedArena(tv);
  await host.locator(".fd-arena").waitFor({ state: "hidden" });
  await peer.locator(".fd-arena").waitFor({ state: "hidden" });
  await tv.locator(".fd-pad").waitFor({ state: "hidden" });
  await peer.waitForFunction(
    () => window.__driversRaceProbe?.().phase === "racing",
  );
  await peer.getByRole("button", { name: "ITEM", exact: true }).tap();
  await tv.waitForFunction(
    () => window.__driversRaceProbe?.().held?.[1] === null,
  );
  await host.keyboard.press("e");
  await tv.waitForFunction(
    () => window.__driversRaceProbe?.().held?.[0] === null,
  );
  const start = await tv.evaluate(
    () => window.__driversRaceProbe?.().trucks?.[1],
  );
  assert.ok(start, "the TV has the second driver's grid position");
  const gas = peer.getByRole("button", { name: "GAS", exact: true });
  await gas.hover();
  await peer.mouse.down();
  try {
    await tv.waitForFunction(({ x, y }) => {
      const truck = window.__driversRaceProbe?.().trucks?.[1];
      return !!truck && (truck.x !== x || truck.y !== y);
    }, start);
  } finally {
    await peer.mouse.up();
  }
  await peer.getByRole("button", { name: "NITRO", exact: true }).hover();
  await peer.mouse.down();
  try {
    await tv.waitForFunction(
      (stock) =>
        (window.__driversRaceProbe?.().trucks?.[1]?.nitros ?? stock) < stock,
      start.nitros,
    );
  } finally {
    await peer.mouse.up();
  }
  // Compare actual accepted game-state hashes after the controls have crossed the mesh.
  const checked = await peer.evaluate(
    () => window.__driversRaceProbe!().hashChecks,
  );
  await peer.waitForFunction(
    (n) => window.__driversRaceProbe!().hashChecks > n + 2,
    checked,
  );
  assert.equal(
    await peer.evaluate(() => window.__driversRaceProbe!().mismatches),
    0,
  );
  await peer.screenshot({ path: "artifacts/fuse-drivers/phone-race.png" });
  await host.screenshot({ path: "artifacts/fuse-drivers/room-race.png" });
  await tv.screenshot({ path: "artifacts/fuse-drivers/tv-race.png" });
  await peer.reload();
  await peer.locator(".fd-hud").filter({ hasText: "LAP" }).waitFor();
  assert.equal(
    await peer.evaluate(() => window.__driversRaceProbe?.().theme),
    "classic",
  );
  assert.equal(
    await peer.getByPlaceholder("Your name").isVisible(),
    false,
    "the refreshed controller retains its existing seat",
  );
  assert.equal(
    await peer.locator(".fui-roster-name").filter({ hasText: "Bo" }).count(),
    1,
    "recovery does not duplicate the driver's roster row",
  );
  await peer.waitForFunction((stock) => {
    const state = window.__driversRaceProbe?.();
    return (
      !!state &&
      state.hashChecks >= 2 &&
      (state.trucks?.[1]?.nitros ?? stock) < stock
    );
  }, start.nitros);
  assert.equal(
    await peer.evaluate(() => window.__driversRaceProbe!().mismatches),
    0,
  );
  assert.deepEqual(failures, []);
  if (process.env.OFFROAD_CAMPAIGN_SMOKE === "1") {
    const shop = peer.getByRole("button", { name: "Speed shop", exact: true });
    await shop.waitFor({ timeout: 180000 });
    await shop.click();
    const tires = peer.getByRole("button", { name: /^Tires/i });
    await tires.click();
    await tires.filter({ hasText: "Level 1/5" }).waitFor();
    assert.equal(
      await tv.getByRole("button", { name: "Speed shop", exact: true }).count(),
      0,
    );
    await peer.screenshot({ path: "artifacts/fuse-drivers/phone-shop.png" });
    await host.getByRole("button", { name: /^NEXT RACE/i }).click();
    await Promise.all(
      [host, peer, tv].map((page) =>
        page.locator(".fui-round-controls").waitFor({ state: "visible" }),
      ),
    );
    await tv.waitForFunction(() => {
      const state = window.__driversRaceProbe?.();
      return state?.track === "offroad-7" && state.trucks?.[1]?.tires === 1;
    });
    await peer.reload();
    await peer.waitForFunction(() => {
      const state = window.__driversRaceProbe?.();
      return (
        state?.track === "offroad-7" &&
        state.trucks?.[1]?.tires === 1 &&
        state.hashChecks >= 2
      );
    });
    assert.equal(
      await peer.evaluate(() => window.__driversRaceProbe!().mismatches),
      0,
    );
    assert.deepEqual(failures, []);
    console.log(
      "Four laps, classified standings, guest purchase, next course and restored upgraded truck passed",
    );
  }
  console.log(
    "Fuse Drivers solo, portal, two-peer room and reload smoke passed",
  );
} catch (error) {
  for (const [index, context] of contexts.entries())
    for (const page of context.pages()) {
      console.error(`Drivers page ${index}: ${page.url()}`);
      console.error(await page.locator("body").innerText());
      await page.screenshot({
        path: `artifacts/fuse-drivers/failure-${index}.png`,
      });
    }
  throw error;
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
