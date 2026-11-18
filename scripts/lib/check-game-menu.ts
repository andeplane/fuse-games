import assert from "node:assert/strict";
import type { Page } from "playwright";
import { gameMenus } from "../../tests/fixtures/game-menu-expectations.js";

/** Exercise the real hamburger in both the front door and the assembled room. */
export async function checkGameMenu(page: Page, game: string): Promise<void> {
  const expected = gameMenus[game];
  assert.ok(expected, `Declare the menu capabilities of ${game}`);
  const speaker = page.getByRole("button", { name: /^sound (on|off)$/i });
  const soundState = (await speaker.count())
    ? await speaker.getAttribute("aria-pressed")
    : null;
  const soundDisabled = soundState !== null && (await speaker.isDisabled());
  const toggle = page.getByRole("button", {
    name: "Open game menu",
    exact: true,
  });
  await toggle.click();
  const dialog = page.getByRole("dialog", { name: /^game menu$/i });
  const prefs = dialog.getByRole("button", { name: /^player options$/i });
  await prefs.click();
  const options = page.getByRole("dialog", { name: /^player options$/i });
  await options.waitFor();
  const sound = options.getByRole("button", { name: /^sound (on|off)$/i });
  assert.equal(
    await sound.count(),
    Number(soundState !== null),
    `${game}: shortcut and panel have one master`,
  );
  if (soundState !== null) {
    assert.equal(await sound.getAttribute("aria-pressed"), soundState);
    assert.equal(await sound.isDisabled(), soundDisabled);
  }
  for (const [role, name] of expected.controls) {
    await options.getByRole(role, { name }).waitFor();
  }
  assert.ok(
    (await options
      .locator("input:visible, select:visible, button:visible")
      .count()) > 1,
    `${game}: Player options offers a control in addition to Back`,
  );
  assert.equal(
    await options
      .getByRole("button", { name: /^(play radio|next track|room settings)$/i })
      .count(),
    0,
  );
  await options.getByRole("button", { name: /^back$/i }).click();
  await dialog.waitFor();
  const radio = dialog.getByRole("button", { name: /^radio$/i });
  assert.equal(
    await radio.count(),
    Number(expected.radio),
    `${game}: Radio is a sibling of Player options when supported`,
  );
  if (expected.radio) {
    await radio.click();
    const transport = page.getByRole("dialog", { name: /^radio$/i });
    await transport.waitFor();
    assert.ok(
      (await transport.getByRole("button").count()) > 1,
      `${game}: Radio has playback controls`,
    );
    assert.equal(
      await transport.getByRole("slider", { name: /volume/i }).count(),
      0,
      `${game}: volume belongs in Player options`,
    );
    await page.keyboard.press("Escape");
    await dialog.waitFor();
  }
  await page.keyboard.press("Escape");
  await toggle.waitFor();
  assert.equal(
    await toggle.evaluate((node) => node.ownerDocument.activeElement === node),
    true,
    `${game}: Escape restores the game menu trigger`,
  );
}
