import type { Page } from "playwright";
import { openPlayOptions, takeHostSeat } from "./main-menu.js";

/**
 * Gives the arena the keyboard by clicking it. On a phone the spot may lie under a control, and nothing there needs
 * the keyboard, so a click that cannot land is skipped.
 */
async function focusArena(
  page: Page,
  selector: string,
  position?: { x: number; y: number },
) {
  await page
    .locator(selector)
    .first()
    .click({ ...(position ? { position } : {}), timeout: 3000 })
    .catch(() => undefined);
}

/** Holds each key in turn for `ms`, so a rider moves about instead of standing where it spawned. */
export async function hold(page: Page, keys: readonly string[], ms: number) {
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

/**
 * How to reach real play in each game, shared by the gallery capture and the phone play audit.
 */

/** From the game's landing page (already open, muted) to a frame of play worth a card. */
export type Recipe = (page: Page) => Promise<void>;

export const RECIPES: Record<string, Recipe> = {
  fuserod: async (page) => {
    await openPlayOptions(page, "single");
    await page.locator('[data-garage-key="kestrel"]').click();
    await page.locator('[data-garage-key="course"]').selectOption("canyon");
    await page.locator('[data-garage-key="race"]').click();
    await page.locator('.rod-main[data-phase="running"]').waitFor();
    await page.keyboard.press("x");
    await page.locator(".rod-light").waitFor({ state: "hidden" });
    await page.waitForTimeout(1200);
    await page.keyboard.down("w");
    await page.waitForFunction(
      () =>
        parseInt(
          document.querySelectorAll(".rod-dash b")[1]?.textContent ?? "0",
        ) >= 18,
    );
    await page.keyboard.up("w");
  },
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
  "incredible-fuse": async (page) => {
    await openPlayOptions(page, "single");
    const choice = page.getByRole("combobox", { name: "Puzzle" });
    const showcase = await choice
      .getByRole("option", { name: /Clocking out$/ })
      .getAttribute("value");
    if (!showcase) throw new Error("Packing-line puzzle is missing");
    await choice.selectOption(showcase);
    await page
      .getByRole("button", { name: "Start puzzle", exact: true })
      .click();
    const board = page.getByRole("group", { name: "Machine workbench" });
    await page.getByRole("button", { name: "Incline", exact: true }).click();
    const bounds = await board.boundingBox();
    if (!bounds) throw new Error("Workbench is missing");
    await board.click({
      position: {
        x: (bounds.width * 110) / 640,
        y: (bounds.height * 130) / 400,
      },
    });
    await page
      .getByRole("button", { name: "Run machine", exact: true })
      .click();
    await page.getByRole("button", { name: "Rewind", exact: true }).waitFor();
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
    await focusArena(page, ".liero-arena canvas");
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
    await openPlayOptions(page, "single");
    await page
      .getByText("SPACE TO LAUNCH", { exact: true })
      .waitFor({ timeout: 30_000 });
    // Space on a focused button presses it; the arena has to hold focus first.
    await focusArena(page, "canvas", { x: 20, y: 20 });
    await page.keyboard.press("Space");
    await hold(page, ["KeyD", "KeyW", "KeyA", "KeyS", "KeyD"], 1800);
  },
  "fuse-birds": async (page) => {
    await openPlayOptions(page, "single");
    await page
      .getByRole("button", { name: "START BATTLE", exact: true })
      .click();
    await page
      .locator('canvas[data-ready="true"]')
      .waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
  },
  "fuse-front": async (page) => {
    await openPlayOptions(page, "single");
    await page.locator("canvas.ff-board").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(8000);
  },
  "elasto-fuse": async (page) => {
    await openPlayOptions(page, "single");
    await page
      .locator('.ef-room[data-stage="running"]')
      .waitFor({ timeout: 30_000 });
    // On the gas from the countdown (from a standstill, full gas loops the bike over backwards), up to the first apple.
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(5000);
  },
  fusemania: async (page) => {
    await openPlayOptions(page, "single");
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
    await openPlayOptions(page, "single");
    await page
      .locator('.fv-room[data-stage="running"]')
      .waitFor({ timeout: 30_000 });
    await focusArena(page, "canvas", { x: 20, y: 20 });
    // Walk under the serve and bump it over, then catch the bot's return mid-rally.
    await page.waitForTimeout(1500);
    await hold(page, ["ArrowRight"], 250);
    await page.keyboard.press("ArrowUp", { delay: 200 });
    await page.waitForTimeout(700);
  },
  dockside: async (page) => {
    await openPlayOptions(page, "single");
    await page
      .locator(
        '.dockside-room[data-phase="running"] canvas[aria-label="Canal Lock arena"]',
      )
      .waitFor();
    await hold(page, ["KeyQ"], 580);
    await page.getByText("North pad · Launch ready").waitFor();
    await page.keyboard.press("KeyF", { delay: 80 });
    await hold(page, ["KeyQ"], 1640);
    await hold(page, ["KeyW"], 3000);
  },
  "fuse-surge": async (page) => {
    await openPlayOptions(page, "single");
    await page
      .locator('.fs-room[data-phase="play"]')
      .waitFor({ timeout: 30_000 });
    // The picture is two canvases in a 3D look (the world and the flat layer over it): click their box.
    await focusArena(page, ".fs-canvas", { x: 20, y: 20 });
    // Two surges in: the rider nobody is steering has been thrown back to the last foothold, by the pit, and hops
    // there while the third bears down; the bots are still up the deck.
    await page.waitForTimeout(5200);
    await page.keyboard.press("ArrowUp", { delay: 220 });
  },
  fuseball: async (page) => {
    await openPlayOptions(page, "single");
    const room = page.locator(".fb-room");
    await room
      .and(page.locator('[data-stage="running"]:not([data-phase="countdown"])'))
      .waitFor({ timeout: 30_000 });
    await focusArena(page, "canvas", { x: 20, y: 20 });
    await page.keyboard.down("ArrowRight");
    for (let jump = 0; jump < 5; jump++) {
      await page.keyboard.press("Space", { delay: 80 });
      await page.waitForTimeout(350);
    }
    await page.keyboard.up("ArrowRight");
  },
  "killer-fuse": async (page) => {
    await openPlayOptions(page, "single");
    await page.getByRole("button", { name: "START", exact: true }).click();
    // The brief covers the arena over the countdown; the card is gone once the game is under way.
    await page
      .locator('main.kf-room[data-stage="running"]')
      .waitFor({ timeout: 30_000 });
    await page
      .locator(".kf-brief")
      .waitFor({ state: "hidden", timeout: 30_000 });
    await focusArena(page, "canvas", { x: 20, y: 20 });
    // Let the six of them spread out over the hives and the snail before the frame is taken.
    await page.waitForTimeout(6000);
    await hold(page, ["KeyD", "Space", "KeyD"], 400);
  },
  "graveyard-shift": async (page) => {
    await openPlayOptions(page, "single");
    await page.locator("[data-phase=running]").waitFor({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await focusArena(page, "canvas", { x: 200, y: 200 });
    await hold(page, ["w", "d", "s", "a"], 1500);
  },
};

const single = async (page: Page) => openPlayOptions(page, "single");
const press = (page: Page, name: string | RegExp) =>
  page.getByRole("button", { name, exact: true }).first().click();

/**
 * Games the phone audit reaches but the gallery does not capture from here: their cards were made another way, and
 * Pig has no card at all.
 */
export const AUDIT_RECIPES: Record<string, Recipe> = {
  "fuse-riders": async (page) => {
    await single(page);
    await page.locator('.mobile-control-hints[data-phase="playing"]').waitFor();
  },
  "fuse-axe": async (page) => {
    await single(page);
    await press(page, "START");
    await page.locator('.fa-room[data-stage="running"]').waitFor();
    await page.waitForTimeout(3000);
  },
  "fuse-bombers": async (page) => {
    await single(page);
    await press(page, "SOLO VS BOTS");
    await page.locator('[data-screen="playing"]').first().waitFor();
  },
  "fuse-choppers": async (page) => {
    await single(page);
    await page.locator('.fc-room[data-phase="play"]').waitFor();
  },
  "fuse-freight": async (page) => {
    await single(page);
    await page.locator('.ff-room[data-phase="play"]').waitFor();
  },
  "fuse-lane": async (page) => {
    await single(page);
    await press(page, "START");
    // The room's own box is empty (the town is fixed over the screen): attached, not visible.
    await page
      .locator('.fl-room[data-phase="running"]')
      .waitFor({ state: "attached" });
    await press(page, "SKIP").catch(() => undefined);
  },
  "fuse-craft": async (page) => {
    await single(page);
    await press(page, "New game");
    await press(page, /^Start/i);
    await page.waitForTimeout(6000);
  },
  "hook-havok": async (page) => {
    await single(page);
    await press(page, "JOIN");
    await page.waitForTimeout(1000);
    await press(page, "ADD AI");
    await press(page, "START");
    await page.waitForTimeout(8000);
  },
  dice: async (page) => {
    await single(page);
    await page.locator('.dice-room[data-phase="running"]').waitFor();
  },
};
