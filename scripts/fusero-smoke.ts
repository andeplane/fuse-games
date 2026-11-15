import assert from "node:assert/strict";
import type { Page } from "playwright";
import { launchSelected } from "./lib/browser.js";
import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
import { startRoomService } from "./lib/server.js";
import { CLASSIC_WEAPONS } from "../games/fusero/src/engine/classic/catalog.js";

/** Native Classic behavior through real menus and controls; the app hook is read-only. */
const server = process.env.ONLINE_URL ? undefined : await startRoomService();
const base = process.env.ONLINE_URL ?? server!.url;
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
const errors: string[] = [],
  audioRequests: string[] = [];
const contexts = await Promise.all([
  browser.newContext({ viewport: { width: 1440, height: 900 } }),
  browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  }),
  browser.newContext({ viewport: { width: 1440, height: 900 } }),
]);
interface Camera {
  x: number;
  y: number;
  width: number;
  height: number;
  overview: boolean;
}
interface Worm {
  id: string;
  slot: number;
  x: number;
  y: number;
  aim: number;
  weapon: number;
  input: number;
  health: number;
  alive: boolean;
  rope: { state: string } | null;
  slots: { weaponId: number; charge: number; reloading: boolean }[];
}
interface Sample {
  tick: number;
  hash: string;
  stage: string;
  phase: string;
  seats: {
    id: string;
    name: string;
    slot: number;
    bot: boolean;
    watcher: boolean;
    connected: boolean;
  }[];
  worms: Worm[];
  elapsedMs: number;
  nextId: number;
  terrain: { width: number; height: number; rowCount: number };
  camera: Camera;
  audio: { enabled: boolean; loaded: number; voices: number };
}
const sample = (page: Page): Promise<Sample> =>
  page.evaluate(`(() => {
  const hook=window.fusero,s=hook.state(),w=s.world;
  return {tick:s.logTick,hash:hook.hash(),stage:s.stage,phase:w?.phase,seats:s.seats,
    worms:w?.worms.map(({id,slot,x,y,aim,weapon,input,health,alive,rope,slots}) =>
      ({id,slot,x,y,aim,weapon,input,health,alive,rope:rope?{state:rope.state}:null,slots}))??[],
    elapsedMs:w?.elapsedMs??0,nextId:w?.nextId??0,
    terrain:{width:w?.terrain.width??0,height:w?.terrain.height??0,rowCount:w?.terrain.rows.length??0},
    camera:hook.camera(),audio:hook.audio()};
})()`);
const weaponId = (name: string): number => {
  const weapon = CLASSIC_WEAPONS.find((weapon) => weapon.name === name);
  assert.ok(weapon, `native catalog contains ${name}`);
  return weapon.id;
};
const bySlot = (s: Sample, slot: number): Worm => {
  const worm = s.worms.find((worm) => worm.slot === slot);
  assert.ok(worm, `worm in slot ${slot}`);
  return worm;
};
async function play(page: Page): Promise<void> {
  await page.waitForFunction(
    "window.fusero?.state()?.stage === 'running' && window.fusero.state().world?.phase === 'play'",
    undefined,
    { timeout: 30_000 },
  );
}
async function ticks(page: Page, count: number): Promise<void> {
  const before = (await sample(page)).tick;
  await page.waitForFunction(
    `window.fusero?.state()?.logTick >= ${before + count}`,
  );
}
async function cameraSize(
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await page.waitForFunction(
    `(() => {const c=window.fusero?.camera();return c?.width===${width}&&c?.height===${height};})()`,
  );
}
async function chooseWeapons(
  page: Page,
  playerName: string,
  names: string[],
): Promise<void> {
  assert.equal(names.length, 5);
  for (const [slot, name] of names.entries()) {
    const id = weaponId(name);
    await page
      .getByRole("combobox", { name: `Weapon slot ${slot + 1}`, exact: true })
      .selectOption(String(id));
    await page.waitForFunction(
      `(() => {const s=window.fusero.state(),p=s.seats.find(p=>!p.bot&&!p.watcher&&p.name===${JSON.stringify(playerName)});return p&&s.loadouts[p.id]?.[${slot}]===${id};})()`,
    );
  }
}
async function convergence(pages: Page[]): Promise<number> {
  const histories = pages.map(() => new Map<number, string>());
  let lastCommon = -1;
  // Input repair can revise a provisional hash: a later shared tick must converge.
  for (let attempt = 0; attempt < 100; attempt++) {
    const values = await Promise.all(pages.map(sample));
    values.forEach((value, index) =>
      histories[index]!.set(value.tick, value.hash),
    );
    for (const [tick, hash] of histories[0]!)
      if (histories.every((history) => history.has(tick))) {
        lastCommon = tick;
        if (histories.every((history) => history.get(tick) === hash))
          return tick;
      }
    await ticks(pages[0]!, 1);
  }
  throw new Error(
    `Native room replicas failed to converge; latest common tick ${lastCommon}`,
  );
}
function cameraContains(camera: Camera, worm: Worm): boolean {
  return (
    worm.x >= camera.x - 3 &&
    worm.x <= camera.x + camera.width + 3 &&
    worm.y >= camera.y - 3 &&
    worm.y <= camera.y + camera.height + 3
  );
}
async function ropeAndJump(page: Page, slot: number): Promise<void> {
  // Classic aims continuously, casts a travelling hook and retains it on key release.
  await page.keyboard.down("KeyS");
  await page.waitForFunction(
    `window.fusero.state().world.worms.find(w=>w.slot===${slot}).aim >= 50`,
  );
  await page.keyboard.up("KeyS");
  await page.keyboard.press("KeyR", { delay: 60 });
  await page.waitForFunction(
    `window.fusero.state().world.worms.find(w=>w.slot===${slot}).rope !== null`,
  );
  await ticks(page, 3);
  assert.notEqual(
    bySlot(await sample(page), slot).rope,
    null,
    "releasing the rope key retains the native rope",
  );
  await page.keyboard.press("Space", { delay: 60 });
  await page.waitForFunction(
    `window.fusero.state().world.worms.find(w=>w.slot===${slot}).rope === null`,
  );
}

try {
  const [host, peer, tv] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  assert.ok(host && peer && tv);
  for (const page of [host, peer, tv]) {
    page.setDefaultTimeout(20_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.includes("/fusero/audio/"))
        audioRequests.push(request.url());
    });
  }
  // Single player now prepares a loadout before an explicit start.
  await host.goto(new URL("fusero/?mute", base).href);
  await host.getByRole("button", { name: "How to play", exact: true }).click();
  assert.match(
    await host.locator("dialog[open]").innerText(),
    /rope|weapon|carve/i,
  );
  await host.keyboard.press("Escape");
  await openPlayOptions(host, "single");
  await host.locator('.liero-room[data-phase="lobby"]').waitFor();
  const firstWeapon = host.getByRole("combobox", {
    name: "Weapon slot 1",
    exact: true,
  });
  await firstWeapon.waitFor();
  assert.equal((await sample(host)).stage, "lobby", "solo waits for START");
  await host
    .getByRole("button", { name: "Game settings", exact: true })
    .click();
  await host.locator("dialog[open] .liero-settings select").selectOption("all");
  await host.waitForFunction(
    "window.fusero.state().settings.restrictionPreset === 'all'",
  );
  await host.keyboard.press("Escape");
  await firstWeapon.selectOption(String(weaponId("Rifle")));
  await host.waitForFunction(
    `Object.values(window.fusero.state().loadouts).some(ids=>ids[0]===${weaponId("Rifle")})`,
  );
  await host.getByRole("button", { name: "START MATCH", exact: true }).click();
  await play(host);
  await host.locator(".liero-arena canvas").click();
  const solo = await sample(host);
  assert.deepEqual(
    solo.terrain,
    { width: 504, height: 350, rowCount: 350 },
    "source Dirt Level geometry is retained",
  );
  const soloWorm = solo.worms.find((worm) =>
    solo.seats.some((seat) => seat.id === worm.id && !seat.bot),
  );
  assert.ok(soloWorm);
  assert.equal(soloWorm.slots.length, 5);
  await host.keyboard.down("KeyF");
  await host.waitForFunction(
    `window.fusero.state().world.worms.find(w=>w.id===${JSON.stringify(soloWorm.id)}).slots[0].reloading`,
  );
  await host.keyboard.up("KeyF");
  await host.keyboard.press("Digit2", { delay: 60 });
  await host.waitForFunction(
    `window.fusero.state().world.worms.find(w=>w.id===${JSON.stringify(soloWorm.id)}).weapon===1`,
  );
  const paused = (await sample(host)).worms.find(
    (worm) => worm.id === soloWorm.id,
  )!.slots[0]!.charge;
  await ticks(host, 4);
  assert.equal(
    (await sample(host)).worms.find((worm) => worm.id === soloWorm.id)!
      .slots[0]!.charge,
    paused,
    "switching away pauses native reload",
  );
  console.log(
    "Solo preparation, source map, five weapons, firing and paused reload passed",
  );

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
  const code = new URL(host.url()).searchParams.get("room")!;
  await takeHostSeat(host, "Classic Ada");
  await peer.goto(new URL("fusero/?mute", base).href);
  await openPlayOptions(peer, "join");
  await peer.getByRole("textbox").fill(code);
  await peer.locator(".fui-join-code-button").click();
  await peer.waitForURL(/room=/);
  await peer.locator(".fui-roster-name", { hasText: "Classic Ada" }).waitFor();
  await takeHostSeat(peer, "Classic Bo");
  await host.locator(".fui-roster-name", { hasText: "Classic Bo" }).waitFor();
  await host
    .getByRole("button", { name: "Game settings", exact: true })
    .click();
  await host.locator("dialog[open] .liero-settings select").selectOption("all");
  await Promise.all(
    [host, peer].map((page) =>
      page.waitForFunction(
        "window.fusero.state().settings.restrictionPreset === 'all'",
      ),
    ),
  );
  await host.keyboard.press("Escape");
  for (const page of [host, peer])
    assert.equal(
      await page
        .getByRole("combobox", { name: "Weapon slot 1", exact: true })
        .locator("option")
        .count(),
      38,
    );
  await chooseWeapons(host, "Classic Ada", [
    "Rifle",
    "Bazooka",
    "Grenade",
    "Shotgun",
    "Uzi",
  ]);
  await chooseWeapons(peer, "Classic Bo", [
    "Rifle",
    "Cannon",
    "Handgun",
    "Mini Rockets",
    "Shotgun",
  ]);
  await tv.goto(new URL(`fusero/?room=${code}&display=1&mute`, base).href);
  await tv.locator('.liero-room[data-phase="lobby"]').waitFor();
  await host.getByRole("button", { name: "START MATCH", exact: true }).click();
  await Promise.all([host, peer, tv].map(play));
  await host.locator(".liero-arena canvas").click();
  await host
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await host.locator(".fui-top-bar-menu[open]").waitFor();
  await host.keyboard.press("Escape");
  await host.waitForFunction(
    () => document.activeElement?.tagName === "CANVAS",
  );
  await Promise.all([
    cameraSize(host, 320, 180),
    cameraSize(peer, 192, 144),
    cameraSize(tv, 504, 350),
  ]);
  const initial = await sample(host),
    phone = await sample(peer),
    overview = await sample(tv);
  assert.equal(initial.worms.length, 2, "TV holds no player seat");
  assert.deepEqual(
    initial.seats
      .filter((seat) => !seat.watcher)
      .map((seat) => seat.name)
      .sort(),
    ["Classic Ada", "Classic Bo"],
  );
  assert.equal(initial.camera.overview, false);
  assert.equal(phone.camera.overview, false);
  assert.ok(
    cameraContains(initial.camera, bySlot(initial, 0)),
    "desktop follows its own worm",
  );
  assert.ok(
    cameraContains(phone.camera, bySlot(phone, 1)),
    "phone follows its own worm",
  );
  assert.ok(
    Math.abs(phone.camera.x + phone.camera.width / 2 - bySlot(phone, 1).x) < 5,
    "touch camera stays centred on its own worm",
  );
  assert.deepEqual(overview.camera, {
    x: 0,
    y: 0,
    width: 504,
    height: 350,
    overview: true,
  });
  await tv.locator(".liero-pad").waitFor({ state: "hidden" });
  await tv.locator(".liero-weapon-bar").waitFor({ state: "hidden" });

  await host.keyboard.down("KeyD");
  await peer.waitForFunction(
    "window.fusero.state().world.worms.find(w=>w.slot===0).input & 2",
  );
  // Native carving is a press edge, not continuously held tunnel digging.
  for (let press = 0; press < 6; press++) {
    await host.keyboard.press("KeyG", { delay: 60 });
    await ticks(host, 2);
  }
  await host.keyboard.up("KeyD");
  await peer.waitForFunction(
    "window.fusero.state().world.worms.find(w=>w.slot===0).input === 0",
  );
  const moved = await sample(host);
  assert.ok(
    bySlot(moved, 0).x !== bySlot(initial, 0).x ||
      bySlot(moved, 0).y !== bySlot(initial, 0).y,
    "real movement/carving advances the player",
  );
  assert.ok(
    cameraContains(moved.camera, bySlot(moved, 0)),
    "follow camera retains the moving worm",
  );
  await host.keyboard.down("KeyF");
  await host.waitForFunction(
    "window.fusero.state().world.worms.find(w=>w.slot===0).slots[0].reloading",
  );
  await host.keyboard.up("KeyF");
  await peer.waitForFunction(
    "window.fusero.state().world.worms.find(w=>w.slot===0).slots[0].reloading",
  );
  await ropeAndJump(host, 0);
  console.log(
    `Native controls, rope persistence/jump release and inventory replicated; common hash tick ${await convergence([host, peer, tv])}`,
  );

  assert.ok(
    await peer.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "phone page has no horizontal overflow",
  );
  const fire = peer
    .locator(".liero-pad")
    .getByRole("button", { name: "FIRE", exact: true });
  await fire.scrollIntoViewIfNeeded();
  const box = await fire.boundingBox();
  assert.ok(
    box && box.width >= 44 && box.height >= 44,
    "phone controls retain touch-sized targets",
  );
  await peer
    .locator(".liero-pad")
    .getByRole("button", { name: "NEXT", exact: true })
    .tap();
  await host.waitForFunction(
    "window.fusero.state().world.worms.find(w=>w.slot===1).weapon===1",
  );
  await fire.tap();
  await host.waitForFunction(
    "window.fusero.state().world.worms.find(w=>w.slot===1).slots[1].charge<1",
  );
  await peer.setViewportSize({ width: 844, height: 390 });
  await cameraSize(peer, 320, 180);
  await peer.setViewportSize({ width: 390, height: 844 });
  await cameraSize(peer, 192, 144);
  await tv.setViewportSize({ width: 390, height: 844 });
  await cameraSize(tv, 504, 350);
  await tv.setViewportSize({ width: 1440, height: 900 });
  await peer.reload();
  await play(peer);
  await peer.waitForFunction(
    "window.fusero.state().seats.filter(s=>s.name==='Classic Bo'&&!s.watcher&&s.connected).length===1",
  );
  await cameraSize(peer, 192, 144);
  await peer.locator(".liero-pad").waitFor({ state: "visible" });
  const recovered = await sample(peer);
  assert.ok(
    cameraContains(recovered.camera, bySlot(recovered, 1)),
    "recovered phone follows the same player",
  );
  assert.deepEqual(recovered.terrain, {
    width: 504,
    height: 350,
    rowCount: 350,
  });
  console.log(
    `Touch controls, resize, source-terrain reload and seat recovery passed; common hash tick ${await convergence([host, peer, tv])}`,
  );
  for (const page of [host, peer, tv]) {
    const s = await sample(page);
    assert.equal(s.audio.enabled, false);
    assert.equal(s.audio.loaded, 0);
    assert.equal(s.audio.voices, 0);
  }
  assert.deepEqual(audioRequests, [], "muted previews never request samples");
  assert.deepEqual(errors, [], "no browser runtime exceptions");
  console.log(
    "Fusero Classic smoke passed (solo preparation, two players and a display)",
  );
} catch (error) {
  for (const [index, context] of contexts.entries())
    for (const page of context.pages()) {
      console.error(`Fusero page ${index}: ${page.url()}`);
      console.error((await page.locator("body").innerText()).slice(-2500));
    }
  throw error;
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await server?.stop();
}
