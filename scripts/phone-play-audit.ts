/**
 * Measures how much of a phone's screen each game gives its playfield during real play, and takes a picture of it.
 *
 *   pnpm build && pnpm exec tsx scripts/phone-play-audit.ts              # every game with a recipe
 *   pnpm exec tsx scripts/phone-play-audit.ts fuseball ball-bros         # only these
 *   AUDIT_OUT=artifacts/before pnpm exec tsx scripts/phone-play-audit.ts # where the pictures and report.json go
 *   AUDIT_URL=http://localhost:8787/ pnpm exec tsx scripts/phone-play-audit.ts   # against a running service
 *
 * Each game is driven into a match by its recipe in `scripts/lib/play-recipes.ts` on an emulated touch phone, upright
 * and on its side. The report gives, per game and orientation: `fit`, the playfield's area over the largest area its
 * own aspect ratio could take on that screen (1 is "as big as it can be"); `cover`, its share of the screen; and
 * whether the page scrolls. Emulation is not a physical phone: no browser bars, no notch. Run by hand; not in CI.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { launchSelected } from "./lib/browser.js";
import { AUDIT_RECIPES, RECIPES as GALLERY } from "./lib/play-recipes.js";
import { startRoomService } from "./lib/server.js";

const VIEWPORTS = {
  portrait: { width: 390, height: 844 },
  landscape: { width: 844, height: 390 },
  ...(process.env.AUDIT_DESKTOP
    ? { desktop: { width: 1440, height: 900 } }
    : {}),
} as const;

interface Measure {
  fit: number;
  cover: number;
  scrolls: boolean;
  field: { x: number; y: number; width: number; height: number } | null;
}

/** Source text: a function compiled by tsx carries helpers the page does not have. */
const MEASURE = `(() => {
  const vw = innerWidth, vh = innerHeight;
  let best = null, bestArea = 0;
  for (const node of document.querySelectorAll("canvas, [data-playfield]")) {
    const r = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none" || +style.opacity === 0) continue;
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if (w * h > bestArea) { bestArea = w * h; best = { x: r.left, y: r.top, width: r.width, height: r.height, w, h }; }
  }
  const root = document.scrollingElement;
  const scrolls = root.scrollHeight > vh + 1 || root.scrollWidth > vw + 1;
  if (!best) return { fit: 0, cover: 0, scrolls, field: null };
  const aspect = best.width / best.height;
  const most = aspect > vw / vh ? (vw * vw) / aspect : vh * vh * aspect;
  return {
    fit: +(bestArea / most).toFixed(3),
    cover: +(bestArea / (vw * vh)).toFixed(3),
    scrolls,
    field: { x: Math.round(best.x), y: Math.round(best.y), width: Math.round(best.width), height: Math.round(best.height) },
  };
})()`;

const RECIPES = { ...GALLERY, ...AUDIT_RECIPES };
const wanted = process.argv.slice(2);
const unknown = wanted.filter((id) => !(id in RECIPES));
if (unknown.length > 0)
  throw new Error(
    `No play recipe for ${unknown.join(", ")}; scripts/lib/play-recipes.ts has ${Object.keys(RECIPES).join(", ")}`,
  );
const ids = wanted.length > 0 ? wanted : Object.keys(RECIPES);
const out = process.env.AUDIT_OUT ?? "artifacts/phone-play-audit";

const server = process.env.AUDIT_URL ? undefined : await startRoomService();
const root = (process.env.AUDIT_URL ?? server?.url ?? "").replace(/\/?$/, "/");
const browser = await launchSelected("chromium");
const report: Record<string, Record<string, Measure | { error: string }>> = {};
try {
  await mkdir(out, { recursive: true });
  for (const id of ids) {
    report[id] = {};
    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      const phone = name !== "desktop";
      const context = await browser.newContext({
        viewport,
        hasTouch: phone,
        isMobile: phone,
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(40_000);
      try {
        await page.goto(new URL(`${id.replaceAll("-", "")}/?mute`, root).href);
        await RECIPES[id]?.(page);
        report[id][name] = (await page.evaluate(MEASURE)) as Measure;
      } catch (error) {
        report[id][name] = {
          error: (error instanceof Error ? error.message : String(error))
            .split("\n")[0]!
            .slice(0, 200),
        };
      }
      await page
        .screenshot({ path: `${out}/${id}-${name}.png` })
        .catch(() => undefined);
      console.log(`${id} ${name} ${JSON.stringify(report[id][name])}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server?.stop();
}
await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
