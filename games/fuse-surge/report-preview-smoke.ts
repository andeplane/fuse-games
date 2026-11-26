import assert from "node:assert/strict";
import { launchSelected } from "../../scripts/lib/browser.js";
import { openPlayOptions } from "../../scripts/lib/main-menu.js";

const origin = process.env.ONLINE_URL ?? "http://localhost:8792/";
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  await page.goto(new URL("fuse-surge/?mute", origin).href);
  await openPlayOptions(page, "single");
  await page.locator(".fs-canvas canvas.fs-layer-world").waitFor();
  await page.keyboard.press("Control+x");
  const preview = page.getByRole("img", {
    name: "Screenshot attached to this report",
  });
  await preview.waitFor();
  const arenaCoverage = await preview.evaluate(async (image) => {
    if (!(image instanceof HTMLImageElement))
      throw new Error("Missing preview");
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not inspect screenshot");
    context.drawImage(image, 0, 0);
    // Sample the arena between the HUD and the controls. A discarded WebGL
    // buffer leaves a few flat background and text colors in this area.
    const { data } = context.getImageData(
      Math.floor(canvas.width * 0.3),
      Math.floor(canvas.height * 0.22),
      Math.floor(canvas.width * 0.4),
      Math.floor(canvas.height * 0.36),
    );
    let lit = 0;
    for (let i = 0; i < data.length; i += 16)
      if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) >= 48) lit++;
    return lit / Math.ceil(data.length / 16);
  });
  assert.ok(
    arenaCoverage > 0.08,
    `The report preview omitted the arena (${arenaCoverage} lit fraction)`,
  );
  console.log("PASS: the report preview includes the WebGL arena.");
} finally {
  await browser.close();
}
