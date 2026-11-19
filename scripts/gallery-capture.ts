import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
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
import type { Page } from "playwright";
import { launchSelected } from "./lib/browser.js";
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

/** Holds each key in turn for `ms`, so a rider moves about instead of standing where it spawned. */
async function hold(page: Page, keys: readonly string[], ms: number) {
  for (const key of keys) {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
  }
}

/**
 * Fusemania played by the page's own keys: each note's key goes down when the song reaches it, as a player's would.
 * Source text, because a function compiled by tsx carries helpers the page does not have.
 */
const FUSEMANIA_AUTOPLAY = `(() => {
  const hook = window.fusemania;
  const codes = ["KeyA", "KeyS", "KeyW", "KeyD"];
  const notes = hook.notes();
  const ups = [];
  let next = 0;
  const key = (type, code) =>
    document.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  const tick = () => {
    const ms = hook.clock().heardMs;
    while (ups.length && ups[0][0] <= ms) key("keyup", ups.shift()[1]);
    while (next < notes.length && notes[next][0] <= ms) {
      const [, column, kind] = notes[next++];
      if (kind === 3) continue;
      key("keydown", codes[column]);
      ups.push([ms + 90, codes[column]]);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

/** From the game's landing page (already open, muted) to a frame of play worth a card. */
type Recipe = (page: Page) => Promise<void>;

const RECIPES: Record<string, Recipe> = {
  "fuse-particles": async (page) => {
    await openPlayOptions(page, "single");
    await page.getByRole("button", { name: /^start match$/i }).click();
    await page.locator('.fuseParticles-room[data-phase="running"]').waitFor();
    await page.waitForFunction(() => {
      const clock =
        document.querySelector(".fp-match .fp-arena time")?.textContent ?? "";
      return /^0:[2-5][0-9]$/.test(clock);
    });
  },
  cyberfuse: async (page) => {
    await openPlayOptions(page, "single");
    const briefing = page.getByRole("dialog");
    await briefing
      .getByRole("combobox", { name: "Campaign" })
      .selectOption({ label: "Bug-Eyed Monsters" });
    await briefing.getByText("Mission password", { exact: true }).click();
    // This DOS solo password opens the second mission, a suburb with guards, courtyards and trees.
    await briefing.getByRole("textbox", { name: "Password" }).fill("hfelya");
    await briefing.getByRole("button", { name: "Use password" }).click();
    await briefing
      .getByRole("heading", { name: "What are they up to now?" })
      .waitFor();
    await briefing.getByText("Difficulty", { exact: true }).click();
    await briefing.locator("select[name=difficulty]").selectOption("easy");
    await briefing.locator("select[name=density]").selectOption("200");
    await briefing.locator("select[name=playerHp]").selectOption("200");
    await briefing
      .getByRole("checkbox", { name: "Flamer", exact: true })
      .check();
    await briefing
      .getByRole("checkbox", { name: "Machine gun", exact: true })
      .uncheck();
    await briefing
      .getByRole("checkbox", { name: "Shotgun", exact: true })
      .uncheck();
    await briefing.getByRole("button", { name: "Deploy", exact: true }).click();
    const arena = page
      .locator('.cyberfuse-room[data-phase="running"] canvas')
      .first();
    await arena.waitFor();
    // Rooms vary with the match seed. Play until the HUD records contact and a sizeable
    // stretch of visible terrain surrounds the player. Fire stays held through the capture.
    await page.keyboard.down("Space");
    for (const key of [
      "ArrowRight",
      "ArrowDown",
      "ArrowLeft",
      "ArrowDown",
      "ArrowRight",
      "ArrowUp",
      "ArrowRight",
      "ArrowDown",
    ]) {
      await hold(page, [key], 1000);
      const inAction = await arena.evaluate((canvas: HTMLCanvasElement) => {
        const hp = document.querySelector<HTMLMeterElement>(".cf-hud meter");
        if (!hp || hp.value >= hp.max || hp.value <= 0) return false;
        const small = document.createElement("canvas");
        small.width = 40;
        small.height = 25;
        const ctx = small.getContext("2d")!;
        ctx.drawImage(canvas, 0, 0, 40, 25);
        const pixels = ctx.getImageData(0, 0, 40, 25).data;
        let visible = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i]! > 23 || pixels[i + 1]! > 34 || pixels[i + 2]! > 42)
            visible++;
        return visible >= 730 || hp.value < hp.max * 0.3;
      });
      if (inAction) break;
    }
  },
  "fuse-drivers": async (page) => {
    await openPlayOptions(page, "single");
    await page.getByRole("button", { name: "START RACE", exact: true }).click();
    await page.locator('.fd-arena[data-ready="true"]').waitFor();
    await page.locator('[data-race="racing"]').waitFor();
    await hold(page, ["ArrowUp"], 1250);
    await page.waitForTimeout(900);
  },
  fusero: async (page) => {
    await openPlayOptions(page, "single");
    await page
      .getByRole("button", { name: "START MATCH", exact: true })
      .click();
    await page.locator('.liero-room[data-phase="running"]').waitFor();
    await page.waitForFunction(() =>
      document.querySelector(".liero-overlay")?.hasAttribute("hidden"),
    );
    await page.locator(".liero-arena canvas").click();
    const mac = await page.evaluate<boolean>(
      "window.fusero.keyboard().platform === 'mac'",
    );
    const fire = mac ? "AltLeft" : "ControlLeft";
    const jump = mac ? "MetaLeft" : "AltLeft";
    await page.keyboard.press(jump, { delay: 80 });
    await page.keyboard.down(fire);
    await page.keyboard.down("ArrowRight");
    await hold(page, ["ArrowLeft", "ArrowUp", "KeyX"], 700);
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up(fire);
  },
  "ball-bros": async (page) => {
    await openPlayOptions(page);
    await page
      .getByRole("button", { name: "Single player", exact: true })
      .click();
    await page
      .getByText("SPACE TO LAUNCH", { exact: true })
      .waitFor({ timeout: 30_000 });
    // Space on a focused button presses it; the arena has to hold focus first.
    await page.locator("canvas").click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("Space");
    await hold(page, ["KeyD", "KeyW", "KeyA", "KeyS", "KeyD"], 1800);
  },
  "fuse-birds": async (page) => {
    await openPlayOptions(page);
    await page
      .getByRole("button", { name: "Single player", exact: true })
      .click();
    await page
      .locator('canvas[data-ready="true"]')
      .waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
  },
  "fuse-front": async (page) => {
    await openPlayOptions(page);
    await page.getByRole("button", { name: "Host room" }).click();
    await takeHostSeat(page, "Gallery");
    await page
      .getByRole("button", { name: "Add AI", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "START" }).click();
    await page
      .locator("p.ff-hud", { hasText: "right-click: move" })
      .waitFor({ timeout: 30_000 });
    const board = page.locator("canvas.ff-board");
    const at = await board.boundingBox();
    if (!at) throw new Error("Fuse Front has no board");
    // March the hero toward the middle, where the armies meet.
    await page.mouse.click(at.x + at.width * 0.6, at.y + at.height * 0.45, {
      button: "right",
    });
    await page.waitForTimeout(20_000);
  },
  "elasto-fuse": async (page) => {
    await openPlayOptions(page);
    await page.getByRole("button", { name: "PLAY SOLO", exact: true }).click();
    await page
      .locator('.ef-room[data-stage="running"]')
      .waitFor({ timeout: 30_000 });
    // On the gas from the countdown (from a standstill, full gas loops the bike over backwards), up to the first apple.
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(5000);
  },
  fusemania: async (page) => {
    await openPlayOptions(page);
    await page
      .getByRole("button", { name: "Single player", exact: true })
      .click();
    // A battle against the AI rivals, so the card shows the field, the power-ups and the ranking.
    await page.locator(".fm-picker-mode").nth(1).click();
    await page.getByRole("button", { name: "PLAY", exact: true }).click();
    await page
      .locator('.fm-room[data-stage="running"]')
      .waitFor({ timeout: 30_000 });
    await page.evaluate(FUSEMANIA_AUTOPLAY);
    await page.waitForTimeout(16_000);
  },
  "fuse-volley": async (page) => {
    await openPlayOptions(page);
    await page
      .getByRole("button", { name: "Single player", exact: true })
      .click();
    await page
      .locator('.fv-room[data-stage="running"]')
      .waitFor({ timeout: 30_000 });
    await page.locator("canvas").click({ position: { x: 20, y: 20 } });
    // Walk under the serve and bump it over, then catch the bot's return mid-rally.
    await page.waitForTimeout(1500);
    await hold(page, ["ArrowRight"], 250);
    await page.keyboard.press("ArrowUp", { delay: 200 });
    await page.waitForTimeout(700);
  },
  "fuse-surge": async (page) => {
    await openPlayOptions(page, "single");
    await page
      .locator('.fs-room[data-phase="play"]')
      .waitFor({ timeout: 30_000 });
    // The picture is two canvases in a 3D look (the world and the flat layer over it): click their box.
    await page.locator(".fs-canvas").click({ position: { x: 20, y: 20 } });
    // Two surges in: the rider nobody is steering has been thrown back to the last foothold, by the pit, and hops
    // there while the third bears down; the bots are still up the deck.
    await page.waitForTimeout(5200);
    await page.keyboard.press("ArrowUp", { delay: 220 });
  },
  fuseball: async (page) => {
    await openPlayOptions(page);
    await page
      .getByRole("button", { name: "Single player", exact: true })
      .click();
    const room = page.locator(".fb-room");
    await room
      .and(page.locator('[data-stage="running"]:not([data-phase="countdown"])'))
      .waitFor({ timeout: 30_000 });
    await page.locator("canvas").click({ position: { x: 20, y: 20 } });
    await page.keyboard.down("ArrowRight");
    for (let jump = 0; jump < 5; jump++) {
      await page.keyboard.press("Space", { delay: 80 });
      await page.waitForTimeout(350);
    }
    await page.keyboard.up("ArrowRight");
  },
  "killer-fuse": async (page) => {
    await openPlayOptions(page);
    await page
      .getByRole("button", { name: "PLAY SOLO WITH BOTS", exact: true })
      .click();
    // The brief covers the arena over the countdown; the card is gone once the game is under way.
    await page
      .locator('main.kf-room[data-stage="running"]')
      .waitFor({ timeout: 30_000 });
    await page
      .locator(".kf-brief")
      .waitFor({ state: "hidden", timeout: 30_000 });
    await page.locator("canvas").click({ position: { x: 20, y: 20 } });
    // Let the six of them spread out over the hives and the snail before the frame is taken.
    await page.waitForTimeout(6000);
    await hold(page, ["KeyD", "Space", "KeyD"], 400);
  },
  "graveyard-shift": async (page) => {
    await page
      .getByRole("button", { name: "START SOLO SHIFT", exact: true })
      .click();
    await page.locator("[data-phase=running]").waitFor({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await page.locator("canvas").click({ position: { x: 200, y: 200 } });
    await hold(page, ["w", "d", "s", "a"], 1500);
  },
};

const wanted = process.argv.slice(2);
const unknown = wanted.filter((id) => !(id in RECIPES));
if (unknown.length > 0)
  throw new Error(
    `No capture recipe for ${unknown.join(", ")}; scripts/gallery-capture.ts has ${Object.keys(RECIPES).join(", ")}`,
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
