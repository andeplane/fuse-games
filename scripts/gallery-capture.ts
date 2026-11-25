/**
 * Captures the gallery card image of a game from real play: `public/gallery/<id>.jpg`, the file a game's
 * `portal.json` names as its `screenshot`.
 *
 *   pnpm build && pnpm gallery:capture            # every game with a recipe below
 *   pnpm gallery:capture fuseball ball-bros       # only these
 *   GALLERY_URL=http://localhost:8787/ pnpm gallery:capture fuseball   # against a service already running
 *
 * Each recipe drives the game's own menus into a solo or bot match, with no state injection, and plays for a moment so
 * the frame shows the game rather than its first tick. Pages open muted. Run by hand; not in CI: a capture is a
 * picture someone looks at before committing it, and `tests/gallery-screenshots.test.ts` is what keeps a game from
 * shipping without one.
 */
import { mkdir } from "node:fs/promises";
import { launchSelected } from "./lib/browser.js";
import { RECIPES } from "./lib/play-recipes.js";
import { startRoomService } from "./lib/server.js";

// A carousel adds the game's real front door and controls alongside its gameplay cover.
// Captures use agent-browser; run this mode against Vite to refresh from source without a build.
if (process.argv.includes("--carousel")) {
  const { captureCarousel } = await import("./lib/gallery-carousel.js");
  await captureCarousel(
    process.argv.slice(2).filter((arg) => arg !== "--carousel"),
  );
  process.exit(0);
}

/** The card's image: 1200 pixels wide, as `public/gallery/README.md` asks, at the catalog's 16:10. */
const VIEWPORT = { width: 1200, height: 750 };
const JPEG_QUALITY = 84;

const wanted = process.argv.slice(2);
const unknown = wanted.filter((id) => !(id in RECIPES));
if (unknown.length > 0)
  throw new Error(
    `No capture recipe for ${unknown.join(", ")}; scripts/lib/play-recipes.ts has ${Object.keys(RECIPES).join(", ")}`,
  );
const ids = wanted.length > 0 ? wanted : Object.keys(RECIPES);

const server = process.env.GALLERY_URL ? undefined : await startRoomService();
// A base with a path (GitHub Pages) needs its trailing slash, or `new URL` drops the last segment.
const root = (process.env.GALLERY_URL ?? server?.url ?? "").replace(
  /\/?$/,
  "/",
);
const browser = await launchSelected("chromium");
const failed: string[] = [];
try {
  await mkdir("public/gallery", { recursive: true });
  for (const id of ids) {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    try {
      await page.goto(new URL(`${id.replaceAll("-", "")}/?mute`, root).href);
      await RECIPES[id]?.(page);
      const path = `public/gallery/${id}.jpg`;
      await page.screenshot({ path, type: "jpeg", quality: JPEG_QUALITY });
      console.log(`Captured ${path}`);
    } catch (error) {
      failed.push(id);
      console.error(`${id}: ${error instanceof Error ? error.message : error}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server?.stop();
}
if (failed.length > 0) {
  console.error(`No capture for ${failed.join(", ")}`);
  process.exitCode = 1;
}
