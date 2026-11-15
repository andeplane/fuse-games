import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright";

import { startRoomService } from "./server.js";

const exec = promisify(execFile);
const agentBrowser =
  process.env.AGENT_BROWSER_BINARY ?? "/opt/homebrew/bin/agent-browser";

/** Real title and controls screens, supplementing each game's existing gameplay image. */
export async function captureCarousel(
  wanted: readonly string[],
): Promise<void> {
  const portalIds: string[] = [];
  for (const entry of await readdir("games", { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      await readFile(`games/${entry.name}/portal.json`, "utf8");
      portalIds.push(entry.name);
    } catch {
      // The platform demo deliberately has no portal entry.
    }
  }
  const ids = wanted.length ? [...wanted] : portalIds.sort();
  for (const id of ids)
    if (!portalIds.includes(id)) throw new Error(`No portal game named ${id}`);

  await exec(agentBrowser, ["skills", "get", "core"]);
  const session = (
    await exec(agentBrowser, [
      "session",
      "id",
      "--scope",
      "worktree",
      "--prefix",
      "gallery-carousel",
    ])
  ).stdout.trim();
  const agent = (...args: string[]) =>
    exec(agentBrowser, ["--session", session, ...args]);
  const temporary = await mkdtemp(join(tmpdir(), "fuse-carousel-"));
  const server = process.env.GALLERY_URL ? undefined : await startRoomService();
  const root = (process.env.GALLERY_URL ?? server?.url ?? "").replace(
    /\/?$/,
    "/",
  );
  const failed: string[] = [];
  try {
    await agent("open", "about:blank");
    await agent("set", "viewport", "1200", "750");
    const endpoint = (await agent("get", "cdp-url")).stdout.trim();
    const browser = await chromium.connectOverCDP(endpoint);
    const page = browser.contexts()[0]?.pages()[0];
    if (!page) throw new Error("agent-browser did not open a capture page");
    await mkdir("public/gallery", { recursive: true });
    for (const id of ids) {
      try {
        const portalPath = `games/${id}/portal.json`;
        const portal = JSON.parse(await readFile(portalPath, "utf8")) as {
          screenshot?: string;
          screenshots?: string[];
        };
        if (!portal.screenshot)
          throw new Error(
            `${id} needs a gameplay cover before carousel capture`,
          );
        await page.goto(new URL(`${id.replaceAll("-", "")}/?mute`, root).href);
        const howTo = page.getByRole("button", { name: /^how to play$/i });
        await howTo.waitFor({ state: "visible", timeout: 30_000 });
        await settle(page);
        await capture(id, "menu");
        await howTo.click();
        await settle(page);
        await capture(id, "controls");
        portal.screenshots = [
          portal.screenshot,
          `gallery/${id}-menu.jpg`,
          `gallery/${id}-controls.jpg`,
        ];
        await writeFile(portalPath, `${JSON.stringify(portal, null, 2)}\n`);
        console.log(`${id}: gameplay, menu, controls`);
      } catch (error) {
        failed.push(id);
        console.error(
          `${id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    async function capture(id: string, screen: string): Promise<void> {
      const png = join(temporary, `${id}-${screen}.png`);
      await agent("screenshot", png);
      // agent-browser emits PNG even for a .jpg filename. Encode lightweight JPEGs explicitly.
      await exec("magick", [
        png,
        "-strip",
        "-quality",
        "84",
        `public/gallery/${id}-${screen}.jpg`,
      ]);
    }
  } finally {
    await agent("close").catch(() => undefined);
    await server?.stop();
    await rm(temporary, { recursive: true, force: true });
  }
  if (failed.length)
    throw new Error(`No complete carousel for ${failed.join(", ")}`);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}
