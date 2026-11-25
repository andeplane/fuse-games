import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContextOptions,
  type LaunchOptions,
  type Page,
} from "playwright";
import { smokeTimeout } from "../smoke-timeout.js";

/**
 * The one place a browser script chooses its engine.
 *
 * `chrome` is the installed Google Chrome channel (hardware GL, what the renderer smokes measure),
 * `chromium` is Playwright's bundled build; `firefox` and `webkit` are its other engines. These are different
 * `pnpm exec playwright install` targets, which is why `scripts/ci-manifest.json` names them per smoke and
 * `tests/ci-manifest.test.ts` compares that list with the calls below found in each script.
 */
export type BrowserKind = "chrome" | "chromium" | "firefox" | "webkit";

/** `BROWSER=webkit` selects WebKit; anything else keeps the script's own Chromium flavour. */
export function browserKind(
  fallback: "chrome" | "chromium",
  env: NodeJS.ProcessEnv = process.env,
): BrowserKind {
  return env.BROWSER === "webkit" ? "webkit" : fallback;
}

export function launchBrowser(
  kind: BrowserKind,
  options: LaunchOptions = {},
): Promise<Browser> {
  if (kind === "webkit") return webkit.launch(options);
  if (kind === "firefox") return firefox.launch(options);
  return chromium.launch({
    ...options,
    ...(kind === "chrome" ? { channel: "chrome" } : {}),
  });
}

/** Launch the engine `BROWSER` selects. */
export const launchSelected = (
  fallback: "chrome" | "chromium",
  options: LaunchOptions = {},
): Promise<Browser> => launchBrowser(browserKind(fallback), options);

/**
 * For a smoke that always covers both engines in one run. `name` is the label its reports and
 * screenshots have always used ("chrome" for the bundled Chromium); `kind` is what is launched.
 */
export const BOTH_ENGINES = [
  { name: "chrome", kind: "chromium" },
  { name: "webkit", kind: "webkit" },
] as const satisfies ReadonlyArray<{ name: string; kind: BrowserKind }>;

/** Create a page that owns its isolated context and uses the smoke timeout scale. */
export async function newSmokePage(
  browser: Browser,
  options: BrowserContextOptions,
  timeout: number,
): Promise<Page> {
  const page = await browser.newPage(options);
  page.setDefaultTimeout(smokeTimeout(timeout));
  return page;
}

/** Simulate rotation or a new viewport after the game's first-tap fullscreen transition. */
export async function resizeSmokeViewport(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  const current = page.viewportSize();
  if (current?.width === viewport.width && current.height === viewport.height)
    return;
  // Chromium rejects synthetic window resizes while native fullscreen is active.
  await page.evaluate(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
  });
  await page.setViewportSize(viewport);
}
