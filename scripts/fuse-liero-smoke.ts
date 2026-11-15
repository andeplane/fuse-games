import assert from "node:assert/strict";
import type { Page } from "playwright";
import { launchSelected } from "./lib/browser.js";
import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
import { startRoomService } from "./lib/server.js";

/** Real menus and controls; the development hook is read-only observation, never state injection. */
const server = process.env.ONLINE_URL ? undefined : await startRoomService();
const base = process.env.ONLINE_URL ?? server!.url;
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
const errors: string[] = [];
const contexts = await Promise.all([
  browser.newContext({ viewport: { width: 1440, height: 900 } }),
  browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  }),
  browser.newContext({ viewport: { width: 1440, height: 900 } }),
]);
interface Sample {
  tick: number;
  hash: string;
  phase: string;
  names: string[];
  worms: {
    id: string;
    slot: number;
    x: number;
    y: number;
    aim: number;
    weapon: number;
    input: number;
    rope: unknown;
  }[];
  nextId: number;
  terrain: number;
}
const sample = (page: Page): Promise<Sample> =>
  page.evaluate(`(() => {
  const hook = window.fuseLiero, s = hook.state(), w = s.world;
  return { tick: s.logTick, hash: hook.hash(), phase: w?.phase,
    names: s.seats.filter(p => !p.watcher).map(p => p.name),
    worms: w?.worms.map(({id,slot,x,y,aim,weapon,input,rope}) => ({id,slot,x,y,aim,weapon,input,rope})) ?? [],
    nextId: w?.nextId ?? 0, terrain: w?.terrain.reduce((n,row) => n + [...row].filter(c => c !== "0").length, 0) ?? 0 };
})()`);
async function play(page: Page): Promise<void> {
  await page.waitForFunction(
    "window.fuseLiero?.state()?.world?.phase === 'play'",
    undefined,
    { timeout: 30_000 },
  );
}
async function ticks(page: Page, count: number): Promise<void> {
  const before = (await sample(page)).tick;
  await page.waitForFunction(
    `window.fuseLiero?.state()?.logTick >= ${before + count}`,
  );
}
async function convergence(pages: Page[]): Promise<number> {
  // Independent clocks need not be at the same tick when sequential evaluate calls run.
  // Retain the samples by log tick and compare only the same authoritative revision.
  const samples = pages.map(() => new Map<number, string>());
  for (let attempt = 0; attempt < 80; attempt++) {
    const values = await Promise.all(pages.map(sample));
    values.forEach((value, i) => samples[i]!.set(value.tick, value.hash));
    for (const [tick, hash] of samples[0]!) {
      if (samples.every((history) => history.has(tick))) {
        assert.ok(
          samples.every((history) => history.get(tick) === hash),
          `room replicas diverged at log tick ${tick}`,
        );
        return tick;
      }
    }
    await ticks(pages[0]!, 1);
  }
  throw new Error("No common log tick observed across room replicas");
}

try {
  const [host, peer, tv] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  for (const page of [host!, peer!, tv!]) {
    page.setDefaultTimeout(20_000);
    page.on("pageerror", (error) => errors.push(error.message));
  }
  await host!.goto(new URL("fuse-liero/?mute", base).href);
  await host!.getByRole("button", { name: "How to play", exact: true }).click();
  assert.match(await host!.locator("dialog[open]").innerText(), /rope|rocket/i);
  await host!.keyboard.press("Escape");
  await openPlayOptions(host!);
  await host!
    .getByRole("checkbox", {
      name: "Shared TV + phone controllers",
      exact: true,
    })
    .check();
  await host!.getByRole("button", { name: "Host room", exact: true }).click();
  await host!.waitForURL(/room=/);
  const code = new URL(host!.url()).searchParams.get("room")!;
  await takeHostSeat(host!, "Liero Ada");
  await peer!.goto(new URL("fuse-liero/?mute", base).href);
  await openPlayOptions(peer!, "join");
  await peer!.getByRole("textbox").fill(code);
  await peer!.locator(".fui-join-code-button").click();
  await peer!.waitForURL(/room=/);
  await peer!.locator(".fui-roster-name", { hasText: "Liero Ada" }).waitFor();
  await takeHostSeat(peer!, "Liero Bo");
  await host!.locator(".fui-roster-name", { hasText: "Liero Bo" }).waitFor();
  await tv!.goto(new URL(`fuse-liero/?room=${code}&display=1&mute`, base).href);
  await tv!.locator(".liero-room[data-phase=lobby]").waitFor();
  await host!.getByRole("button", { name: "START MATCH", exact: true }).click();
  await Promise.all([host!, peer!, tv!].map(play));
  await host!.locator(".liero-arena canvas").click();
  const initial = await sample(host!);
  assert.equal(initial.worms.length, 2, "display must not take a player seat");
  assert.deepEqual(initial.names.sort(), ["Liero Ada", "Liero Bo"]);
  await tv!.locator(".liero-pad").waitFor({ state: "hidden" });
  assert.equal(
    await tv!.locator(".liero-hud").getByText("SPECTATING").count(),
    1,
  );

  await host!.keyboard.down("KeyD");
  await host!.waitForFunction(
    "window.fuseLiero.state().world.worms.find(w => w.slot === 0).input & 2",
  );
  await ticks(host!, 6);
  await host!.keyboard.up("KeyD");
  await host!.waitForFunction(
    "window.fuseLiero.state().world.worms.find(w => w.slot === 0).input === 0",
  );
  assert.notEqual(
    (await sample(host!)).worms.find((w) => w.slot === 0)!.x,
    initial.worms.find((w) => w.slot === 0)!.x,
    "keyboard moves the host worm",
  );
  await host!.keyboard.press("KeyQ");
  await host!.waitForFunction(
    "window.fuseLiero.state().world.worms.find(w => w.slot === 0).weapon === 1",
  );
  const beforeShot = await sample(host!);
  await host!.keyboard.down("KeyF");
  await host!.waitForFunction(
    `window.fuseLiero.state().world.nextId > ${beforeShot.nextId}`,
  );
  await host!.keyboard.up("KeyF");
  await peer!.waitForFunction(
    `window.fuseLiero.state().world.nextId > ${beforeShot.nextId}`,
  );
  await host!.waitForFunction(
    `window.fuseLiero.state().world.terrain.reduce((n,row) => n + [...row].filter(c => c !== '0').length, 0) < ${beforeShot.terrain}`,
  );
  await peer!.waitForFunction(
    `window.fuseLiero.state().world.terrain.reduce((n,row) => n + [...row].filter(c => c !== '0').length, 0) < ${beforeShot.terrain}`,
  );

  // Aim at the floor: roof height varies by seeded cave and can exceed rope range.
  await host!.keyboard.down("KeyS");
  await host!.waitForFunction(
    "window.fuseLiero.state().world.worms.find(w => w.slot === 0).aim === 8",
  );
  await host!.keyboard.up("KeyS");
  await host!.keyboard.down("KeyR");
  await host!.waitForFunction(
    "window.fuseLiero.state().world.worms.find(w => w.slot === 0).rope !== null",
  );
  await peer!.waitForFunction(
    "window.fuseLiero.state().world.worms.find(w => w.slot === 0).rope !== null",
  );
  await host!.keyboard.up("KeyR");
  await peer!.waitForFunction(
    "window.fuseLiero.state().world.worms.find(w => w.slot === 0).rope === null",
  );
  console.log(
    `Keyboard movement, weapon, firing and rope replicated; common hash tick ${await convergence([host!, peer!, tv!])}`,
  );

  assert.ok(
    await peer!.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "phone page does not overflow horizontally",
  );
  const touch = peer!
    .locator(".liero-pad")
    .getByRole("button", { name: "FIRE", exact: true });
  await touch.scrollIntoViewIfNeeded();
  const box = await touch.boundingBox();
  assert.ok(box);
  assert.ok(
    box.width >= 44 && box.height >= 44,
    "phone controls have usable touch targets",
  );
  await peer!.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await peer!
    .locator(".liero-pad")
    .getByRole("button", { name: "WEAPON", exact: true })
    .tap();
  await host!.waitForFunction(
    "window.fuseLiero.state().world.worms.find(w => w.slot === 1).weapon === 1",
  );
  await peer!.reload();
  await play(peer!);
  await peer!.waitForFunction(
    "window.fuseLiero.state().seats.filter(s => s.name === 'Liero Bo' && !s.watcher && s.connected).length === 1",
  );
  await peer!.locator(".liero-pad").waitFor({ state: "visible" });
  console.log(
    `Mobile touch weapon, spectator and reload recovery passed; common hash tick ${await convergence([host!, peer!, tv!])}`,
  );
  assert.deepEqual(errors, [], "no browser runtime exceptions");
  console.log(
    "Fuse Liero online smoke passed (two independent players and a display)",
  );
} catch (error) {
  for (const [i, context] of contexts.entries())
    for (const page of context.pages()) {
      console.error(`Liero page ${i}: ${page.url()}`);
      console.error((await page.locator("body").innerText()).slice(-2500));
    }
  throw error;
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await server?.stop();
}
