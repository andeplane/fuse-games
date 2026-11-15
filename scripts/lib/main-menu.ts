import type { Page } from "playwright";

/** Open the user-facing mode choices, retaining hosting/local preferences in their expandable section. */
export async function openPlayOptions(
  page: Page,
  mode?: "single" | "join",
): Promise<void> {
  const choices = page.locator(".fui-play-menu");
  if (!(await choices.isVisible()))
    await page
      .locator(".fui-main-menu")
      .getByRole("button", { name: "Play", exact: true })
      .click();
  if (mode) {
    await choices
      .getByRole("button", {
        name: mode === "single" ? "Single player" : "Join room",
        exact: true,
      })
      .click();
    return;
  }
  const hosting = page.locator(".fui-play-hosting");
  if ((await hosting.isVisible()) && !(await hosting.getAttribute("open")))
    await hosting.locator("summary").click();
}

/** A remembered host may already be seated; otherwise take its seat through the visible admission UI. */
export async function takeHostSeat(page: Page, name: string): Promise<void> {
  const join = page.locator(".fui-slot-admission[open]");
  // This action belongs to this device: a watcher sees SWAP TO PLAYER instead.
  // A roster count alone cannot prove the host took a seat; another peer may be listed.
  const seated = page
    .locator("button.room-switch")
    .filter({ hasText: /^SWAP TO SPECTATOR$/ });
  const takeSeat = page
    .locator(".fui-room-open-slot")
    .getByRole("button", { name: "Join", exact: true })
    .filter({ visible: true })
    .first();
  await seated
    .or(join)
    .or(takeSeat)
    .filter({ visible: true })
    .first()
    .waitFor();
  if (await seated.isVisible()) return;
  if (!(await join.isVisible())) {
    const count = await page.locator(".fui-room-count").innerText();
    await takeSeat.click();
    if (!(await join.count())) {
      await page.waitForFunction(
        (before) =>
          document.querySelector(".fui-room-count")?.textContent !== before,
        count,
      );
      return;
    }
  }
  await join
    .locator('input:not([type="radio"]):not([type="checkbox"])')
    .first()
    .fill(name);
  // A room seats a named viewer by itself, so the typed name can take the seat before the click lands: the
  // dialog closing is the seat taken, whichever of the two did it.
  const closed = join.waitFor({ state: "hidden" });
  await Promise.race([
    join
      .getByRole("button", { name: /^Join(?: as player)?$/i })
      .click()
      .catch(() => closed),
    closed,
  ]);
  await closed;
}
