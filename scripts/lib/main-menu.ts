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

/** Remembered hosts seat themselves; otherwise use the room's explicit admission action. */
export async function takeHostSeat(
  page: Page,
  name: string,
  options: { autoSeat?: boolean } = {},
): Promise<void> {
  const seated = page
    .locator(".fui-slot-occupied .fui-slot-occupant")
    .getByText(name, { exact: true })
    .first();
  if (options.autoSeat || (await seated.isVisible())) {
    await seated.waitFor({ state: "visible" });
    return;
  }
  const join = page.locator(".fui-slot-admission[open]");
  if (!(await join.isVisible())) {
    const count = await page.locator(".fui-room-count").innerText();
    await page
      .locator(".fui-room-open-slot:visible")
      .getByRole("button", { name: "Join", exact: true })
      .filter({ visible: true })
      .first()
      .click();
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
