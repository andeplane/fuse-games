/** Real chart-lab editing, playback and export with explicit synthetic audio/notes HTTP boundaries. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createServer } from "vite";
import type { Browser, Download, Page } from "playwright";
import { launchSelected } from "../../scripts/lib/browser.js";
import { startGameCoverage } from "../../scripts/lib/game-browser-coverage.js";
import { parseSimfile } from "./src/engine/simfile.js";

interface LabState {
  song: string;
  duration: number;
  frames: number;
  charts: { key: string; label: string; notes: number }[];
  notes: number;
  playhead: number;
  topTime: number;
  pxPerSec: number;
  selection?: {
    start: number;
    end: number;
    lowHz?: number;
    highHz?: number;
    chart?: string;
  };
}
interface LabWindow extends Window {
  chartLab: { state(): LabState };
}

/** Eight seconds of quiet tones and evenly spaced pulses; no external music or user recording. */
function syntheticWav(): Buffer {
  const rate = 22_050;
  const samples = rate * 8;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const time = i / rate;
    const pulse = Math.exp(-(time % 0.5) * 45);
    wav.writeInt16LE(
      Math.round(
        (Math.sin(time * Math.PI * 440) * 0.03 +
          Math.sin(time * Math.PI * 1320) * pulse * 0.1) *
          32767,
      ),
      44 + i * 2,
    );
  }
  return wav;
}

async function state(page: Page): Promise<LabState> {
  return page.evaluate(() => (window as unknown as LabWindow).chartLab.state());
}
async function downloadText(download: Download): Promise<string> {
  const path = await download.path();
  assert.ok(path, "the browser completed the export");
  return readFile(path, "utf8");
}

const vite = process.env.ONLINE_URL
  ? undefined
  : await createServer({
      server: { host: "127.0.0.1", port: 0 },
      logLevel: "error",
    });
if (vite) await vite.listen();
const base =
  process.env.ONLINE_URL ??
  `http://127.0.0.1:${(vite!.httpServer!.address() as AddressInfo).port}/`;
let browser: Browser | undefined;
let finish: (() => Promise<void>) | undefined;
try {
  browser = await launchSelected("chrome", {
    headless: true,
    args: ["--mute-audio"],
  });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  await page.addInitScript("window.__name = value => value");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const wav = syntheticWav();
  const uploads: unknown[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (/\.(mp3|m4a|ogg|wav)$/i.test(url.pathname)) {
      await route.fulfill({ contentType: "audio/wav", body: wav });
    } else if (url.pathname.endsWith("/__chart-lab/notes")) {
      if (route.request().method() === "POST")
        uploads.push(route.request().postDataJSON());
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          route.request().method() === "POST"
            ? { dir: "isolated smoke storage" }
            : { version: 1, notes: [] },
        ),
      });
    } else await route.continue();
  });
  finish = await startGameCoverage(page, { gameId: "fusemania" });
  await page.goto(
    new URL("fusemania/chart-lab.html?song=final-chase&mute", base).href,
  );
  await page.waitForFunction(
    () => (window as unknown as LabWindow).chartLab?.state().frames > 0,
    undefined,
    { timeout: 60_000 },
  );
  assert.equal((await state(page)).duration, 8);
  assert.ok(
    (await state(page)).charts.length > 1,
    "real bundled charts were loaded beside Custom",
  );

  // Edit one real song chart through its lane; the second click restores the original note count.
  const chips = page.locator(".lab-chip");
  const chartId = (await state(page)).charts.find((chart) =>
    chart.key.startsWith("song:"),
  )!.key;
  for (const [index, chip] of (await chips.all()).entries()) {
    const checkbox = chip.getByRole("checkbox");
    await checkbox.setChecked(
      (await state(page)).charts[index]!.key === chartId,
    );
  }
  const canvas = page.locator("canvas.lab-canvas");
  const box = await canvas.boundingBox();
  assert.ok(box, "the chart editor has a visible canvas");
  const customNotes = async () =>
    (await state(page)).charts.find((chart) => chart.key === "taps")!.notes;
  const editor = page.getByTitle("Click a lane to add or remove a tap", {
    exact: true,
  });
  const beforeEdit = (await state(page)).charts.find(
    (chart) => chart.key === chartId,
  )!.notes;
  await editor.check();
  await canvas.click({ position: { x: 64 + 45, y: 400 } });
  assert.notEqual(
    (await state(page)).charts.find((chart) => chart.key === chartId)!.notes,
    beforeEdit,
  );
  await canvas.click({ position: { x: 64 + 45, y: 400 } });
  assert.equal(
    (await state(page)).charts.find((chart) => chart.key === chartId)!.notes,
    beforeEdit,
    "clicking a filled lane toggles its edit off",
  );
  await editor.uncheck();

  // Real audio-clock playback, marker/seek, changing rate, and recording player key presses.
  await page
    .getByTitle(
      "Assist tick: a click on every step of a chart, or on every beat",
    )
    .selectOption("beats");
  await canvas.click({ position: { x: 65, y: 70 } });
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  await page.waitForFunction(
    () => (window as unknown as LabWindow).chartLab.state().playhead > 0.2,
  );
  await page.keyboard.press("r");

  const beforeTaps = await customNotes();
  await page.keyboard.press("a");
  await page.keyboard.press("s");
  await page.keyboard.press("w");
  await page.keyboard.press("d");
  assert.ok(
    (await customNotes()) > beforeTaps,
    "record mode adds real key presses to Custom",
  );
  await page
    .getByTitle("Playback speed (the pitch drops with it)")
    .selectOption("0.5");
  await page.keyboard.press("Space");
  await page.keyboard.press("r");
  await page.keyboard.press("x");
  const marker = (await state(page)).playhead;
  await page.keyboard.press("ArrowRight");
  assert.ok((await state(page)).playhead > marker);
  await page.keyboard.press("Enter");
  assert.ok(
    Math.abs((await state(page)).playhead - marker) < 0.01,
    "Enter returns to the marker",
  );
  await page.keyboard.press("Shift+r");
  await page.keyboard.press("Shift+r");
  await page.keyboard.press("r");

  // The recorded Custom lane has its own move/delete history and undo.
  for (const [index, chip] of (await chips.all()).entries()) {
    await chip
      .getByRole("checkbox")
      .setChecked((await state(page)).charts[index]!.key === "taps");
  }
  const tap = await page.evaluate(() => {
    const value = JSON.parse(
      localStorage.getItem("fusemania-lab:taps:final-chase")!,
    ) as { taps: { time: number; column: number }[] };
    return value.taps[0]!;
  });
  const at = await state(page);
  await canvas.click({
    position: {
      x: 64 + tap.column * 30 + 15,
      y: 30 + (tap.time - at.topTime) * at.pxPerSec,
    },
  });
  const beforeDelete = await customNotes();
  await page.keyboard.press("s");
  await page.keyboard.press("w");
  await page.keyboard.press("Delete");
  assert.equal(
    await customNotes(),
    beforeDelete - 1,
    "a selected recorded tap can move and be deleted",
  );
  await page.keyboard.press("Control+z");
  assert.equal(
    await customNotes(),
    beforeDelete,
    "undo restores the recorded tap",
  );

  // Spectrogram controls and a real frequency/time span create a note that survives export/import.
  await page.getByTitle("Spectrogram", { exact: true }).selectOption("model");
  const floor = page.getByTitle(
    "Spectrogram floor: raise it to keep only the loudest parts",
  );
  const floorBefore = await floor.inputValue();
  await floor.click({ position: { x: 10, y: 8 } });
  assert.notEqual(
    await floor.inputValue(),
    floorBefore,
    "the spectrum floor responds to its real slider",
  );
  await page.getByTitle("Draw 16th lines over the spectrogram").uncheck();
  await page.getByTitle("Draw 16th lines over the spectrogram").check();
  await page.getByTitle("Spectrogram", { exact: true }).selectOption("detail");
  const beforeZoom = (await state(page)).pxPerSec;
  await page.keyboard.press("+");
  assert.ok((await state(page)).pxPerSec > beforeZoom);
  await page.keyboard.press("-");
  await page.mouse.move(box.x + box.width * 0.65, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + 250, { steps: 8 });
  await page.mouse.up();
  const selection = (await state(page)).selection;
  assert.ok(
    selection &&
      selection.end > selection.start &&
      selection.lowHz !== undefined,
    "dragging the spectrum selects time and frequency",
  );
  await page
    .getByPlaceholder("What do you hear? What should the chart do here?")
    .fill("Synthetic smoke: place the step on the pulse.");
  const noteSaved = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/__chart-lab/notes") &&
      request.postData()?.includes("Synthetic smoke") === true,
  );
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await noteSaved;
  assert.equal((await state(page)).notes, 1);
  assert.ok(
    uploads.length > 0,
    "the explicit test notes adapter received saves",
  );
  await page.locator(".lab-notes li").first().click();
  const notesDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const notesText = await downloadText(await notesDownload);
  assert.match(notesText, /Synthetic smoke/);
  await page.getByTitle("Delete this note", { exact: true }).click();
  assert.equal((await state(page)).notes, 0);
  await page.locator('input[accept=".json,application/json"]').setInputFiles({
    name: "smoke-notes.json",
    mimeType: "application/json",
    buffer: Buffer.from(notesText),
  });
  await page.waitForFunction(
    () => (window as unknown as LabWindow).chartLab.state().notes === 1,
  );

  const chartDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export .ssc", exact: true }).click();
  const chartText = await downloadText(await chartDownload);
  assert.equal(
    parseSimfile(chartText).charts.filter(
      (chart) => chart.stepsType === "dance-single",
    )[0]!.notes.length,
    beforeEdit,
    "exported SSC retains the original chart after toggling an edit twice",
  );
  await page.locator('input[accept=".ssc,.sm"]').setInputFiles({
    name: "smoke.ssc",
    mimeType: "text/plain",
    buffer: Buffer.from(chartText),
  });
  await page
    .locator(".lab-chip")
    .filter({ hasText: "smoke.ssc" })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Clear taps", exact: true }).click();
  assert.equal(await customNotes(), 0);
  await page.getByRole("button", { name: "Reset edits", exact: true }).click();
  // Collect each page load separately so coverage of the editor actions survives
  // the persistence reload.
  await finish();
  finish = await startGameCoverage(page, { gameId: "fusemania" });
  await page.reload();
  await page.waitForFunction(
    () => (window as unknown as LabWindow).chartLab?.state().frames > 0,
    undefined,
    { timeout: 60_000 },
  );
  assert.equal(
    (await state(page)).notes,
    1,
    "notes survive reopening the real page",
  );
  assert.equal(
    await customNotes(),
    0,
    "cleared taps stay cleared after reopening",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS Fusemania chart lab: real audio decode/FFT, canvas edits/undo, playback/record/seek, spectrum selection, notes round-trip, SSC round-trip and persisted reopening; synthetic HTTP audio/notes boundaries, headless and muted.",
  );
} finally {
  try {
    await finish?.();
  } finally {
    await browser?.close();
    await vite?.close();
  }
}
