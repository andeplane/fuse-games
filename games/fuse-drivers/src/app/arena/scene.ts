import Phaser from "phaser";
import { registerPhaserPlaytestCapture } from "fuse-ui/playtest-renderer";
import type { FuseDriversView } from "../../game/game.js";
import { config } from "../../game/sim/config.js";
import type { RaceState } from "../../game/sim/race.js";
import { trackFor } from "../../game/rules.js";
import { defaultAssetBase } from "./assets.js";
import {
  focusTruck,
  truckNames,
  type ArenaFrame,
  type ArenaLead,
} from "./frame.js";
import { HudScene } from "./hud-scene.js";
import { renderSnapshot } from "./interpolate.js";
import { RaceScene } from "./race-scene.js";
import { readStadiumTheme, type StadiumTheme } from "./theme.js";
import { safeStore } from "../session.js";

export interface ArenaEngineOptions {
  /** Where the art is served from; ends with a slash. Defaults to `assets/` under the page's base. */
  assetBase?: string;
  /** Force the Canvas backend, for a device whose WebGL is unusable. */
  renderer?: "auto" | "canvas";
  /** A device-local paint choice; changing it does not restart the race. */
  theme?: () => StadiumTheme;
}

export interface ArenaEngine {
  /** Resolves once both scenes exist and the automatic loop has been stopped. */
  ready: Promise<void>;
  render(
    view: FuseDriversView,
    alpha: number,
    selfId?: string,
    lead?: ArenaLead,
  ): void;
  destroy(): void;
}

/**
 * One Phaser game with two scenes and no loop of its own: the caller calls `render` once per animation
 * frame, and `game.step` draws exactly that frame. Phaser's input, audio and physics are all off, so the
 * page keeps every event and the arena only ever paints what the view it is handed says.
 */
export function createArena(
  canvas: HTMLCanvasElement,
  options: ArenaEngineOptions = {},
): ArenaEngine {
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  let booted = false;
  let destroyed = false;
  let pending = 2;
  const sceneReady = (): void => {
    pending--;
    if (pending > 0 || destroyed) return;
    // Phaser must not own the loop: from here the page's own frame loop drives every draw.
    game.loop.stop();
    booted = true;
    resolveReady();
  };
  // Phaser starts only the first scene of the config array, so the race scene starts the HUD beside it.
  const defaultStyle = readStadiumTheme(safeStore(() => window.localStorage));
  const theme = options.theme ?? (() => defaultStyle);
  const race = new RaceScene(
    options.assetBase ?? defaultAssetBase(),
    theme,
    () => {
      if (!game.scene.isActive(HudScene.KEY)) game.scene.start(HudScene.KEY);
      sceneReady();
    },
  );
  const hud = new HudScene(sceneReady);
  const context =
    options.renderer === "canvas"
      ? null
      : canvas.getContext("webgl", { alpha: false, antialias: true });
  const game = new Phaser.Game({
    type: context ? Phaser.WEBGL : Phaser.CANVAS,
    canvas,
    backgroundColor: "#12100e",
    banner: false,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    render: { antialias: true, pixelArt: false, roundPixels: false },
    fps: { target: 60, smoothStep: false },
    // The HUD is laid out for this arcade screen; FIT letterboxes it into whatever box the page gives us.
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      expandParent: false,
      width: config.screen.width,
      height: config.screen.height,
      ...(canvas.parentElement ? { parent: canvas.parentElement } : {}),
    },
    scene: [race, hud],
  });

  const stopCapture = registerPhaserPlaytestCapture(canvas.ownerDocument, game);
  /** The two newest races the page has handed over, newest last. */
  let previous: RaceState | undefined;
  let current: RaceState | undefined;
  let lastNow = 0;

  return {
    ready,
    render(view, alpha, selfId, lead) {
      if (!booted || destroyed) return;
      const next = lead?.current ?? view.race;
      if (!next) return;
      const track = trackFor(next.trackName);
      let newTick = true;
      if (lead) {
        // A forward run hands over its own step before; a run that steps back a step shows no new tick.
        newTick =
          !current || next.tick > current.tick || next.tick < current.tick - 4;
        previous = lead.previous;
      } else if (!current || next.tick < current.tick) {
        // A first view, or a clock that moved back: there is nothing to interpolate from.
        previous = undefined;
      } else if (next.tick > current.tick) previous = current;
      else newTick = false;
      current = next;
      const between = previous ? Math.max(0, Math.min(1, alpha)) : 1;
      const frame: ArenaFrame = {
        view,
        race: next,
        previous,
        alpha: between,
        poses: renderSnapshot(previous, next, between).map((pose, slot) =>
          lead?.place ? lead.place(slot, pose) : pose,
        ),
        track,
        focus: focusTruck(view, next, selfId),
        newTick,
        names: truckNames(view, next.trucks.length),
      };
      const style = theme();
      race.paint(frame, style);
      hud.paint(frame, style);
      const now = performance.now();
      game.step(
        now,
        lastNow ? Math.min(50, Math.max(0, now - lastNow)) : 16.667,
      );
      lastNow = now;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopCapture();
      race.reset();
      game.destroy(false); // the caller owns the canvas element
      // The SceneManager needs its system scene to flush destruction; otherwise the next frame would.
      if (game.scene.isBooted) game.step(0, 0);
    },
  };
}
