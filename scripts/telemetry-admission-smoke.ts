import assert from "node:assert/strict";
import { chromium } from "playwright";

// Exercise the real Vite-served browser adapter without sending data to a service.
const origin = process.env.HOME_URL ?? "http://127.0.0.1:4193";
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
try {
  const context = await browser.newContext();
  let release!: () => void, seen!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const admitted = new Promise<void>((resolve) => {
    seen = resolve;
  });
  let issues = 0,
    delivered = 0,
    hold = true;
  await context.route("**/telemetry-admission-harness*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Telemetry test</title>",
    }),
  );
  await context.route("**/api/telemetry/session", async (route) => {
    issues++;
    if (hold) {
      seen();
      await held;
    }
    await route.fulfill({
      json: { token: `${Date.now() + 3600_000}.test.signature` },
    });
  });
  await context.route("**/api/telemetry/events", async (route) => {
    delivered++;
    const body = route.request().postDataJSON() as { events: { id: string }[] };
    await route.fulfill({
      json: { acknowledgedIds: body.events.map((event) => event.id) },
    });
  });
  const page = await context.newPage();
  await page.goto(`${origin}/telemetry-admission-harness?analytics=1&mute`);
  await page.addScriptTag({
    type: "module",
    content: `import { createBrowserAnalytics } from '/packages/fuse-ui/src/analytics.ts'; window.makeAnalytics = createBrowserAnalytics;`,
  });
  await page.waitForFunction(
    () => typeof Reflect.get(window, "makeAnalytics") === "function",
  );
  await page.evaluate(() => {
    const make = Reflect.get(window, "makeAnalytics");
    const analytics = make("dice");
    Reflect.set(window, "testAnalytics", analytics);
    analytics.start({});
    analytics.track("App Opened");
  });
  await admitted;
  await page.evaluate(() =>
    Reflect.get(window, "testAnalytics").setOptOut(true),
  );
  hold = false;
  release();
  await page.waitForTimeout(500);
  assert.equal(delivered, 0, "no event is sent after opt-out during admission");
  const firstDelivery = page.waitForResponse(
    (response) => response.url().endsWith("/api/telemetry/events"),
    { timeout: 15000 },
  );
  await page.evaluate(() => {
    const analytics = Reflect.get(window, "testAnalytics");
    analytics.setOptOut(false);
    analytics.track("App Opened");
  });
  await firstDelivery;
  const before = issues;
  await page.reload();
  await page.addScriptTag({
    type: "module",
    content: `import { createBrowserAnalytics } from '/packages/fuse-ui/src/analytics.ts'; window.makeAnalytics = createBrowserAnalytics;`,
  });
  await page.waitForFunction(
    () => typeof Reflect.get(window, "makeAnalytics") === "function",
  );
  const secondDelivery = page.waitForResponse(
    (response) => response.url().endsWith("/api/telemetry/events"),
    { timeout: 15000 },
  );
  await page.evaluate(() => {
    const analytics = Reflect.get(window, "makeAnalytics")("dice");
    analytics.start({});
    analytics.track("App Opened");
  });
  await secondDelivery;
  assert.equal(issues, before, "reload reuses unexpired admission");
  assert.ok(delivered >= 2, "events were delivered after consent returned");
  await page.evaluate(() => {
    const analytics = Reflect.get(window, "makeAnalytics")("dice");
    analytics.setOptOut(true);
  });
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("fuse-metrics-admission")),
    null,
  );
  console.log("Telemetry consent and admission reuse passed");
} finally {
  await browser.close();
}
