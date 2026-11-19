import type { WorldView } from "../engine/view.js";
import { HIGH, TALL } from "../engine/view-kit.js";
import type { Cue } from "./cues.js";
import {
  INK,
  PIXEL_FONT,
  TEXT_DIM,
  WHITE,
  hexA,
  laneLight,
} from "./palette.js";
import type { SceneCanvas } from "./scene.js";
import {
  BOARD_WIDTH as W,
  BOARD_HEIGHT as H,
  type BoardSkin,
  clamp01,
  createRoundBanner,
  drawBoard,
  ink,
} from "./scoreboard.js";

/**
 * The flat layer over the 3D picture: the clock, the surge speed, a card for every rider, the names over their
 * heads, the arrow under each surge that says what to do, and the banners. It is drawn on its own canvas, on a
 * 960 × 540 board scaled to fit, and takes the places of things in the world as fractions of the picture.
 */
export interface HudSkin extends BoardSkin {
  accent: string;
}
/** A rider's head in the picture, as fractions from the top left. */
export interface Tag {
  slot: number;
  x: number;
  y: number;
}
/** A surge's near end in the picture, and how faded it is. */
export interface Hint {
  kind: number;
  flips: boolean;
  x: number;
  y: number;
  dim: number;
}
export interface Hud {
  /** Turns what just happened into banners. */
  react(
    cues: readonly Cue[],
    view: WorldView,
    nowMs: number,
    names: readonly string[],
  ): void;
  draw(
    view: WorldView,
    nowMs: number,
    local: number,
    names: readonly string[],
    tags: readonly Tag[],
    hints: readonly Hint[],
  ): void;
  /** Fits the canvas to its box; true when the size changed. */
  resize(): boolean;
  setSkin(skin: HudSkin): void;
}

const MAX_RATIO = 2;
export function createHud(
  canvas: SceneCanvas,
  initial: HudSkin,
  options: {
    pixelRatio?: () => number;
    reducedMotion?: boolean;
    /** Without the board, only the banners, names and arrows are drawn (the menu's demo). */
    board?: boolean;
  } = {},
): Hud {
  const g = canvas.getContext("2d");
  const ratio =
    options.pixelRatio ??
    (() => (typeof devicePixelRatio === "number" ? devicePixelRatio : 1));
  const calm = options.reducedMotion === true;
  const board = options.board !== false;
  let skin = initial;
  let box = { w: -1, h: -1, r: -1 };
  const banner = createRoundBanner(calm, "overlay");
  const resize = () => {
    const r = Math.min(MAX_RATIO, Math.max(1, ratio())),
      w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (box.w === w && box.h === h && box.r === r) return false;
    box = { w, h, r };
    canvas.width = Math.max(1, Math.round(w * r));
    canvas.height = Math.max(1, Math.round(h * r));
    return true;
  };

  const react: Hud["react"] = (cues, view, now, names) => {
    banner.react(cues, view.round, now, names, skin.flip);
  };
  const draw: Hud["draw"] = (view, now, local, names, tags, hints) => {
    if (!g) return;
    resize();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    // Things that follow the world are placed on the whole picture, at the board's scale.
    const scale = Math.min(canvas.width / W, canvas.height / H);
    g.setTransform(scale, 0, 0, scale, 0, 0);
    const pw = canvas.width / scale,
      ph = canvas.height / scale;
    g.textAlign = "center";
    for (const hint of hints) {
      if (hint.dim <= 0.05) continue;
      const x = hint.x * pw,
        y = hint.y * ph + 16,
        up = hint.kind !== HIGH;
      const color = hint.kind === TALL ? skin.tall : up ? skin.low : skin.high;
      g.globalAlpha = clamp01(hint.dim);
      g.fillStyle = hexA(INK, 0.7);
      g.beginPath();
      g.arc(x, y, 13, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(x, y + (up ? -8 : 8));
      g.lineTo(x + 8, y + (up ? 5 : -5));
      g.lineTo(x - 8, y + (up ? 5 : -5));
      g.closePath();
      g.fill();
      if (hint.kind === TALL) {
        // Two arrows: it takes two jumps.
        g.beginPath();
        g.moveTo(x, y - 17);
        g.lineTo(x + 8, y - 6);
        g.lineTo(x - 8, y - 6);
        g.closePath();
        g.fill();
      }
      if (hint.flips) {
        g.font = `8px ${PIXEL_FONT}`;
        ink(g, "FLIP", x, y + 28, skin.flip);
      }
      g.globalAlpha = 1;
    }
    for (const tag of tags) {
      const each = view.riders[tag.slot];
      if (!each || each.out) continue;
      const x = tag.x * pw,
        y = tag.y * ph;
      const name = (names[tag.slot] || "").toUpperCase();
      g.font = `8px ${PIXEL_FONT}`;
      ink(
        g,
        tag.slot === local ? `▼ ${name}` : name,
        x,
        y,
        tag.slot === local ? WHITE : laneLight(tag.slot),
      );
      if (view.recover && each.hits > 0) {
        const pips = view.streakFor;
        for (let i = 0; i < pips; i++) {
          g.fillStyle = hexA(INK, 0.8);
          g.fillRect(x - (pips * 7) / 2 + i * 7 - 1, y + 3, 7, 6);
          g.fillStyle = i < each.streak ? skin.flip : hexA(TEXT_DIM, 0.6);
          g.fillRect(x - (pips * 7) / 2 + i * 7, y + 4, 5, 4);
        }
      }
    }
    // The board and the banners sit on the 960 × 540 board, centred in the picture.
    g.setTransform(
      scale,
      0,
      0,
      scale,
      (canvas.width - W * scale) / 2,
      (canvas.height - H * scale) / 2,
    );
    if (board) drawBoard(g, view, now, local, names, skin);
    banner.draw(g, now);
  };

  return {
    react,
    draw,
    resize,
    setSkin(next) {
      skin = next;
    },
  };
}
