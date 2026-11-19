import { GATE_X, START_X, footholds } from "../../engine/view-kit.js";
import type { Theme } from "../looks.js";
import { laneColor } from "../palette.js";
import { DECK_DEPTH, UNIT } from "../stage-kit.js";
import { scatter, tint } from "./kit.js";

export const DECK_LEN = 12.8;
export const TEX_W = 2048,
  TEX_H = 1024;
const px = (x: number) => (x / DECK_LEN) * TEX_W;
type Deck = Theme["deck"];

const patterns: Record<
  Deck["pattern"],
  (c: CanvasRenderingContext2D, deck: Deck) => void
> = {
  panel(c, deck) {
    const pw = px(1.6),
      ph = TEX_H / 4;
    for (let i = 0; i * pw < TEX_W; i++)
      for (let j = 0; j < 4; j++) {
        if ((i + j) % 2) {
          c.fillStyle = deck.alt;
          c.fillRect(i * pw, j * ph, pw, ph);
        }
        c.strokeStyle = deck.seam;
        c.lineWidth = 5;
        c.strokeRect(i * pw, j * ph, pw, ph);
        c.fillStyle = deck.seam;
        for (const [dx, dy] of [
          [14, 14],
          [pw - 14, 14],
          [14, ph - 14],
          [pw - 14, ph - 14],
        ] as const) {
          c.beginPath();
          c.arc(i * pw + dx, j * ph + dy, 4, 0, Math.PI * 2);
          c.fill();
        }
      }
  },
  stone(c, deck) {
    const random = scatter(7);
    c.fillStyle = deck.seam;
    c.fillRect(0, 0, TEX_W, TEX_H);
    const rows = 8,
      th = TEX_H / rows,
      tw = px(0.82);
    const a = tint(deck.base),
      b = tint(deck.alt);
    for (let row = 0; row < rows; row++)
      for (let col = -1; col * tw < TEX_W; col++) {
        c.fillStyle = `#${a.clone().lerp(b, random()).getHexString()}`;
        c.beginPath();
        c.roundRect(
          col * tw + (row % 2 ? tw / 2 : 0) + 3,
          row * th + 3,
          tw - 6,
          th - 6,
          7,
        );
        c.fill();
      }
    c.fillStyle = "rgba(60,45,25,0.10)";
    for (let i = 0; i < 900; i++)
      c.fillRect(random() * TEX_W, random() * TEX_H, 3, 3);
  },
  checker(c, deck) {
    const size = TEX_H / 8,
      wide = px((DECK_DEPTH / 8) * 1);
    for (let i = 0; i * wide < TEX_W; i++)
      for (let j = 0; j < 8; j++)
        if ((i + j) % 2) {
          c.fillStyle = deck.alt;
          c.fillRect(i * wide, j * size, wide, size);
        }
  },
  ice(c, deck) {
    const random = scatter(7);
    const wash = c.createLinearGradient(0, 0, TEX_W, TEX_H);
    wash.addColorStop(0, deck.base);
    wash.addColorStop(0.5, deck.alt);
    wash.addColorStop(1, deck.base);
    c.fillStyle = wash;
    c.fillRect(0, 0, TEX_W, TEX_H);
    c.lineCap = "round";
    for (let i = 0; i < 70; i++) {
      let x = random() * TEX_W,
        y = random() * TEX_H;
      c.strokeStyle = `rgba(255,255,255,${0.18 + random() * 0.3})`;
      c.lineWidth = 1 + random() * 2.5;
      c.beginPath();
      c.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (random() - 0.5) * 220;
        y += (random() - 0.5) * 160;
        c.lineTo(x, y);
      }
      c.stroke();
    }
    c.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 260; i++)
      c.fillRect(random() * TEX_W, random() * TEX_H, 2, 2);
  },
  plate(c, deck) {
    const step = px(0.17);
    c.fillStyle = deck.alt;
    for (let i = 0; i * step < TEX_W; i++)
      for (let j = 0; j * step < TEX_H; j++) {
        c.save();
        c.translate(i * step + step / 2, j * step + step / 2);
        c.rotate(((i + j) % 2 ? 1 : -1) * 0.7);
        c.fillRect(-step * 0.34, -2.5, step * 0.68, 5);
        c.restore();
      }
    c.strokeStyle = deck.seam;
    c.lineWidth = 6;
    for (let x = px(2.4); x < TEX_W; x += px(2.4)) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, TEX_H);
      c.stroke();
      c.fillStyle = deck.seam;
      for (let j = 0; j < 9; j++) {
        c.beginPath();
        c.arc(x + 16, 40 + j * 118, 6, 0, Math.PI * 2);
        c.arc(x - 16, 40 + j * 118, 6, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = deck.alt;
    }
  },
};

function paintPitStripe(c: CanvasRenderingContext2D, danger: string): void {
  const stripe = px(0.34);
  c.save();
  c.beginPath();
  c.rect(0, 0, stripe, TEX_H);
  c.clip();
  c.fillStyle = danger;
  c.fillRect(0, 0, stripe, TEX_H);
  c.strokeStyle = "rgba(10,10,20,0.75)";
  c.lineWidth = 22;
  for (let y = -stripe; y < TEX_H + stripe; y += 64) {
    c.beginPath();
    c.moveTo(-10, y);
    c.lineTo(stripe + 10, y + stripe + 20);
    c.stroke();
  }
  c.restore();
}

/** Prepare geometry and colors shared by the color and glow textures of one deck. */
export function deckPainter(theme: Theme, lanes: number, maxHits: number) {
  const laneH = TEX_H / lanes;
  const pads: { top: number; y: number; color: string }[] = [];
  for (let lane = 0; lane < lanes; lane++) {
    const top = lane * laneH;
    pads.push({ top, y: top + laneH * 0.2, color: laneColor(lane) });
  }
  const boundaries: { y: number; width: number }[] = [];
  for (let lane = 0; lane <= lanes; lane++) {
    boundaries.push({
      y: Math.min(TEX_H - 5, Math.max(5, lane * laneH)),
      width: lane === 0 || lane === lanes ? 10 : 4,
    });
  }
  const padX = px(START_X * UNIT - 0.28),
    padWidth = px(0.56),
    padHeight = laneH * 0.6;
  const steps = footholds(maxHits),
    amber = tint("#ffb347"),
    danger = tint(theme.danger);
  const crossings = steps.slice(1).map((x, index) => ({
    x: px(x * UNIT),
    color: `#${amber
      .clone()
      .lerp(danger, (index + 1) / (steps.length - 1))
      .getHexString()}`,
    dash: [26, 20],
  }));
  crossings.push({ x: px(GATE_X * UNIT), color: theme.flip, dash: [10, 22] });
  const deck = theme.deck;
  return (c: CanvasRenderingContext2D, glowOnly: boolean): void => {
    const cross = (x: number, color: string, dash: number[], width: number) => {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.setLineDash(dash);
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, TEX_H);
      c.stroke();
      c.setLineDash([]);
    };
    c.fillStyle = glowOnly ? "#000000" : deck.base;
    c.fillRect(0, 0, TEX_W, TEX_H);
    if (!glowOnly) patterns[deck.pattern](c, deck);
    for (const { top, y, color } of pads) {
      if (!glowOnly) {
        c.globalAlpha = 0.09;
        c.fillStyle = color;
        c.fillRect(0, top, TEX_W, laneH);
      }
      c.globalAlpha = glowOnly ? 0.75 : 0.95;
      c.strokeStyle = color;
      c.lineWidth = 9;
      c.beginPath();
      c.roundRect(padX, y, padWidth, padHeight, 18);
      c.stroke();
      c.globalAlpha = 1;
    }
    c.strokeStyle = deck.line;
    c.globalAlpha = glowOnly ? 0.5 : 0.6;
    for (const { y, width } of boundaries) {
      c.lineWidth = width;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(TEX_W, y);
      c.stroke();
    }
    c.globalAlpha = 1;
    for (const { x, color, dash } of crossings) cross(x, color, dash, 8);
    if (glowOnly) cross(px(0.06), theme.danger, [], 14);
    else paintPitStripe(c, theme.danger);
  };
}
