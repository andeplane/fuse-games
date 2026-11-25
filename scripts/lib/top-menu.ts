import type { Locator, Page } from "playwright";

/** Prefer the floating hamburger when it covers the top bar. Both buttons open the same dialog. */
export async function topMenuToggle(page: Page): Promise<Locator> {
  const name = { name: "Open game menu", exact: true };
  const floating = page.locator(".fui-top-bar-float").getByRole("button", name);
  return (await floating.isVisible())
    ? floating
    : page.getByRole("button", name);
}

/**
 * Every game's header is the shared top bar (fuse-ui `createTopBar`): the brand, Sound, the account and one ☰ that
 * opens the Game menu, a dialog holding every other header action. A smoke that wants one of those actions opens the
 * dialog first; if it is already open this does nothing. An action that opens a dialog of its own closes the menu.
 */
export async function openTopMenu(page: Page): Promise<void> {
  const menu = page.locator(".fui-top-bar-menu[open]");
  if (await menu.isVisible()) return;
  const toggle = await topMenuToggle(page);
  if (!(await toggle.isVisible())) return;
  await toggle.click();
  await menu.waitFor();
}

/** Close the Game menu if it is open, for actions that leave it up (a toggle rather than a dialog). */
export async function closeTopMenu(page: Page): Promise<void> {
  const menu = page.locator(".fui-top-bar-menu[open]");
  if (!(await menu.isVisible())) return;
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
}
