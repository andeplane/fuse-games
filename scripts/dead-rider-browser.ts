import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchSelected } from "./lib/browser.js";
import { openRidersFixturePage } from "./lib/riders-fixture-page.js";
import { startViteServer } from "./lib/server.js";

// Isolated visual regression: real renderers, synthetic snapshots, no occupied rooms.
const server = await startViteServer();
const browserName = process.env.BROWSER ?? "chrome";
const browser = await launchSelected("chrome");
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await mkdir("artifacts", { recursive: true });
  await openRidersFixturePage(page, server.url);
  for (const mode of ["webgl", "phaser-canvas"] as const) {
    const results = await page.evaluate(async (mode) => {
      const {
        mountWorldArena,
        readArenaPixels,
        pixelOffset,
        arenaRegionDifference,
      } = (await import(
        String("/scripts/lib/riders-render-fixture.ts")
      )) as typeof import("./lib/riders-render-fixture.js");
      const { visualFixture } = (await import(
        String("/scripts/lib/benchmark-fixture.ts")
      )) as typeof import("./lib/benchmark-fixture.js");
      const { themes } = (await import(
        String("/games/fuse-riders/src/render/themes.ts")
      )) as typeof import("../games/fuse-riders/src/render/themes.js");
      const { advanceTrail } = (await import(
        String("/games/fuse-riders/src/engine/trail-lifecycle.ts")
      )) as typeof import("../games/fuse-riders/src/engine/trail-lifecycle.js");
      const { createGame, addPlayer, startMatch, eliminatePlayer } =
        (await import(
          String("/games/fuse-riders/src/engine/game.ts")
        )) as typeof import("../games/fuse-riders/src/engine/game.js");
      const { defaultRoomSettings } = (await import(
        String("/games/fuse-riders/src/engine/room-settings.ts")
      )) as typeof import("../games/fuse-riders/src/engine/room-settings.js");
      // The open arena these shots were framed on, said explicitly now that a game has no settings fallback.
      const classic = {
        ...defaultRoomSettings(),
        map: "classic" as const,
        aimBounce: false,
      };
      const { arena, canvas } = await mountWorldArena(
        mode === "webgl" ? "auto" : "canvas",
      );
      const renderer = arena.metrics().renderer;
      if (mode === "webgl" && arena.metrics().renderer !== "webgl")
        throw Error("WebGL did not start");
      const fixture = visualFixture(100);
      const base = {
        ...fixture,
        players: [],
        bombs: [],
        blasts: [],
        pickups: [],
        portalPairs: [],
        gravityFields: [],
      };
      const player = {
        ...fixture.players[0]!,
        color: "#22d3ee",
        x: 800,
        y: 450,
        shielded: true,
        drunkUntilTick: 200,
        invulnerableUntilTick: 200,
        portalGraceUntilTick: 200,
        trail: [
          {
            x1: 200,
            y1: 200,
            x2: 600,
            y2: 200,
            createdTick: 80,
            expiresAtTick: 200,
          },
        ],
      };
      const read = () => readArenaPixels(canvas, renderer);
      const regionDifference = arenaRegionDifference(canvas, renderer);
      const results = [];
      for (const theme of ["neon-pixel", "clean-neon"] as const) {
        const paint = (players: (typeof player)[], tick = 100) => {
          const snapshot = { ...base, tick, players };
          arena.render(snapshot, 1000, themes[theme], "dead-rider-browser");
          return read();
        };
        arena.reset();
        const empty = paint([]);
        const alive = paint([player]);
        const livingTrail = regionDifference(alive, empty, [250, 198, 300, 4]);
        if (livingTrail <= 0) throw Error("Live trail missing");
        if (regionDifference(alive, empty, [750, 395, 100, 110]) === 0)
          throw Error("Live avatar missing");
        const game = createGame("decaying-trail", classic);
        game.tick = 100;
        addPlayer(game, {
          id: player.id,
          name: player.name,
          slot: 0,
          color: player.color,
        });
        addPlayer(game, {
          id: "other",
          name: "Other",
          slot: 1,
          color: "#ff4fa3",
        });
        startMatch(game);
        game.players.get(player.id)!.trail = structuredClone(player.trail);
        eliminatePlayer(game, player.id);
        const dead = {
          ...player,
          alive: false,
          trail: game.players.get(player.id)!.trail,
        };
        paint([dead]);
        if (arena.metrics().particles === 0) throw Error("Death burst missing");
        // Remove the transient sparks so we can inspect the pooled avatar and its overlays underneath.
        arena.reset();
        const crashed = paint([dead]);
        if (regionDifference(crashed, empty, [750, 395, 100, 110]) !== 0)
          throw Error("Dead rider obscures crash");
        const deadRatio =
          regionDifference(crashed, empty, [250, 198, 300, 4]) / livingTrail;
        if (Math.abs(deadRatio - 1) > 0.01)
          throw Error(`Fresh dead trail lost opacity: ${deadRatio}`);
        const detached = paint([{ ...player, trail: dead.trail }]);
        if (regionDifference(detached, crashed, [250, 198, 300, 4]) !== 0)
          throw Error("Living detached pieces have different styling");
        const at = (pixels: Uint8Array) => {
          const offset = pixelOffset(canvas, renderer, 350, 198);
          return Array.from(pixels.slice(offset, offset + 3));
        };
        const chroma = (pixels: Uint8Array) =>
          Math.max(...at(pixels)) - Math.min(...at(pixels));
        const partial = paint([dead], 130);
        const gray = paint([dead], 160);
        if (!(
          chroma(crashed) > chroma(partial) && chroma(partial) > chroma(gray)
        ))
          throw Error("Trail saturation did not fade gradually");
        if (chroma(gray) > 1) throw Error("Old trail is not neutral gray");
        // A contrasting trail underneath must not show through the solid body.
        const underlay = { ...player, id: "underlay", color: "#ff00ff" };
        for (const tick of [100, 130, 160]) {
          const alone = paint([dead], tick);
          const over = paint([underlay, dead], tick);
          if (at(alone).some((channel, i) => channel !== at(over)[i]))
            throw Error(`Trail body is translucent at tick ${tick}`);
        }
        const frozen = {
          ...base,
          tick: 160,
          presentationTick: 190,
          decidedRound: {
            matchId: "dead-rider-browser",
            round: base.round,
            tick: 130,
            shots: [],
          },
          phase: "roundOver" as const,
          players: [dead],
        };
        arena.render(frozen, 2000, themes[theme], "dead-rider-browser");
        if (at(read()).some((channel, i) => channel !== at(partial)[i]))
          throw Error("Results kept desaturating beyond the final snapshot");
        for (const phase of ["roundOver", "matchOver"] as const) {
          arena.reset(); // A fresh/reconnected renderer also recovers the decision-time color.
          arena.render(
            { ...frozen, phase, tick: 220, presentationTick: 220.5 },
            3000,
            themes[theme],
            "dead-rider-browser",
          );
          if (at(read()).some((channel, i) => channel !== at(partial)[i]))
            throw Error(
              "Advancing result ticks changed the frozen trail color",
            );
        }
        const restored = paint([dead], 100);
        if (at(restored).some((channel, i) => channel !== at(crashed)[i]))
          throw Error("Rollback did not restore trail color");
        // The detached trail holds its shape until the decay clock begins.
        const decayStart = dead.trail[0]!.detached!.decayStartTick;
        const erosionTick = decayStart + 40;
        const shrinking = {
          ...dead,
          trail: advanceTrail(dead.trail, erosionTick, decayStart),
        };
        const eroded = paint([shrinking], erosionTick);
        if (regionDifference(eroded, empty, [210, 190, 50, 20]) !== 0)
          throw Error("Old endpoint did not shrink");
        if (regionDifference(eroded, empty, [540, 190, 50, 20]) !== 0)
          throw Error("New endpoint did not shrink");
        if (regionDifference(eroded, empty, [300, 198, 200, 4]) <= 0)
          throw Error("Surviving middle vanished");
        const expiryTick = erosionTick + 80;
        const removed = paint(
          [
            {
              ...dead,
              trail: advanceTrail(shrinking.trail, expiryTick, erosionTick),
            },
          ],
          expiryTick,
        );
        if (regionDifference(removed, empty, [200, 190, 400, 20]) !== 0)
          throw Error("Eroded trail remains visible");
        const revived = paint([player]);
        if (regionDifference(revived, empty, [750, 395, 100, 110]) === 0)
          throw Error("Live avatar did not return");
        results.push({
          theme,
          deadRatio,
          chroma: [chroma(crashed), chroma(partial), chroma(gray)],
        });
        paint([dead]);
        arena.reset();
        paint([dead]);
      }
      Reflect.set(window, "disposeDeadRiderCheck", () => {
        arena.destroy();
        canvas.remove();
      });
      return results;
    }, mode);
    await page.screenshot({
      path: `artifacts/dead-rider-${mode}-${browserName}.png`,
    });
    await page.evaluate(() => {
      (Reflect.get(window, "disposeDeadRiderCheck") as () => void)();
    });
    console.log(JSON.stringify({ mode, results }));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.stop();
}
