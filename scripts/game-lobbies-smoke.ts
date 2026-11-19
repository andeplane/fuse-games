import assert from "node:assert/strict";
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { launchSelected } from "./lib/browser.js";
import { checkGameMenu } from "./lib/check-game-menu.js";
import type { Page } from "playwright";

async function openCraftMotionPreference(page: Page) {
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await page.getByRole("button", { name: /^player options$/i }).click();
  return page.getByRole("checkbox", { name: /reduced motion/i });
}

/** Real menu → room → admission paths. No injected game state or browser API replacements. */
const base = process.env.ONLINE_URL ?? "http://127.0.0.1:8787/";
const evidence = process.env.SMOKE_SHOTS ?? "artifacts/game-lobbies";
await mkdir(evidence, { recursive: true });
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
const games = (await readdir("games")).filter((id) => !id.startsWith("."));
const results: { game: string; error?: string; ai?: string }[] = [];
try {
  for (const game of games) {
    if (
      process.env.SMOKE_GAMES &&
      !process.env.SMOKE_GAMES.split(",").includes(game)
    )
      continue;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    let step = "menu";
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(new URL(`${game}/?mute`, base).href);
      const menu = page.locator(".fui-main-menu");
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>(".fui-main-menu")?.dataset
            .attractState === "running",
      );
      assert.ok(
        await menu.locator(".fui-attract canvas, .fui-attract svg").count(),
        "real gameplay renderer is present",
      );
      const firstTick = await menu.getAttribute("data-attract-tick");
      await page.waitForFunction(
        (first) =>
          document.querySelector<HTMLElement>(".fui-main-menu")?.dataset
            .attractTick !== first,
        firstTick,
      );
      assert.equal(
        await menu.getByRole("button", { name: /^player options$/i }).count(),
        0,
        "The top-right Game menu owns device preferences",
      );
      await checkGameMenu(page, game);
      await menu
        .getByRole("button", { name: "Pause background", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>(".fui-main-menu")?.dataset
            .attractState === "paused",
      );
      await menu
        .getByRole("button", { name: "Play background", exact: true })
        .click();
      await menu.getByRole("button", { name: "About", exact: true }).click();
      const about = page.locator("dialog[open]");
      assert.match(await about.innerText(), /Made by the vibe coding gang/);
      assert.match(await about.innerText(), /Sindre Aarsaether/);
      assert.doesNotMatch(await about.innerText(), /bedeho/i);
      await page.keyboard.press("Escape");
      await menu
        .getByRole("button", { name: "How to play", exact: true })
        .click();
      if (game === "fuse-craft") {
        await page.locator('[data-action="back-menu"]').click();
      } else {
        assert.ok(
          (
            await page
              .locator("dialog[open], [role=dialog]:visible")
              .innerText()
          ).length > 60,
        );
        await page.keyboard.press("Escape");
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "phone menu overflows horizontally",
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await page
        .getByRole("button", { name: "Host room", exact: true })
        .click();
      step = "empty room and QR";
      const room = page.locator(".fui-room-layout");
      await room.waitFor();
      await checkGameMenu(page, game);
      const configurationRoom = [
        "cyberfuse",
        "fuse-drivers",
        "fusemania",
        "elasto-fuse",
        "fuse-front",
        "fuseball",
        "fuse-volley",
        "fusero",
      ].includes(game);
      assert.equal(
        (await room.getAttribute("class"))
          ?.split(/\s+/)
          .includes("fui-room-configuration"),
        configurationRoom,
      );
      if (configurationRoom) {
        assert.equal(
          await room
            .locator(
              ".fui-room-invitation .fui-room-seats .fui-room-open-slots",
            )
            .count(),
          1,
        );
        assert.equal(
          await room.locator(".fui-room-players .fui-room-open-slots").count(),
          0,
        );
        for (const width of [360, 844, 1440]) {
          await page.setViewportSize({
            width,
            height: width === 844 ? 390 : 1000,
          });
          assert.ok(
            await room.evaluate((root, viewportWidth) => {
              const seats = root
                .querySelector(".fui-room-seats")!
                .getBoundingClientRect();
              const choices = (
                root.querySelector(".fui-room-configuration-content") ??
                root.querySelector(".fui-room-modes")!
              ).getBoundingClientRect();
              return viewportWidth > 640
                ? seats.right <= choices.left
                : seats.bottom <= choices.top;
            }, width),
            "round choices and seats occupy their intended columns/phone order",
          );
          assert.ok(
            await room.evaluate((root) => {
              const head = root.querySelector(".fui-room-head")!;
              const bounds = head.getBoundingClientRect();
              return [...head.querySelectorAll("button, a")].every(
                (control) => {
                  const rect = control.getBoundingClientRect();
                  return (
                    rect.width === 0 ||
                    (rect.left >= bounds.left - 1 &&
                      rect.right <= bounds.right + 1 &&
                      rect.top >= bounds.top - 1 &&
                      rect.bottom <= bounds.bottom + 1)
                  );
                },
              );
            }),
            "room header keeps every action inside its visible bounds",
          );
          if (game === "fusemania") {
            assert.equal(
              await room.locator(".fm-picker-play").count(),
              0,
              "header owns the explicit Start action",
            );
            assert.ok(
              await room.evaluate((root) => {
                const tools = root
                  .querySelector(".fm-picker-tools")!
                  .getBoundingClientRect();
                return [...root.querySelectorAll(".fm-picker-pack")].every(
                  (pack) => {
                    const tab = pack.getBoundingClientRect();
                    return (
                      tab.right <= tools.left ||
                      tab.left >= tools.right ||
                      tab.bottom <= tools.top ||
                      tab.top >= tools.bottom
                    );
                  },
                );
              }),
              "song tools never cover pack tabs",
            );
          }
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>(".fui-room-layout")?.dataset
            .attractState === "running",
      );
      await room
        .locator(".fui-room-count")
        .filter({ hasText: /^0\s*\/\s*\d/ })
        .waitFor();
      if (["fuse-front", "fuseball", "fuse-volley"].includes(game)) {
        const modes = room.locator(".fui-room-modes");
        await modes.waitFor();
        const buttons = modes.getByRole("button");
        // Fuse Volley: DUEL, 2 V 2, 3 V 3 and 2 V 2 V 2; the others have three. Every last mode seats six.
        assert.equal(await buttons.count(), game === "fuse-volley" ? 4 : 3);
        await buttons.last().click();
        await room
          .locator(".fui-room-count")
          .filter({ hasText: "0 / 6" })
          .waitFor();
        await buttons.first().click();
        await room
          .locator(".fui-room-count")
          .filter({ hasText: "0 / 2" })
          .waitFor();
      }
      await room.locator("img.fui-invite-qr").waitFor();
      await page.waitForFunction(() =>
        [
          ...document.querySelectorAll<HTMLImageElement>(
            ".fui-room-layout img.fui-invite-qr",
          ),
        ].some((img) => img.complete && img.naturalWidth > 0),
      );
      await room
        .locator('.fui-room-open-slot[data-slot="1"]')
        .getByRole("button", { name: "Join", exact: true })
        .click();
      const name = room
        .locator(
          'dialog[open] input:not([type="checkbox"]):not([type="radio"])',
        )
        .first();
      await name.fill("Menu Tester");
      step = "host admission";
      await room
        .locator("dialog[open]")
        .getByRole("button", { name: /^Join(?: as player)?$/i })
        .click();
      await page.waitForFunction(() =>
        /^1\s*\//.test(
          document.querySelector(".fui-room-count")?.textContent ?? "",
        ),
      );
      await room
        .locator('.fui-room-open-slot[data-slot="1"].fui-slot-occupied')
        .waitFor();
      if (game === "fuse-craft") {
        step = "guest device preferences";
        const guestContext = await browser.newContext({
          viewport: { width: 360, height: 800 },
        });
        try {
          const guest = await guestContext.newPage();
          const invite = new URL("fusecraft/", base);
          invite.searchParams.set(
            "room",
            (await room.locator(".fui-room-code").innerText()).trim(),
          );
          invite.searchParams.set("mute", "");
          await guest.goto(invite.href);
          await guest.locator(".fui-room-layout").waitFor();
          await checkGameMenu(guest, game);
          const hostMotion = await openCraftMotionPreference(page);
          const before = await hostMotion.isChecked();
          const guestMotion = await openCraftMotionPreference(guest);
          await guestMotion.setChecked(!before);
          await guest.reload();
          await guest.locator(".fui-room-layout").waitFor();
          assert.equal(
            await (await openCraftMotionPreference(guest)).isChecked(),
            !before,
            "guest device remembers its choice after reload",
          );
          assert.equal(
            await hostMotion.isChecked(),
            before,
            "guest motion preference is independent of host",
          );
          await page.keyboard.press("Escape");
          await page.keyboard.press("Escape");
        } finally {
          await guestContext.close();
        }
      }
      if (game === "fusemania") {
        step = "Fusemania guest readiness";
        const guestContext = await browser.newContext({
          viewport: { width: 360, height: 800 },
        });
        try {
          const guest = await guestContext.newPage();
          const invite = new URL("fusemania/", base);
          invite.searchParams.set(
            "room",
            (await room.locator(".fui-room-code").innerText()).trim(),
          );
          invite.searchParams.set("mute", "");
          await guest.goto(invite.href);
          const guestRoom = guest.locator(".fui-room-layout");
          await guestRoom
            .locator('.fui-room-open-slot[data-slot="0"]')
            .getByRole("button", { name: "Join", exact: true })
            .click();
          const form = guestRoom.locator("dialog[open]");
          await form
            .locator('input:not([type="checkbox"]):not([type="radio"])')
            .first()
            .fill("Ready Tester");
          await form
            .getByRole("button", { name: /^Join(?: as player)?$/i })
            .click();
          const ready = guestRoom
            .locator(".fui-room-head")
            .getByRole("button", {
              name: "READY",
              exact: true,
            });
          await ready.waitFor();
          const hostStart = room.locator(".fui-room-head .fm-start");
          await room.locator(".fm-start:disabled").waitFor();
          assert.equal(await ready.getAttribute("aria-pressed"), "false");
          await ready.click();
          const pressed = guestRoom.getByRole("button", {
            name: "READY ✓",
            exact: true,
          });
          await pressed.waitFor();
          assert.equal(await pressed.getAttribute("aria-pressed"), "true");
          await room.locator(".fm-start:enabled").waitFor();
          assert.ok(await hostStart.isEnabled());
          await pressed.click();
          await ready.waitFor();
          await room.locator(".fm-start:disabled").waitFor();
        } finally {
          await guestContext.close();
        }
        await room.locator(".fm-start:enabled").waitFor();
      }
      const settings = room.getByRole("button", {
        name: "Room settings",
        exact: true,
      });
      step = "settings";
      if (await settings.isVisible()) {
        await settings.click();
        const dialog = page.locator("dialog[open]");
        await dialog.waitFor();
        if (game === "cyberfuse")
          await dialog.getByText("Difficulty", { exact: true }).click();
        const select = dialog.locator("select:enabled").first();
        if (await select.count()) {
          const next = await select
            .locator("option")
            .nth(1)
            .getAttribute("value");
          if (next !== null) await select.selectOption(next);
          await page.locator("dialog[open]").waitFor();
        }
        await page.keyboard.press("Escape");
      }
      const ai = room
        .locator('.fui-room-open-slot[data-slot="0"]')
        .getByRole("button", { name: /^Add AI$/i })
        .first();
      step = "AI admission";
      const hasAI =
        (await ai.count()) > 0 &&
        (await ai.isVisible()) &&
        (await ai.isEnabled());
      // #250: Hook's settings/arena transition intermittently makes this AI click
      // non-actionable. Keep its other menu/room checks and every other game's AI flow.
      const quarantineAI =
        game === "hook-havok" &&
        process.env.CI === "true" &&
        process.env.LOBBY_HOOK_AI_QUARANTINE === "1";
      if (hasAI && !quarantineAI) {
        await ai.click();
        await page.waitForFunction(() =>
          /^2\s*\//.test(
            document.querySelector(".fui-room-count")?.textContent ?? "",
          ),
        );
        await room
          .locator('.fui-room-open-slot[data-slot="0"].fui-slot-occupied')
          .waitFor();
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "phone room overflows horizontally",
      );
      if (game === "ball-bros") {
        step = "shared TV controller audio";
        await room.getByRole("checkbox", { name: /shared tv/i }).check();
        await room.getByRole("button", { name: /^start match$/i }).click();
        await page.locator("#app.controller-mode").waitFor();
        await page
          .getByRole("button", { name: "Open game menu", exact: true })
          .click();
        const menu = page.getByRole("dialog", { name: /^game menu$/i });
        await menu.getByRole("button", { name: /^player options$/i }).click();
        const options = page.getByRole("dialog", { name: /^player options$/i });
        await options.waitFor();
        assert.equal(
          await options
            .getByRole("slider", { name: /^radio volume$/i })
            .count(),
          0,
          "controller volume is managed on the TV",
        );
        await options.getByRole("button", { name: /^back$/i }).click();
        await menu.getByRole("button", { name: /^radio$/i }).click();
        const radio = page.getByRole("dialog", { name: /^radio$/i });
        await radio
          .getByText("Use the radio on the shared TV.", { exact: true })
          .waitFor();
        assert.equal(
          await radio
            .getByRole("button", {
              name: /^(radio (on|off)|next radio track)$/i,
            })
            .count(),
          0,
          "a controller never drives TV playback",
        );
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      }
      assert.deepEqual(
        errors,
        [],
        "browser exceptions after menu interactions",
      );
      results.push({
        game,
        ai: quarantineAI
          ? "quarantined under #250"
          : hasAI
            ? "added"
            : "unsupported or unavailable",
      });
      if (quarantineAI)
        console.log(
          "Hook Havok AI admission quarantined under #250; other menu/room checks remain.",
        );
      console.log(`PASS ${game}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ game, error: `${step}: ${message}` });
      // What the page was showing: a room that fell back to its menu or reported an error says so here, not in the timeout.
      const showing = await page
        .evaluate(() =>
          [
            document.body.className,
            ...[
              ...document.querySelectorAll<HTMLElement>(
                '[data-state="error"], [role="alert"], [role="status"]',
              ),
            ].map((node) => node.textContent?.trim().slice(0, 120)),
          ]
            .filter(Boolean)
            .join(" | "),
        )
        .catch(() => "page gone");
      console.error(
        `FAIL ${game} at ${step}: ${message.slice(0, 350)}\n  page: ${showing}`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(`${evidence}/results.json`, JSON.stringify(results, null, 2));
assert.ok(
  results.length > 0 && results.every((result) => !result.error),
  "all game menu and room flows pass",
);
