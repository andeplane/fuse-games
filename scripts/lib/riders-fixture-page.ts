import type { Page } from "playwright";
import { ridersPageUrl } from "./riders-url.js";

/** Load Riders' error page so a fixture can mount a renderer without joining or starting a game. */
export async function openRidersFixturePage(page: Page, siteUrl: string) {
  await page.addInitScript("window.__name = value => value");
  await page.goto(`${ridersPageUrl(siteUrl)}?room=INVALID&mute`);
  await page.getByText("Invalid room code", { exact: true }).waitFor();
}
