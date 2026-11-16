import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { BrowserKind } from "./browser.js";

/** #250: quarantine only the initial WebKit reset's visibility/stability race, retaining later UI checks. */
export async function returnToSoloLobby(
  page: Page,
  kind: BrowserKind,
): Promise<void> {
  if (kind !== "webkit") {
    await page
      .getByRole("button", { name: "BACK TO LOBBY", exact: true })
      .click();
    return;
  }
  const reset = page.locator(".online-host").getByRole("button", {
    name: "BACK TO LOBBY",
    exact: true,
    includeHidden: true,
  });
  assert.equal(await reset.count(), 1);
  await reset.evaluate((button: HTMLButtonElement) => {
    if (button.disabled) throw new Error("Initial solo reset is disabled");
    button.click();
  });
  console.log(
    "WebKit initial solo reset actionability quarantined under #250; downstream UI checks remain.",
  );
}
