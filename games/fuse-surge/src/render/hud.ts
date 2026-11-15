import type { WorldView } from "../engine/view.js";
import {
  HIGH,
  STEPS_PER_SECOND,
  TALL,
  secondsLeft,
} from "../engine/view-kit.js";
import type { Cue } from "./cues.js";
import {
  DANGER,
  INK,
  PIXEL_FONT,
  TEXT,
  TEXT_DIM,
  WHITE,
  hexA,
  laneColor,
  laneLight,
} from "./palette.js";
import type { SceneCanvas } from "./scene.js";

/**
 * The flat layer over the 3D picture: the clock, the surge speed, a card for every rider, the names over their
 * heads, the arrow under each surge that says what to do, and the banners. It is drawn on its own canvas, on a
 * 960 × 540 board scaled to fit, and takes the places of things in the world as fractions of the picture.
 */
export interface HudSkin {
  /** A low surge's colour, a high one's and a tall one's, for the legend and the arrows. */
  low: string;
  high: string;
  tall: string;
  flip: string;
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

const W = 960,
  H = 540,
  MAX_RATIO = 2;
const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

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
  let banner:
    | { text: string; sub: string; color: string; at: number; ms: number }
    | undefined;

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

  const say = (
    text: string,
    sub: string,
    color: string,
    now: number,
    ms: number,
  ) => {
    banner = { text, sub, color, at: now, ms };
  };

  const react: Hud["react"] = (cues, view, now, names) => {
    const label = (slot: number) =>
      (names[slot] || `RIDER ${slot + 1}`).toUpperCase();
    for (const cue of cues)
      switch (cue.kind) {
        case "count":
          if (cue.seconds > 0)
            say(String(cue.seconds), `ROUND ${view.round}`, WHITE, now, 900);
          break;
        case "go":
          say("GO!", "", skin.flip, now, 700);
          break;
        case "round": {
          const who = cue.winners.map(label);
          if (cue.reason === "time")
            say("TIME!", `${who.join(" · ")} DRAW THE ROUND`, WHITE, now, 2600);
          else if (cue.reason === "wipe")
            say(
              "DOUBLE KO",
              `${who.join(" · ")} DRAW THE ROUND`,
              DANGER,
              now,
              2600,
            );
          else if (cue.winners.length === 1)
            say(
              who[0]!,
              "LAST ONE STANDING",
              laneColor(cue.winners[0]!),
              now,
              2600,
            );
          break;
        }
        default:
          break;
      }
  };

  /** A dark plate, so the text reads on a bright sky as well as a dark one. */
  const plate = (
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    alpha = 0.62,
  ) => {
    c.fillStyle = hexA(INK, alpha);
    c.beginPath();
    c.roundRect(x, y, w, h, 8);
    c.fill();
  };
  /** Text with a dark edge. */
  const ink = (
    c: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    fill: string,
  ) => {
    c.lineJoin = "round";
    c.lineWidth = 4;
    c.strokeStyle = hexA(INK, 0.85);
    c.strokeText(text, x, y);
    c.fillStyle = fill;
    c.fillText(text, x, y);
  };

  const drawBoard = (
    c: CanvasRenderingContext2D,
    view: WorldView,
    now: number,
    local: number,
    names: readonly string[],
  ) => {
    // An endless round has no clock to run out: it shows how long it has lasted.
    const seconds = view.endless
      ? Math.floor(view.elapsed / STEPS_PER_SECOND)
      : secondsLeft(view.clock);
    const urgent = view.phase === "play" && !view.endless && seconds <= 10;
    // The clock and the round.
    plate(c, W / 2 - 118, 12, 236, 64);
    c.textAlign = "center";
    c.font = `28px ${PIXEL_FONT}`;
    c.fillStyle = urgent ? hexA(DANGER, 0.7 + 0.3 * Math.sin(now / 90)) : TEXT;
    c.fillText(
      `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
      W / 2,
      50,
    );
    c.font = `9px ${PIXEL_FONT}`;
    c.fillStyle = TEXT_DIM;
    const round =
      view.target > 1
        ? `ROUND ${view.round} · FIRST TO ${view.target}`
        : `ROUND ${view.round}`;
    c.fillText(view.endless ? `${round} · ENDLESS` : round, W / 2, 67);
    // A tall surge is next out of the arch: say so while there is still time to get ready.
    if (view.tallSoon && Math.floor(now / 160) % 2 === 0) {
      c.textAlign = "right";
      ink(c, "TALL NEXT: DOUBLE JUMP", W - 24, 96, skin.tall);
      c.textAlign = "center";
    }
    // The surge speed, as a bar that fills and a multiple of where the round began.
    const times = view.speedStart > 0 ? view.speed / view.speedStart : 1;
    const fill = clamp01((times - 1) / 2);
    plate(c, W - 182, 12, 170, 64);
    c.textAlign = "right";
    c.fillStyle = TEXT_DIM;
    c.fillText("SURGE SPEED", W - 24, 32);
    c.fillStyle = hexA(TEXT_DIM, 0.35);
    c.fillRect(W - 164, 40, 140, 10);
    c.fillStyle = fill > 0.66 ? DANGER : fill > 0.33 ? "#ffb347" : skin.flip;
    c.fillRect(W - 164, 40, Math.round(140 * Math.max(0.04, fill)), 10);
    c.fillStyle = TEXT;
    c.fillText(`x${times.toFixed(1)}`, W - 24, 66);
    // A legend, so what to do about each kind never needs guessing.
    plate(c, 12, 12, view.tall ? 214 : 158, view.tall ? 88 : 64);
    c.textAlign = "left";
    const legend = (y: number, color: string, up: boolean, text: string) => {
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(31, y + (up ? -7 : 7));
      c.lineTo(39, y + (up ? 5 : -5));
      c.lineTo(23, y + (up ? 5 : -5));
      c.closePath();
      c.fill();
      c.fillStyle = TEXT;
      c.fillText(text, 48, y + 4);
    };
    legend(32, skin.low, true, "LOW: JUMP");
    legend(56, skin.high, false, "HIGH: DUCK");
    if (view.tall) legend(80, skin.tall, true, "TALL: DOUBLE JUMP");
    // The cards.
    const count = view.riders.length,
      width = Math.min(176, (W - 48 - (count - 1) * 10) / count),
      left = (W - (count * width + (count - 1) * 10)) / 2,
      topY = 474;
    for (const each of view.riders) {
      const x = left + each.slot * (width + 10);
      plate(c, x, topY, width, 56, 0.72);
      c.fillStyle = hexA(laneColor(each.slot), each.out ? 0.35 : 1);
      c.beginPath();
      c.roundRect(x, topY, 6, 56, [8, 0, 0, 8]);
      c.fill();
      if (each.slot === local) {
        c.strokeStyle = hexA(WHITE, 0.85);
        c.lineWidth = 2;
        c.beginPath();
        c.roundRect(x + 1, topY + 1, width - 2, 54, 8);
        c.stroke();
      }
      c.textAlign = "left";
      c.font = `9px ${PIXEL_FONT}`;
      c.fillStyle = each.out ? TEXT_DIM : TEXT;
      const name = (names[each.slot] || `RIDER ${each.slot + 1}`).toUpperCase();
      c.fillText(
        name.length > 12 ? `${name.slice(0, 11)}…` : name,
        x + 16,
        topY + 18,
      );
      // Round wins, of the target.
      for (let i = 0; i < view.target; i++) {
        c.fillStyle = i < each.wins ? "#ffe46b" : hexA(TEXT_DIM, 0.35);
        c.fillRect(x + 16 + i * 12, topY + 26, 9, 9);
      }
      // Hits it can still take.
      if (each.out) {
        c.fillStyle = DANGER;
        c.fillText("OUT", x + 16, topY + 50);
      } else {
        const hitsLeft = view.maxHits - each.hits,
          size = view.maxHits > 6 ? 7 : 10;
        for (let i = 0; i < view.maxHits; i++) {
          c.fillStyle = i < hitsLeft ? laneColor(each.slot) : hexA(DANGER, 0.3);
          c.fillRect(x + 16 + i * (size + 3), topY + 41, size, 6);
        }
      }
    }
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
    if (board) drawBoard(g, view, now, local, names);
    if (banner) {
      const age = now - banner.at;
      if (age > banner.ms) banner = undefined;
      else {
        const pop = calm ? 1 : 1 + 0.5 * Math.max(0, 1 - age / 160);
        g.globalAlpha = clamp01((banner.ms - age) / 250);
        g.textAlign = "center";
        g.font = `${Math.round((banner.text.length > 9 ? 34 : 56) * pop)}px ${PIXEL_FONT}`;
        g.lineJoin = "round";
        g.lineWidth = 10;
        g.strokeStyle = hexA(INK, 0.85);
        g.strokeText(banner.text, W / 2, 176);
        g.fillStyle = banner.color;
        g.fillText(banner.text, W / 2, 176);
        if (banner.sub) {
          g.font = `12px ${PIXEL_FONT}`;
          ink(g, banner.sub, W / 2, 208, TEXT);
        }
        g.globalAlpha = 1;
      }
    }
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
