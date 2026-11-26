/**
 * Screenshots real play at 390×844 and 844×390. Each phone case fails if its
 * field does not cover the viewport edge to edge, the page scrolls, a visible
 * primary control is clipped, or the game or capture raises an error.
 *
 *   pnpm build && pnpm exec tsx scripts/phone-play-audit.ts
 *   pnpm exec tsx scripts/phone-play-audit.ts fuseball ball-bros
 *   AUDIT_DESKTOP=1 pnpm exec tsx scripts/phone-play-audit.ts  # also record desktop
 *   AUDIT_OUT=artifacts/before pnpm exec tsx scripts/phone-play-audit.ts
 *   AUDIT_URL=http://localhost:8787/ pnpm exec tsx scripts/phone-play-audit.ts
 *
 * Desktop observations are informational. Chromium touch emulation does not
 * exercise real browser bars or operating-system gesture regions.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { gamePagePath } from "../packages/fuse-ui/src/game-path.js";
import { launchSelected } from "./lib/browser.js";
import {
  PHONE_PLAY_GAME_IDS,
  PHONE_PLAY_RECIPES,
  PHONE_PLAY_SURFACES,
} from "./lib/phone-play-cases.js";
import { startRoomService } from "./lib/server.js";

const VIEWPORTS = {
  portrait: { width: 390, height: 844 },
  landscape: { width: 844, height: 390 },
  ...(process.env.AUDIT_DESKTOP
    ? { desktop: { width: 1440, height: 900 } }
    : {}),
} as const;

const TOLERANCE = 1;
const NOTICE = "Dismiss controls";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CaseResult {
  reachedPlay: boolean;
  field?: Bounds;
  board?: Bounds;
  cover?: number;
  fit?: number;
  scrolls?: boolean;
  controlsObserved?: number;
  clippedControls?: string[];
  failures: string[];
}

function detail(error: unknown): string {
  return String(error).split("\n").slice(0, 7).join("\n");
}

const wanted = process.argv.slice(2);
const unknown = wanted.filter((id) => !PHONE_PLAY_GAME_IDS.includes(id));
if (unknown.length > 0)
  throw new Error(`Unknown browser game: ${unknown.join(", ")}`);

const ids = wanted.length > 0 ? wanted : PHONE_PLAY_GAME_IDS;
const out = process.env.AUDIT_OUT ?? "artifacts/phone-play-audit";
await mkdir(out, { recursive: true });
const server = process.env.AUDIT_URL ? undefined : await startRoomService();
const root = (process.env.AUDIT_URL ?? server?.url ?? "").replace(/\/?$/, "/");
const report: Record<string, Record<string, CaseResult>> = {};
let phoneFailures = 0;

try {
  const browser = await launchSelected("chromium");
  try {
    for (const id of ids) {
      report[id] = {};
      const surface = PHONE_PLAY_SURFACES[id];
      const recipe = PHONE_PLAY_RECIPES[id];
      for (const [name, viewport] of Object.entries(VIEWPORTS)) {
        const phone = name !== "desktop";
        const result: CaseResult = { reachedPlay: false, failures: [] };
        report[id][name] = result;
        if (!surface || !recipe) {
          result.failures.push("Missing gameplay recipe or field selector");
        } else {
          const context = await browser.newContext({
            viewport,
            hasTouch: phone,
            isMobile: phone,
            deviceScaleFactor: 2,
          });
          try {
            const page = await context.newPage();
            page.setDefaultTimeout(20_000);
            page.on("pageerror", (error) => {
              result.failures.push(`Page error: ${error.message}`);
            });
            try {
              const response = await page.goto(
                new URL(`${gamePagePath(id)}?mute`, root).href,
              );
              if (!response?.ok())
                throw new Error(
                  `Game page returned ${response?.status() ?? "no response"}`,
                );
              await recipe(page);
              const field = page
                .locator(surface.field)
                .filter({ visible: true })
                .first();
              await field.waitFor();
              const guide = page.getByRole("button", {
                name: NOTICE,
                exact: true,
              });
              if (await guide.isVisible()) await guide.click();

              const measure = await field.evaluate(
                async (
                  node,
                  { boardSelector, controls, tolerance, expected },
                ) => {
                  const board = boardSelector
                    ? document.querySelector(boardSelector)
                    : null;
                  const targets = controls
                    ? [...document.querySelectorAll(controls)].filter(
                        (target) =>
                          target.checkVisibility({
                            opacityProperty: true,
                            visibilityProperty: true,
                          }),
                      )
                    : [];
                  // Use the browser's actual clipping rules. A fixed-position
                  // stage can legally escape an ancestor's overflow clip.
                  const entries = await new Promise<
                    IntersectionObserverEntry[]
                  >((resolve) => {
                    const observed: IntersectionObserverEntry[] = [];
                    const elements = new Set([node, ...targets]);
                    if (board) elements.add(board);
                    const observer = new IntersectionObserver((entries) => {
                      observed.push(...entries);
                      if (observed.length < elements.size) return;
                      observer.disconnect();
                      resolve(observed);
                    });
                    for (const element of elements) observer.observe(element);
                  });
                  const viewport = { width: innerWidth, height: innerHeight };
                  const fieldEntry = entries.find(
                    (entry) => entry.target === node,
                  );
                  if (!fieldEntry)
                    throw new Error("Missing playfield geometry");
                  const bounds = fieldEntry.boundingClientRect;
                  const field = {
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                  };
                  const { width, height } = fieldEntry.intersectionRect;
                  const area = width * height;
                  const aspect = bounds.width / bounds.height;
                  const ideal = Math.min(
                    viewport.width ** 2 / aspect,
                    viewport.height ** 2 * aspect,
                  );
                  const root = document.scrollingElement;
                  const scrolls =
                    !!scrollX ||
                    !!scrollY ||
                    (!!root &&
                      (root.scrollWidth > viewport.width + tolerance ||
                        root.scrollHeight > viewport.height + tolerance));
                  // Compare signed edges, so a field extending outside the screen fails too.
                  const fieldFits =
                    node.checkVisibility({
                      opacityProperty: true,
                      visibilityProperty: true,
                    }) &&
                    width >= bounds.width - tolerance &&
                    height >= bounds.height - tolerance &&
                    Math.abs(bounds.left) <= tolerance &&
                    Math.abs(bounds.top) <= tolerance &&
                    Math.abs(bounds.right - viewport.width) <= tolerance &&
                    Math.abs(bounds.bottom - viewport.height) <= tolerance;
                  const expectedViewport =
                    viewport.width === expected.width &&
                    viewport.height === expected.height;
                  const boardEntry = entries.find(
                    (entry) => entry.target === board,
                  );
                  const boardRect = boardEntry?.boundingClientRect;
                  const boardBounds = boardRect && {
                    x: boardRect.x,
                    y: boardRect.y,
                    width: boardRect.width,
                    height: boardRect.height,
                  };
                  const boardFits =
                    !boardSelector ||
                    (!!boardEntry &&
                      !!board?.checkVisibility({
                        opacityProperty: true,
                        visibilityProperty: true,
                      }) &&
                      boardEntry.isIntersecting &&
                      boardEntry.intersectionRect.width >=
                        boardEntry.boundingClientRect.width - tolerance &&
                      boardEntry.intersectionRect.height >=
                        boardEntry.boundingClientRect.height - tolerance);
                  const clippedControls: string[] = [];
                  let controlsObserved = 0;
                  for (const entry of entries) {
                    const {
                      target: control,
                      boundingClientRect: rect,
                      intersectionRect,
                    } = entry;
                    if (control === node || control === board) continue;
                    if (rect.width === 0 || rect.height === 0) continue;
                    controlsObserved++;
                    const clipped =
                      rect.left < -tolerance ||
                      rect.top < -tolerance ||
                      rect.right > viewport.width + tolerance ||
                      rect.bottom > viewport.height + tolerance ||
                      intersectionRect.width < rect.width - tolerance ||
                      intersectionRect.height < rect.height - tolerance;
                    if (clipped)
                      clippedControls.push(
                        control.getAttribute("aria-label") ??
                          control.textContent?.trim() ??
                          control.tagName,
                      );
                  }
                  return {
                    field,
                    board: boardBounds,
                    boardFits,
                    cover: +(area / (viewport.width * viewport.height)).toFixed(
                      3,
                    ),
                    fit: +Math.min(1, area / ideal).toFixed(3),
                    scrolls,
                    controlsObserved,
                    clippedControls,
                    fieldFits,
                    expectedViewport,
                  };
                },
                {
                  boardSelector: surface.board,
                  controls: surface.controls,
                  tolerance: TOLERANCE,
                  expected: viewport,
                },
              );
              const {
                fieldFits,
                boardFits,
                expectedViewport,
                ...observations
              } = measure;
              Object.assign(result, observations);
              result.reachedPlay = true;
              if (!expectedViewport)
                result.failures.push(
                  "Page did not use the requested CSS viewport",
                );
              if (!fieldFits)
                result.failures.push(
                  "Playfield does not meet every viewport edge within 1 CSS pixel",
                );
              if (!boardFits)
                result.failures.push("Interactive board is missing or clipped");
              if (result.scrolls)
                result.failures.push("Gameplay document scrolls");
              if (measure.clippedControls.length > 0)
                result.failures.push(
                  `Clipped controls: ${measure.clippedControls.join(", ")}`,
                );
            } catch (error) {
              result.failures.push(detail(error));
            }
            await page
              .screenshot({ path: `${out}/${id}-${name}.png` })
              .catch((error: unknown) => {
                result.failures.push(`Screenshot failed: ${detail(error)}`);
              });
          } finally {
            await context.close();
          }
        }
        if (phone && result.failures.length > 0) phoneFailures++;
        console.log(`${id} ${name} ${JSON.stringify(result)}`);
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  await server?.stop();
  await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
}
if (phoneFailures) {
  console.error(
    `${phoneFailures} phone gameplay case(s) failed. See ${out}/report.json`,
  );
  process.exitCode = 1;
}
