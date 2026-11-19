import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchSelected } from "./lib/browser.js";
import { openRidersFixturePage } from "./lib/riders-fixture-page.js";
import { startViteServer } from "./lib/server.js";

// Isolated render contract checks; the real solo flow is captured separately.
const server = await startViteServer();
const browser = await launchSelected("chrome");
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await mkdir("artifacts", { recursive: true });
  await openRidersFixturePage(page, server.url);
  for (const backend of ["auto", "canvas"] as const) {
    console.log(
      await page.evaluate(async (backend) => {
        const { mountWorldArena, readArenaPixels, regionRgbDifference } =
          (await import(
            String("/scripts/lib/riders-render-fixture.ts")
          )) as typeof import("./lib/riders-render-fixture.js");
        const { visualFixture } = (await import(
          String("/scripts/lib/benchmark-fixture.ts")
        )) as typeof import("./lib/benchmark-fixture.js");
        const { themes } = (await import(
          String("/games/fuse-riders/src/render/themes.ts")
        )) as typeof import("../games/fuse-riders/src/render/themes.js");
        const { arena, canvas } = await mountWorldArena(backend);
        const renderer = arena.metrics().renderer;
        const base = {
          ...visualFixture(100),
          players: [],
          bombs: [],
          blasts: [],
          pickups: [],
          gravityFields: [],
          obstacles: [],
        };
        const pair = {
          id: "portal",
          expiresAtTick: 330,
          gates: [
            { x: 400, y: 450, halfLength: 100 },
            { x: 1200, y: 450, halfLength: 100 },
          ] as const,
        };
        const read = () => readArenaPixels(canvas, renderer);
        const regionDifference = arenaRegionDifference(canvas, renderer);
        for (const theme of Object.values(themes)) {
          const paint = (tick: number, portals = [pair]) => {
            arena.render(
              { ...base, tick, presentationTick: tick, portalPairs: portals },
              1000,
              theme,
              "portal-browser",
            );
            return read();
          };
          const forming = paint(115);
          const active = paint(130);
          const half = paint(230);
          for (const x of [400, 1200]) {
            if (regionDifference(forming, active, [x - 8, 360, 16, 180]) === 0)
              throw Error("Forming gate looks active");
            if (regionDifference(active, half, [x - 26, 327, 52, 10]) === 0)
              throw Error("Countdown did not shrink at both ends");
            if (regionDifference(active, half, [x - 8, 360, 16, 180]) !== 0)
              throw Error("Active gate faded as its lifetime elapsed");
          }
          const expired = paint(330);
          const empty = paint(330, []);
          if (!expired.every((value, index) => value === empty[index]))
            throw Error("Expired gates left graphics behind");
        }
        arena.destroy();
        return `${backend}: forming appearance, two countdown bars, solid active gates, expiry passed`;
      }, backend),
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.stop();
}
