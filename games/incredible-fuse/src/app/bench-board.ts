import {
  PARTS,
  WIDTH,
  HEIGHT,
  getPuzzle,
  partSize,
  type Machine,
  type PartKind,
} from "../game/machine.js";
import { socketPosition, type LinkKind } from "../game/machine-links.js";
import { drawPart } from "./bench-art.js";

export { WIDTH, HEIGHT };
export interface BoardPoint {
  x: number;
  y: number;
}
export interface BoardOverlay {
  selected?: number;
  link?: LinkKind;
  cursor?: BoardPoint;
  ghost?: { kind: PartKind; flip: boolean };
}
type Context = CanvasRenderingContext2D;

function background(c: Context) {
  const g = c.createLinearGradient(0, 0, WIDTH, HEIGHT);
  g.addColorStop(0, "#213b46");
  g.addColorStop(0.55, "#182e39");
  g.addColorStop(1, "#132635");
  c.fillStyle = g;
  c.fillRect(0, 0, WIDTH, HEIGHT);
  c.lineWidth = 0.75;
  for (let x = 0; x <= WIDTH; x += 16) {
    c.strokeStyle = x % 64 === 0 ? "#93c7c51c" : "#93c7c509";
    c.beginPath();
    c.moveTo(x + 0.5, 0);
    c.lineTo(x + 0.5, HEIGHT);
    c.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += 16) {
    c.strokeStyle = y % 64 === 0 ? "#93c7c51c" : "#93c7c509";
    c.beginPath();
    c.moveTo(0, y + 0.5);
    c.lineTo(WIDTH, y + 0.5);
    c.stroke();
  }
  for (let y = 16; y < HEIGHT; y += 32)
    for (let x = 16; x < WIDTH; x += 32) {
      c.fillStyle = "#0a1d279c";
      c.fillRect(x - 1, y - 1, 2, 2);
      c.fillStyle = "#96c6c523";
      c.fillRect(x - 1, y + 1, 2, 1);
    }
  c.strokeStyle = "#89c3c64a";
  c.lineWidth = 1;
  c.beginPath();
  for (let x = 8; x < WIDTH; x += 8) {
    const len = x % 32 === 0 ? 5 : 2;
    c.moveTo(x, 0);
    c.lineTo(x, len);
    c.moveTo(x, HEIGHT);
    c.lineTo(x, HEIGHT - len);
  }
  for (let y = 8; y < HEIGHT; y += 8) {
    const len = y % 32 === 0 ? 5 : 2;
    c.moveTo(0, y);
    c.lineTo(len, y);
    c.moveTo(WIDTH, y);
    c.lineTo(WIDTH - len, y);
  }
  c.stroke();
}

function corners(
  c: Context,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  const l = Math.min(7, w / 3, h / 3);
  c.strokeStyle = color;
  c.lineWidth = 1.5;
  c.beginPath();
  for (const a of [-1, 1])
    for (const b of [-1, 1]) {
      const px = x + (a * w) / 2,
        py = y + (b * h) / 2;
      c.moveTo(px - a * l, py);
      c.lineTo(px, py);
      c.lineTo(px, py - b * l);
    }
  c.stroke();
}

function drawLink(
  c: Context,
  p: BoardPoint,
  q: BoardPoint,
  kind: LinkKind,
  tick: number,
) {
  const dx = q.x - p.x,
    dy = q.y - p.y,
    len = Math.hypot(dx, dy) || 1;
  c.save();
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  if (kind === "belt") {
    const ox = (-dy / len) * 3,
      oy = (dx / len) * 3;
    c.moveTo(p.x + ox, p.y + oy);
    c.lineTo(q.x + ox, q.y + oy);
    c.lineTo(q.x - ox, q.y - oy);
    c.lineTo(p.x - ox, p.y - oy);
    c.closePath();
  } else {
    c.moveTo(p.x, p.y);
    c.quadraticCurveTo(
      (p.x + q.x) / 2,
      (p.y + q.y) / 2 + Math.min(25, len * 0.12),
      q.x,
      q.y,
    );
  }
  c.strokeStyle = "#0b1b22";
  c.lineWidth = 4;
  c.stroke();
  c.strokeStyle =
    kind === "rope" ? "#d6ae7d" : kind === "belt" ? "#a6b5b0" : "#72dccc";
  c.lineWidth = 2;
  c.stroke();
  if (kind !== "wire") {
    c.strokeStyle = kind === "belt" ? "#42616b" : "#96714c";
    c.lineWidth = 1.1;
    c.setLineDash([2, 5]);
    c.lineDashOffset = -tick % 7;
    c.stroke();
  }
  c.restore();
}

const backdrops = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/** Repaint a complete authoritative view, including when time goes backwards on a rewind or rollback. */
export function paintMachine(
  canvas: HTMLCanvasElement,
  machine: Machine,
  overlay: BoardOverlay = {},
) {
  const c = canvas.getContext("2d");
  if (!c) return;
  const desiredWidth = Math.min(
    1920,
    Math.max(
      640,
      Math.round(
        (canvas.clientWidth || WIDTH) *
          (canvas.ownerDocument.defaultView?.devicePixelRatio || 1),
      ),
    ),
  );
  const desiredHeight = Math.round((desiredWidth * HEIGHT) / WIDTH);
  if (canvas.width !== desiredWidth || canvas.height !== desiredHeight) {
    canvas.width = desiredWidth;
    canvas.height = desiredHeight;
  }
  let bg = backdrops.get(canvas);
  if (!bg || bg.width !== desiredWidth || bg.height !== desiredHeight) {
    bg = canvas.ownerDocument.createElement("canvas");
    bg.width = desiredWidth;
    bg.height = desiredHeight;
    const back = bg.getContext("2d");
    if (back) {
      back.scale(desiredWidth / WIDTH, desiredHeight / HEIGHT);
      background(back);
    }
    backdrops.set(canvas, bg);
  }
  c.drawImage(bg, 0, 0);
  c.save();
  c.scale(desiredWidth / WIDTH, desiredHeight / HEIGHT);
  const parts = new Map(machine.parts.map((part) => [part.id, part]));
  const bodies = new Map(machine.bodies.map((body) => [body.id, body]));
  for (const link of machine.links) {
    const a = parts.get(link.a),
      b = parts.get(link.b);
    if (!a || !b) continue;
    const aCenter = a.kind === "popper" ? a : (bodies.get(a.id) ?? a),
      bCenter = b.kind === "popper" ? b : (bodies.get(b.id) ?? b);
    const p = socketPosition(a, link.kind, aCenter, bCenter),
      q = socketPosition(b, link.kind, bCenter, aCenter);
    drawLink(c, p, q, link.kind, machine.tick);
  }
  const puzzle = getPuzzle(machine.puzzle);
  const targets = puzzle.targets;
  const objective = puzzle.objective;
  if (objective?.kind === "quota") {
    const { x, y, width, height } = objective.region;
    const count = machine.bodies.filter(
      (body) =>
        objective.candidates.includes(body.id) &&
        body.x >= x &&
        body.x <= x + width &&
        body.y >= y &&
        body.y <= y + height,
    ).length;
    c.save();
    c.fillStyle = "#78d6bc13";
    c.fillRect(x, y, width, height);
    c.strokeStyle = "#8ae4c5";
    c.lineWidth = 1.2;
    c.setLineDash([4, 4]);
    c.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    c.setLineDash([]);
    corners(c, x + width / 2, y + height / 2, width, height, "#a7ebc7");
    c.fillStyle = "#244b46";
    c.fillRect(x + 3, y + height - 13, 37, 10);
    c.font = "bold 8px monospace";
    c.textAlign = "left";
    c.fillStyle = "#bff0d5";
    c.fillText(count + " / " + objective.count, x + 7, y + height - 5);
    c.restore();
  }
  for (const part of machine.parts) {
    const body = bodies.get(part.id);
    const { x, y } = part.kind === "popper" ? part : (body ?? part);
    const { width: w, height: h } = partSize(part);
    const active = machine.active.includes(part.id);
    const direction = part.flip ? -1 : 1;
    if ((part.kind === "lamp" || part.kind === "lens") && active) {
      c.save();
      c.translate(x, y);
      c.scale(direction, 1);
      const light = c.createLinearGradient(w * 0.4, 0, 180, 0);
      light.addColorStop(0, "#ffdf8770");
      light.addColorStop(1, "#f0dd6800");
      c.beginPath();
      c.moveTo(w * 0.4, -4);
      c.lineTo(180, -21);
      c.lineTo(180, 21);
      c.lineTo(w * 0.4, 4);
      c.closePath();
      c.fillStyle = light;
      c.fill();
      c.restore();
    }
    if (
      (part.kind === "fan" || (part.kind === "bellows" && active)) &&
      machine.tick > 0
    ) {
      c.save();
      c.translate(x, y);
      c.scale(direction, 1);
      c.lineCap = "round";
      c.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const phase = (machine.tick * 2 + i * 17) % 58,
          dy = (i - 1.5) * 4;
        c.strokeStyle = "rgba(181,232,217," + (58 - phase) / 140 + ")";
        c.beginPath();
        c.moveTo(w * 0.5 + phase, dy);
        c.quadraticCurveTo(
          w * 0.5 + phase + 5,
          dy + 2,
          w * 0.5 + phase + 12,
          dy,
        );
        c.stroke();
      }
      c.restore();
    }
    if (active) {
      const glow = c.createRadialGradient(x, y, 1, x, y, Math.max(w, h) * 0.72);
      glow.addColorStop(0, "#90f4cf42");
      glow.addColorStop(1, "#90f4cf00");
      c.fillStyle = glow;
      c.fillRect(x - w, y - h, w * 2, h * 2);
    }
    c.save();
    c.shadowColor = "#061019bb";
    c.shadowOffsetY = 2;
    c.shadowBlur = 2;
    if (part.kind === "domino" && active) {
      c.translate(x, y + h / 2);
      c.rotate((part.flip ? -1 : 1) * 1.19);
      c.translate(-x, -y - h / 2);
    }
    const motion =
      active || part.kind === "fan" || part.kind === "belt" || body
        ? machine.tick
        : 0;
    if (part.rotation === 1) {
      c.translate(x, y);
      c.rotate(Math.PI / 2);
      drawPart(c, part.kind, 0, 0, h, w, part.flip, motion, active);
    } else {
      const face =
        body?.vx && (part.kind === "cat" || part.kind === "mouse")
          ? body.vx < 0
          : part.flip;
      drawPart(c, part.kind, x, y, w, h, face, motion, active);
    }
    c.restore();
    if (part.kind === "popper" && body) {
      const rubber = PARTS.tennis;
      drawPart(
        c,
        "tennis",
        body.x,
        body.y,
        rubber.width,
        rubber.height,
        false,
        0,
        false,
      );
    }
    if (machine.mode === "build" && targets.includes(part.id)) {
      corners(c, x, y, w + 8, h + 8, "#79d5c58c");
      if (targets.length === 1) {
        c.font = "600 8px monospace";
        c.fillStyle = "#a3e8db";
        c.textAlign = "center";
        c.fillText("TARGET", x, y + h / 2 + 14);
      }
    }
    if (
      machine.mode === "build" &&
      objective?.kind === "select" &&
      objective.forbidden.includes(part.id)
    ) {
      corners(c, x, y, w + 8, h + 8, "#ef947e");
      c.font = "600 8px monospace";
      c.fillStyle = "#ffbba8";
      c.textAlign = "center";
      c.fillText("KEEP OFF", x, y + h / 2 + 14);
    }
    if (part.id === overlay.selected) {
      corners(c, x, y, w + 8, h + 8, "#fff09c");
      if (overlay.link && overlay.cursor)
        drawLink(
          c,
          socketPosition(part, overlay.link, body),
          overlay.cursor,
          overlay.link,
          0,
        );
    }
  }
  if (overlay.cursor) {
    const { x, y } = overlay.cursor;
    const ghost = overlay.ghost;
    if (ghost) {
      const piece =
        overlay.selected === undefined
          ? undefined
          : parts.get(overlay.selected);
      const { width: w, height: h } = piece
        ? partSize(piece)
        : PARTS[ghost.kind];
      c.save();
      c.globalAlpha = 0.53;
      if (piece?.rotation === 1) {
        c.translate(x, y);
        c.rotate(Math.PI / 2);
        drawPart(c, ghost.kind, 0, 0, h, w, ghost.flip, 0, false);
      } else drawPart(c, ghost.kind, x, y, w, h, ghost.flip, 0, false);
      c.restore();
      corners(c, x, y, w + 8, h + 8, "#85eee5");
    } else {
      c.strokeStyle = "#e7f4de";
      c.lineWidth = 1.3;
      c.beginPath();
      c.moveTo(x - 7, y);
      c.lineTo(x - 2, y);
      c.moveTo(x + 2, y);
      c.lineTo(x + 7, y);
      c.moveTo(x, y - 7);
      c.lineTo(x, y - 2);
      c.moveTo(x, y + 2);
      c.lineTo(x, y + 7);
      c.stroke();
    }
  }
  c.restore();
}
