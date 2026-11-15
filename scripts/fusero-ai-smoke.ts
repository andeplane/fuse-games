/** Native AI through actual room creation, peer checkpoints, a phone reload and TV recovery. */
import assert from "node:assert/strict";
import type { Page } from "playwright";
import { launchSelected } from "./lib/browser.js";
import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
import { startRoomService } from "./lib/server.js";
import { CLASSIC_WEAPONS } from "../games/fusero/src/engine/classic/catalog.js";

const server = process.env.ONLINE_URL ? undefined : await startRoomService();
const base = process.env.ONLINE_URL ?? server!.url;
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
const errors: string[] = [];
const contexts = await Promise.all([
  browser.newContext({ viewport: { width: 1280, height: 720 } }),
  browser.newContext({
    viewport: { width: 393, height: 852 },
    hasTouch: true,
    isMobile: true,
  }),
  browser.newContext({ viewport: { width: 1440, height: 900 } }),
]);
interface Sample {
  tick: number;
  hash: string;
  stage: string;
  phase: string;
  elapsedMs: number;
  hiddenAi: boolean;
  seats: { id: string; bot: boolean; watcher: boolean }[];
  worms: {
    id: string;
    aim: number;
    input: number;
    x: number;
    y: number;
    slots: { weaponId: number }[];
  }[];
}
const sample = (page: Page): Promise<Sample> =>
  page.evaluate(
    `(()=>{const h=window.fusero,s=h.state(),w=s.world;return {tick:s.logTick,hash:h.hash(),stage:s.stage,phase:w?.phase,elapsedMs:w?.elapsedMs??0,hiddenAi:!w||(!('aiShared'in w)&&w.worms.every(a=>!('ai'in a))),seats:s.seats,worms:w?.worms.map(a=>({id:a.id,aim:a.aim,input:a.input,x:a.x,y:a.y,slots:a.slots.map(s=>({weaponId:s.weaponId}))}))??[]};})()`,
  );
async function ticks(page: Page, count: number): Promise<void> {
  const before = (await sample(page)).tick;
  await page.waitForFunction(
    `window.fusero.state().logTick>=${before + count}`,
  );
}
async function converge(pages: Page[]): Promise<number> {
  const histories = pages.map(() => new Map<number, string>());
  for (let attempt = 0; attempt < 100; attempt++) {
    const values = await Promise.all(pages.map(sample));
    values.forEach((value, i) => histories[i]!.set(value.tick, value.hash));
    for (const [tick, hash] of histories[0]!)
      if (histories.every((history) => history.get(tick) === hash)) return tick;
    await ticks(pages[0]!, 1);
  }
  throw new Error("Native AI replicas did not converge at a shared log tick");
}
try {
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const [host, phone, tv] = pages;
  assert.ok(host && phone && tv);
  for (const page of pages) {
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) => errors.push(error.message));
  }
  await host.goto(new URL("fusero/?mute", base).href);
  await openPlayOptions(host);
  await host
    .getByRole("checkbox", {
      name: "Shared TV + phone controllers",
      exact: true,
    })
    .check();
  await host.getByRole("button", { name: "Host room", exact: true }).click();
  await host.waitForURL(/room=/);
  await host.waitForFunction("window.fusero?.state()?.logTick>0");
  const code = new URL(host.url()).searchParams.get("room");
  assert.ok(code);
  await takeHostSeat(host, "AI Host");
  await phone.goto(new URL("fusero/?mute", base).href);
  await openPlayOptions(phone, "join");
  await phone.getByRole("textbox").fill(code);
  await phone.locator(".fui-join-code-button").click();
  await phone.waitForURL(/room=/);
  await phone.locator(".fui-roster-name", { hasText: "AI Host" }).waitFor();
  await takeHostSeat(phone, "AI Peer");
  await host.locator(".fui-roster-name", { hasText: "AI Peer" }).waitFor();
  await host
    .getByRole("button", { name: /^add ai$/i })
    .first()
    .click();
  await host.waitForFunction("window.fusero.state().seats.some(s=>s.bot)");
  const longWeapon = CLASSIC_WEAPONS.find(
    (weapon) => weapon.name === "Super Shotgun",
  );
  assert.ok(longWeapon);
  await phone
    .getByRole("combobox", { name: "Weapon slot 1", exact: true })
    .selectOption(String(longWeapon.id));
  await phone.waitForFunction(
    `(()=>{const s=window.fusero.state(),p=s.seats.find(p=>p.name==='AI Peer');return p&&s.loadouts[p.id]?.[0]===${longWeapon.id};})()`,
  );
  await tv.goto(new URL(`fusero/?room=${code}&display=1&mute`, base).href);
  await tv.waitForFunction("window.fusero?.state()?.seats.some(s=>s.bot)");
  await host.getByRole("button", { name: "START MATCH", exact: true }).click();
  await Promise.all(
    pages.map((page) =>
      page.waitForFunction(
        "window.fusero?.state()?.stage==='running'&&window.fusero.state().world?.elapsedMs>1500",
      ),
    ),
  );
  const started = await sample(host),
    bot = started.seats.find((seat) => seat.bot);
  assert.ok(bot);
  const worm = started.worms.find((w) => w.id === bot.id);
  assert.ok(worm);
  const ids = ["Super Shotgun", "Napalm", "Cannon", "Doomsday", "Chaingun"].map(
    (name) => {
      const w = CLASSIC_WEAPONS.find((w) => w.name === name);
      assert.ok(w);
      return w.id;
    },
  );
  assert.deepEqual(
    worm.slots.map((slot) => slot.weaponId),
    ids,
  );
  await host.waitForFunction(
    "(()=>{const s=window.fusero.state(),b=s.seats.find(s=>s.bot);return s.world?.worms.some(w=>w.id===b.id&&Math.abs(w.aim)>0.5);})()",
  );
  assert.equal(
    (await sample(host)).worms.find((w) => w.id === bot.id)!.input,
    0,
    "native AI sets control intent rather than synthesizing keyboard bits",
  );
  assert.ok(
    started.hiddenAi,
    "presentation omits the private search frontier and shared random samples",
  );
  console.log(
    `Native AI active across host/phone/TV; common hash tick ${await converge(pages)}`,
  );
  await phone.reload();
  await phone.waitForFunction(
    "window.fusero?.state()?.stage==='running'&&window.fusero.state().world?.elapsedMs>1500",
  );
  assert.ok((await sample(phone)).seats.some((seat) => seat.bot));
  console.log(
    `Phone reload recovered the complete native AI world; common hash tick ${await converge(pages)}`,
  );
  await tv.reload();
  await tv.waitForFunction(
    "window.fusero?.state()?.stage==='running'&&window.fusero.state().world?.elapsedMs>1500",
  );
  console.log(
    `TV reload recovered native AI while the match continued; common hash tick ${await converge(pages)}`,
  );
  await phone.setViewportSize({ width: 844, height: 390 });
  const landscape = await phone.evaluate(() => {
    const arena = document
      .querySelector(".liero-arena")!
      .getBoundingClientRect();
    const controls = Array.from(
      document.querySelectorAll(".liero-pad button, .liero-weapon-bar button"),
    ).map((button) => button.getBoundingClientRect().toJSON());
    return {
      arena: arena.toJSON(),
      controls,
      height: innerHeight,
      width: innerWidth,
    };
  });
  assert.ok(
    landscape.arena.height >= 180,
    "landscape keeps a usable cave height",
  );
  assert.equal(landscape.controls.length, 15);
  for (const control of landscape.controls) {
    assert.ok(control.width >= 44 && control.height >= 44);
    assert.ok(control.x >= 0 && control.right <= landscape.width);
    assert.ok(control.y >= 0 && control.bottom <= landscape.height);
  }
  assert.equal(
    await phone.evaluate("window.fusero.camera().height"),
    240,
    "landscape layout preserves native camera geometry",
  );
  console.log(
    "Phone landscape retains the cave, native camera and all 44px controls",
  );
  await phone.setViewportSize({ width: 520, height: 320 });
  const narrow = await phone.evaluate(() => ({
    hud: document.querySelector(".liero-hud")!.getBoundingClientRect().toJSON(),
    scores: document
      .querySelector(".liero-scores")!
      .getBoundingClientRect()
      .toJSON(),
    arena: document
      .querySelector(".liero-arena")!
      .getBoundingClientRect()
      .toJSON(),
  }));
  assert.ok(narrow.arena.height >= 120);
  assert.ok(
    narrow.hud.bottom <= narrow.scores.top,
    "narrow landscape HUD never wraps into scores",
  );
  assert.deepEqual(errors, []);
  console.log("Fusero native AI room smoke passed");
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await server?.stop();
}
