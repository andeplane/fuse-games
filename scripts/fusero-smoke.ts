import assert from "node:assert/strict";
import type { Page } from "playwright";
import { launchSelected } from "./lib/browser.js";
import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
import { startRoomService } from "./lib/server.js";
import { startGameCoverage } from "./lib/game-browser-coverage.js";
import { CLASSIC_WEAPONS } from "../games/fusero/src/engine/classic/catalog.js";
import { CLASSIC_LEVELS } from "../games/fusero/src/engine/classic/level.js";

/** Native Classic behavior through real menus and controls; the app hook is read-only. */
const server = process.env.ONLINE_URL ? undefined : await startRoomService();
const base = process.env.ONLINE_URL ?? server!.url;
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
const errors: string[] = [],
  audioRequests: string[] = [],
  reportRequests: string[] = [];
const coverage = new Map<Page, () => Promise<void>>();
let succeeded = false;
async function checkpointCoverage(page: Page): Promise<void> {
  const finish = coverage.get(page);
  if (!finish) return;
  await finish();
  coverage.set(page, await startGameCoverage(page, { gameId: "fusero" }));
}
const contexts = await Promise.all([
  browser.newContext({ viewport: { width: 1280, height: 720 } }),
  browser.newContext({
    viewport: { width: 393, height: 852 },
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
  level: string;
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
    level:w?.settings.level??s.settings.level,
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
async function nativeScale(page: Page): Promise<void> {
  const scale = await page.evaluate<{
    render: {
      worldPixelsPerNativePixel: number;
      worm: { width: number; height: number };
      crosshair: { distance: number; width: number; height: number };
      pixelProjectile: { width: number; height: number };
    };
    canvasWidth: number;
    canvasHeight: number;
    camera: Camera;
  }>(`(() => {
    const c=document.querySelector('.liero-arena canvas');
    const camera=window.fusero.camera();
    return {render:window.fusero.scale(),canvasWidth:c.width,canvasHeight:c.height,camera};
  })()`);
  assert.deepEqual(scale.render, {
    worldPixelsPerNativePixel: 0.5,
    worm: { width: 10, height: 9 },
    crosshair: { distance: 16, width: 3, height: 3 },
    pixelProjectile: { width: 1, height: 1 },
  });
  assert.equal(scale.canvasWidth, scale.camera.width * 2);
  assert.equal(scale.canvasHeight, scale.camera.height * 2);
}
function sourceTerrain(s: Sample): void {
  const level = CLASSIC_LEVELS.find((level) => level.id === s.level);
  assert.ok(level, `selected source level ${s.level} exists`);
  assert.deepEqual(s.terrain, {
    width: level.width,
    height: level.height,
    rowCount: level.height,
  });
}
async function nativeKeys(
  page: Page,
): Promise<{ fire: string; jump: string; mac: boolean }> {
  const mac = await page.evaluate<boolean>(
    "window.fusero.keyboard().platform === 'mac'",
  );
  return {
    mac,
    fire: mac ? "AltLeft" : "ControlLeft",
    jump: mac ? "MetaLeft" : "AltLeft",
  };
}
async function keyboardPreset(
  page: Page,
  platform: "pc" | "mac",
): Promise<void> {
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  assert.equal(
    await page.getByRole("button", { name: /^Report · Ctrl\+X$/i }).count(),
    1,
    "the explicit reporting action remains available in the menu",
  );
  await page.getByRole("button", { name: /^game controls$/i }).click();
  await page
    .getByRole("combobox", { name: "Keyboard preset", exact: true })
    .selectOption(platform);
  await page.waitForFunction(
    `window.fusero.keyboard().platform === ${JSON.stringify(platform)}`,
  );
  await page.getByRole("button", { name: "CONTROLS", exact: true }).click();
  for (const label of platform === "mac"
    ? ["Left Option", "Left Command"]
    : ["Left Ctrl", "Left Alt"])
    await page.waitForFunction(
      `document.querySelector('.fui-game-menu-controls')?.textContent.includes(${JSON.stringify(label)})`,
    );
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "BACK TO GAME", exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement?.tagName === "CANVAS",
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
async function configurationRoom(page: Page, solo: boolean): Promise<void> {
  const room = page.locator(".fui-room-configuration");
  await room.waitFor();
  assert.equal(await room.locator(".fui-invite").count(), solo ? 0 : 1);
  assert.equal(
    await room.locator(".fui-room-seats .fui-room-open-slot").count(),
    5,
  );
  assert.equal(
    await room
      .locator(".fui-room-configuration-content .liero-loadout")
      .count(),
    1,
  );
  const previousSize = page.viewportSize();
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 844, height: 390 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(size);
    const geometry = await room.evaluate((root) => ({
      seats: root
        .querySelector(".fui-room-seats")!
        .getBoundingClientRect()
        .toJSON(),
      choices: root
        .querySelector(".fui-room-configuration-content")!
        .getBoundingClientRect()
        .toJSON(),
      scrollWidth: document.documentElement.scrollWidth,
      width: innerWidth,
    }));
    assert.ok(geometry.scrollWidth <= geometry.width + 1);
    if (size.width > 640)
      assert.ok(
        geometry.seats.right <= geometry.choices.left,
        "players stay left of game options",
      );
    else
      assert.ok(
        geometry.seats.bottom <= geometry.choices.top,
        "phone lists players before game options",
      );
    await page
      .getByRole("combobox", { name: "Weapon slot 5", exact: true })
      .scrollIntoViewIfNeeded();
    await page
      .getByRole("button", { name: "START MATCH", exact: true })
      .scrollIntoViewIfNeeded();
  }
  if (previousSize) await page.setViewportSize(previousSize);
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
  const keys = await nativeKeys(page);
  await page.keyboard.down("ArrowDown");
  await page.waitForFunction(
    `window.fusero.state().world.worms.find(w=>w.slot===${slot}).aim >= 50`,
  );
  await page.keyboard.up("ArrowDown");
  await page.keyboard.press("KeyX", { delay: 60 });
  await page.waitForFunction(
    `window.fusero.state().world.worms.find(w=>w.slot===${slot}).rope !== null`,
  );
  await ticks(page, 3);
  assert.notEqual(
    bySlot(await sample(page), slot).rope,
    null,
    "releasing the rope key retains the native rope",
  );
  await page.keyboard.press(keys.jump, { delay: 60 });
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
    coverage.set(page, await startGameCoverage(page, { gameId: "fusero" }));
    page.setDefaultTimeout(20_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.includes("/fusero/audio/"))
        audioRequests.push(request.url());
      if (new URL(request.url()).pathname === "/api/telemetry/reports")
        reportRequests.push(request.url());
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
  await openPlayOptions(host);
  const sharedChoice = host.getByRole("checkbox", {
    name: "Shared TV + phone controllers",
  });
  await sharedChoice.check();
  await checkpointCoverage(host);
  await host.reload();
  await openPlayOptions(host);
  assert.equal(
    await sharedChoice.isChecked(),
    true,
    "TV preference survives reload",
  );
  await sharedChoice.uncheck();
  await checkpointCoverage(host);
  await host.reload();
  await openPlayOptions(host);
  assert.equal(
    await sharedChoice.isChecked(),
    false,
    "individual play preference survives reload",
  );
  await openPlayOptions(host, "single");
  await host.locator('.liero-room[data-phase="lobby"]').waitFor();
  const firstWeapon = host.getByRole("combobox", {
    name: "Weapon slot 1",
    exact: true,
  });
  await firstWeapon.waitFor();
  await configurationRoom(host, true);
  const ownSlot = (await sample(host)).seats.find((seat) => !seat.bot)!.slot;
  await host
    .getByRole("button", { name: "Sit here", exact: true })
    .first()
    .click();
  await host.waitForFunction(
    `window.fusero.state().seats.some(s=>!s.bot&&!s.watcher&&s.slot!==${ownSlot})`,
  );
  await host
    .locator(`.fui-room-open-slot[data-slot="${ownSlot}"]`)
    .getByRole("button", { name: "Sit here", exact: true })
    .click();
  await host.waitForFunction(
    `window.fusero.state().seats.some(s=>!s.bot&&!s.watcher&&s.slot===${ownSlot})`,
  );
  const botCount = (await sample(host)).seats.filter((seat) => seat.bot).length;
  await host
    .getByRole("button", { name: "Remove bot", exact: true })
    .first()
    .click();
  await host.waitForFunction(
    `window.fusero.state().seats.filter(s=>s.bot).length===${botCount - 1}`,
  );
  await host
    .getByRole("button", { name: "Add AI", exact: true })
    .first()
    .click();
  await host.waitForFunction(
    `window.fusero.state().seats.filter(s=>s.bot).length===${botCount}`,
  );
  assert.equal((await sample(host)).stage, "lobby", "solo waits for START");
  await host
    .getByRole("button", { name: "Room settings", exact: true })
    .click();
  await host
    .getByRole("combobox", { name: "Weapons", exact: true })
    .selectOption("all");
  const levelChoice = host.getByRole("combobox", {
    name: "Level",
    exact: true,
  });
  assert.equal(
    await levelChoice.inputValue(),
    "jail-break",
    "the larger source level is the default",
  );
  const alternateLevel = CLASSIC_LEVELS.find(
    (level) => level.id !== "jail-break",
  )!;
  await levelChoice.selectOption(alternateLevel.id);
  await host.waitForFunction(
    `window.fusero.state().settings.level===${JSON.stringify(alternateLevel.id)}`,
  );
  await levelChoice.selectOption("jail-break");
  await host.waitForFunction(
    "window.fusero.state().settings.level==='jail-break'",
  );
  const loading = host.getByRole("spinbutton", {
    name: "Loading time %",
    exact: true,
  });
  await loading.fill("90");
  await loading.press("Tab");
  await host.waitForFunction("window.fusero.state().settings.loadingTime===90");
  await loading.fill("100");
  await loading.press("Tab");
  await host.waitForFunction(
    "window.fusero.state().settings.loadingTime===100",
  );
  for (const [label, setting] of [
    ["Health and weapon bonuses", "bonuses"],
    ["Weapons can injure their owner", "selfInjure"],
  ]) {
    const checkbox = host.getByRole("checkbox", { name: label, exact: true });
    const original = await checkbox.isChecked();
    await checkbox.setChecked(!original);
    await host.waitForFunction(
      `window.fusero.state().settings.${setting}===${!original}`,
    );
    await checkbox.setChecked(original);
    await host.waitForFunction(
      `window.fusero.state().settings.${setting}===${original}`,
    );
  }
  await host.waitForFunction(
    "window.fusero.state().settings.restrictionPreset === 'all'",
  );
  await host
    .getByRole("spinbutton", { name: "Minutes (−1: unlimited)", exact: true })
    .fill("0.5");
  await host
    .getByRole("spinbutton", {
      name: "Kill limit (−1: unlimited)",
      exact: true,
    })
    .fill("-1");
  await host.keyboard.press("Tab");
  await host.waitForFunction(
    "window.fusero.state().settings.timeLimitMs === 30000 && window.fusero.state().settings.killLimit === -1",
  );
  await host.keyboard.press("Escape");
  await firstWeapon.selectOption(String(weaponId("Rifle")));
  await host.waitForFunction(
    `Object.values(window.fusero.state().loadouts).some(ids=>ids[0]===${weaponId("Rifle")})`,
  );
  await host.getByRole("button", { name: "START MATCH", exact: true }).click();
  await play(host);
  const rightPad = host
    .locator(".liero-pad")
    .getByRole("button", { name: "RIGHT", exact: true });
  await rightPad.focus();
  await host.keyboard.down("Enter");
  await host.waitForFunction(
    `window.fusero.state().world.worms.find(w=>w.slot===${ownSlot}).input & 2`,
  );
  await host.keyboard.up("Enter");
  await host.waitForFunction(
    `window.fusero.state().world.worms.find(w=>w.slot===${ownSlot}).input===0`,
  );
  await host.locator(".liero-arena canvas").click();
  const solo = await sample(host);
  const bots = solo.seats.filter((seat) => seat.bot);
  assert.ok(bots.length, "solo starts with AI opponents");
  const arsenal = [
    "Super Shotgun",
    "Napalm",
    "Cannon",
    "Doomsday",
    "Chaingun",
  ].map(weaponId);
  for (const bot of bots)
    assert.deepEqual(
      solo.worms
        .find((worm) => worm.id === bot.id)!
        .slots.map((slot) => slot.weaponId),
      arsenal,
      "the real solo start uses the source 100lt bot arsenal",
    );
  sourceTerrain(solo);
  assert.equal(solo.level, "jail-break");
  await cameraSize(host, 427, 240);
  await nativeScale(host);
  await host.setViewportSize({ width: 393, height: 852 });
  await cameraSize(host, 160, 240);
  await nativeScale(host);
  await host.setViewportSize({ width: 1280, height: 720 });
  await cameraSize(host, 427, 240);
  const soloWorm = solo.worms.find((worm) =>
    solo.seats.some((seat) => seat.id === worm.id && !seat.bot),
  );
  assert.ok(soloWorm);
  assert.equal(soloWorm.slots.length, 5);
  const keys = await nativeKeys(host);
  assert.equal(
    keys.mac,
    false,
    "new browser sessions use the original PC/web controls",
  );
  await host.keyboard.down(keys.fire);
  await host.waitForFunction(
    `window.fusero.state().world.worms.find(w=>w.id===${JSON.stringify(soloWorm.id)}).slots[0].reloading`,
  );
  await host.keyboard.up(keys.fire);
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
  await host.keyboard.press("KeyA", { delay: 60 });
  await host.waitForFunction(
    `window.fusero.state().world.worms.find(w=>w.id===${JSON.stringify(soloWorm.id)}).weapon===0`,
  );
  await host.keyboard.press("KeyS", { delay: 60 });
  await host.waitForFunction(
    `window.fusero.state().world.worms.find(w=>w.id===${JSON.stringify(soloWorm.id)}).weapon===1`,
  );
  console.log(
    "Solo preparation, source map, five weapons, firing and paused reload passed",
  );

  // Exercise the actual public end-of-match UI after an ordinary 30-second
  // timed match. No debug hook writes or synthetic simulation clock advances.
  const completedMatch = await host.evaluate<string>(
    "window.fusero.state().matchId",
  );
  const results = host.getByRole("dialog", {
    name: "Match results",
    exact: true,
  });
  await results.waitFor({ state: "visible", timeout: 45_000 });
  assert.equal(
    await host.evaluate(() =>
      Boolean(document.activeElement?.closest(".fui-results")),
    ),
    true,
    "match completion moves keyboard focus into the shared results",
  );
  const completed = await sample(host);
  assert.equal(completed.stage, "over");
  assert.equal(completed.phase, "done");
  assert.ok(completed.elapsedMs >= 30_000 && completed.elapsedMs < 31_000);
  assert.equal(
    await results.locator(".fui-results-brand").innerText(),
    "FUSERO",
  );
  for (const name of ["KILLS", "DEATHS", "SCORE"])
    assert.equal(
      await results.getByRole("columnheader", { name, exact: true }).count(),
      1,
    );
  assert.equal(
    await results
      .getByRole("button", { name: "LOBBY", exact: true })
      .isVisible(),
    true,
  );
  await results.getByRole("button", { name: /^REMATCH\b/ }).click();
  await play(host);
  await host.waitForFunction(
    `window.fusero.state().matchId !== ${JSON.stringify(completedMatch)}`,
  );
  await results.waitFor({ state: "hidden" });
  assert.equal(
    await host.evaluate(() => document.activeElement?.tagName),
    "CANVAS",
    "rematch returns keyboard focus to the game",
  );
  console.log(
    "A real timed match shows shared results, standings and actions; REMATCH starts a new live match",
  );

  // Save the completed solo flow before leaving its document for room creation.
  await checkpointCoverage(host);
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
  await configurationRoom(host, false);
  await host
    .getByRole("button", { name: "Room settings", exact: true })
    .click();
  await host
    .getByRole("combobox", { name: "Weapons", exact: true })
    .selectOption("all");
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
  await Promise.all([cameraSize(host, 320, 240), cameraSize(peer, 320, 240)]);
  const initial = await sample(host),
    phone = await sample(peer);
  await cameraSize(tv, initial.terrain.width, initial.terrain.height);
  const overview = await sample(tv);
  sourceTerrain(initial);
  sourceTerrain(phone);
  sourceTerrain(overview);
  await Promise.all([host, peer, tv].map(nativeScale));
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
    width: initial.terrain.width,
    height: initial.terrain.height,
    overview: true,
  });
  await tv.locator(".liero-pad").waitFor({ state: "hidden" });
  await tv.locator(".liero-weapon-bar").waitFor({ state: "hidden" });

  await host.keyboard.down("ArrowRight");
  await peer.waitForFunction(
    "window.fusero.state().world.worms.find(w=>w.slot===0).input & 2",
  );
  // Native carving is a press edge, not continuously held tunnel digging.
  for (let press = 0; press < 6; press++) {
    await host.keyboard.down("ArrowLeft");
    await peer.waitForFunction(
      "(window.fusero.state().world.worms.find(w=>w.slot===0).input & 3) === 3",
    );
    await host.keyboard.up("ArrowLeft");
    await ticks(host, 2);
  }
  await host.keyboard.up("ArrowRight");
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
  await host.keyboard.down(keys.fire);
  await host.waitForFunction(
    "window.fusero.state().world.worms.find(w=>w.slot===0).slots[0].reloading",
  );
  await host.keyboard.up(keys.fire);
  await peer.waitForFunction(
    "window.fusero.state().world.worms.find(w=>w.slot===0).slots[0].reloading",
  );
  await ropeAndJump(host, 0);
  // Original PC fire + rope is Ctrl+X, which must reach the game rather than
  // the platform's report shortcut while this player owns the controls.
  await host.keyboard.down("ControlLeft");
  await host.keyboard.down("KeyX");
  await peer.waitForFunction(
    "(window.fusero.state().world.worms.find(w=>w.slot===0).input & 96) === 96",
  );
  assert.equal(
    await host.locator("dialog[open]").count(),
    0,
    "firing and throwing the rope must not open a report dialog",
  );
  await host.keyboard.up("KeyX");
  await peer.waitForFunction(
    "window.fusero.state().world.worms.find(w=>w.slot===0).input === 32",
  );
  await ticks(host, 3);
  assert.notEqual(
    bySlot(await sample(host), 0).rope,
    null,
    "the rope persists after X is released while firing",
  );
  await host.keyboard.up("ControlLeft");
  await peer.waitForFunction(
    "window.fusero.state().world.worms.find(w=>w.slot===0).input === 0",
  );
  assert.equal(await host.locator("dialog[open]").count(), 0);
  await host
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await host.getByRole("button", { name: /^Report · Ctrl\+X$/i }).click();
  const report = host.getByRole("dialog", { name: "Report", exact: true });
  await report.waitFor({ state: "visible" });
  await report.getByRole("button", { name: /^back$/i }).click();
  await report.waitFor({ state: "hidden" });
  await host.locator(".liero-arena canvas").click();
  await keyboardPreset(host, "mac");
  const macKeys = await nativeKeys(host);
  assert.equal(macKeys.mac, true);
  await host.keyboard.down(macKeys.fire);
  await peer.waitForFunction(
    "window.fusero.state().world.worms.find(w=>w.slot===0).input & 32",
  );
  await host.keyboard.up(macKeys.fire);
  // Browsers can omit an arrow keyup while Command is held. Releasing native
  // Mac jump must clear the chord rather than leave a stale walking input.
  await host.keyboard.down("ArrowRight");
  await host.keyboard.down(macKeys.jump);
  await host.keyboard.up("ArrowRight");
  await host.keyboard.up(macKeys.jump);
  await peer.waitForFunction(
    "window.fusero.state().world.worms.find(w=>w.slot===0).input === 0",
  );
  await keyboardPreset(host, "pc");
  assert.equal((await nativeKeys(host)).mac, false);
  console.log(
    `Native PC/Mac presets, rope persistence/jump release and inventory replicated; common hash tick ${await convergence([host, peer, tv])}`,
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
  await cameraSize(peer, 320, 240);
  await peer.setViewportSize({ width: 393, height: 852 });
  await cameraSize(peer, 320, 240);
  await tv.setViewportSize({ width: 393, height: 852 });
  await cameraSize(tv, initial.terrain.width, initial.terrain.height);
  await tv.setViewportSize({ width: 1440, height: 900 });
  await checkpointCoverage(peer);
  await peer.reload();
  await play(peer);
  await peer.waitForFunction(
    "window.fusero.state().seats.filter(s=>s.name==='Classic Bo'&&!s.watcher&&s.connected).length===1",
  );
  await cameraSize(peer, 320, 240);
  await peer.locator(".liero-pad").waitFor({ state: "visible" });
  const recovered = await sample(peer);
  assert.ok(
    cameraContains(recovered.camera, bySlot(recovered, 1)),
    "recovered phone follows the same player",
  );
  assert.deepEqual(recovered.terrain, initial.terrain);
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
  assert.deepEqual(
    reportRequests,
    [],
    "opening and closing a report never submits one",
  );
  assert.deepEqual(errors, [], "no browser runtime exceptions");
  succeeded = true;
  console.log(
    "Fusero Classic smoke passed (solo preparation, two players and a display)",
  );
} catch (error) {
  console.error(error);
  for (const [index, context] of contexts.entries())
    for (const page of context.pages()) {
      console.error(`Fusero page ${index}: ${page.url()}`);
      console.error((await page.locator("body").innerText()).slice(-2500));
    }
  throw error;
} finally {
  try {
    const collected = await Promise.allSettled(
      [...coverage.values()].map((finish) => finish()),
    );
    const failures = collected.filter((result) => result.status === "rejected");
    if (succeeded && failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        "Fusero coverage collection failed",
      );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await browser.close();
    await server?.stop();
  }
}
