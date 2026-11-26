import {
  PARTS,
  WIDTH,
  HEIGHT,
  getPuzzle,
  partSize,
  conveyorSpeed,
  isBlowing,
  type Body,
  type Machine,
  type Part,
  type PartKind,
} from "../game/machine.js";
import { socketPosition, type LinkKind } from "../game/machine-links.js";
import { drawPart, type PartDrawing } from "./bench-art.js";

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

/** Caller owns the saved board context around the mounted sprite. */
function paintMountedPart(
  c: Context,
  drawing: PartDrawing,
  rotation?: Part["rotation"],
) {
  if (rotation === 1) {
    c.translate(drawing.x, drawing.y);
    c.rotate(Math.PI / 2);
    drawPart(c, {
      ...drawing,
      x: 0,
      y: 0,
      width: drawing.height,
      height: drawing.width,
    });
    return;
  }
  drawPart(c, drawing);
}

function background(c: Context, width = WIDTH, height = HEIGHT, ruler = true) {
  const g = c.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, "#213b46");
  g.addColorStop(0.55, "#182e39");
  g.addColorStop(1, "#132635");
  c.fillStyle = g;
  c.fillRect(0, 0, width, height);
  c.lineWidth = 0.75;
  for (let x = 0; x <= width; x += 16) {
    c.strokeStyle = x % 64 === 0 ? "#93c7c51c" : "#93c7c509";
    c.beginPath();
    c.moveTo(x + 0.5, 0);
    c.lineTo(x + 0.5, height);
    c.stroke();
  }
  for (let y = 0; y <= height; y += 16) {
    c.strokeStyle = y % 64 === 0 ? "#93c7c51c" : "#93c7c509";
    c.beginPath();
    c.moveTo(0, y + 0.5);
    c.lineTo(width, y + 0.5);
    c.stroke();
  }
  for (let y = 16; y < height; y += 32)
    for (let x = 16; x < width; x += 32) {
      c.fillStyle = "#0a1d279c";
      c.fillRect(x - 1, y - 1, 2, 2);
      c.fillStyle = "#96c6c523";
      c.fillRect(x - 1, y + 1, 2, 1);
    }
  if (!ruler) return;
  c.strokeStyle = "#89c3c64a";
  c.lineWidth = 1;
  c.beginPath();
  for (let x = 8; x < width; x += 8) {
    const len = x % 32 === 0 ? 5 : 2;
    c.moveTo(x, 0);
    c.lineTo(x, len);
    c.moveTo(x, height);
    c.lineTo(x, height - len);
  }
  for (let y = 8; y < height; y += 8) {
    const len = y % 32 === 0 ? 5 : 2;
    c.moveTo(0, y);
    c.lineTo(len, y);
    c.moveTo(width, y);
    c.lineTo(width - len, y);
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

function drawLink(c: Context, p: BoardPoint, q: BoardPoint, kind: LinkKind) {
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
    // Links follow their endpoints. The moving parts carry the simulation's rotation and direction.
    c.stroke();
  }
  c.restore();
}

/** Select the visible actuator pose from the same powered circuit and shaft as physics. */
export function spritePose(machine: Machine, part: Part, body?: Body) {
  const blowing = isBlowing(machine, part);
  if (part.kind === "belt") {
    const speed = conveyorSpeed(machine, part);
    return {
      blowing,
      active: speed !== 0,
      face: speed === 0 ? part.flip : speed < 0,
      motion: (machine.tick * Math.abs(speed)) / 4,
    };
  }
  const active =
    part.kind === "fan" || part.kind === "bellows"
      ? blowing
      : machine.active.includes(part.id);
  const face =
    body?.vx && (part.kind === "cat" || part.kind === "mouse")
      ? body.vx < 0
      : part.flip;
  return { blowing, active, face, motion: active || body ? machine.tick : 0 };
}

export interface WorkbenchView {
  width: number;
  height: number;
  board: { x: number; y: number; width: number; height: number };
}

const backdrops = new WeakMap<
  HTMLCanvasElement,
  { image: HTMLCanvasElement; key: string }
>();

/** Repaint a complete authoritative view, including when time goes backwards on a rewind or rollback. */
export function paintMachine(
  canvas: HTMLCanvasElement,
  machine: Machine,
  overlay: BoardOverlay = {},
  view?: WorkbenchView,
) {
  const c = canvas.getContext("2d");
  if (!c) return;
  const displayWidth = view?.width ?? (canvas.clientWidth || WIDTH);
  const displayHeight = view?.height ?? (displayWidth * HEIGHT) / WIDTH;
  const desiredWidth = Math.min(
    1920,
    Math.max(
      640,
      Math.round(
        displayWidth *
          (canvas.ownerDocument.defaultView?.devicePixelRatio || 1),
      ),
    ),
  );
  const desiredHeight = Math.round(
    (desiredWidth * displayHeight) / displayWidth,
  );
  const displayScaleX = desiredWidth / displayWidth;
  const displayScaleY = desiredHeight / displayHeight;
  const board = view?.board ?? {
    x: 0,
    y: 0,
    width: displayWidth,
    height: displayHeight,
  };
  const key = [
    desiredWidth,
    desiredHeight,
    board.x,
    board.y,
    board.width,
    board.height,
  ].join("/");
  if (canvas.width !== desiredWidth || canvas.height !== desiredHeight) {
    canvas.width = desiredWidth;
    canvas.height = desiredHeight;
  }
  let backdrop = backdrops.get(canvas);
  if (backdrop?.key !== key) {
    const image = canvas.ownerDocument.createElement("canvas");
    image.width = desiredWidth;
    image.height = desiredHeight;
    const back = image.getContext("2d");
    if (back) {
      back.scale(displayScaleX, displayScaleY);
      if (view) background(back, displayWidth, displayHeight, false);
      back.translate(board.x, board.y);
      back.scale(board.width / WIDTH, board.height / HEIGHT);
      background(back);
    }
    backdrop = { image, key };
    backdrops.set(canvas, backdrop);
  }
  c.drawImage(backdrop.image, 0, 0);
  c.save();
  c.scale(displayScaleX, displayScaleY);
  c.translate(board.x, board.y);
  c.scale(board.width / WIDTH, board.height / HEIGHT);
  if (view) {
    c.beginPath();
    c.rect(0, 0, WIDTH, HEIGHT);
    c.clip();
  }
  const parts = new Map(machine.parts.map((part) => [part.id, part]));
  const bodies = new Map(machine.bodies.map((body) => [body.id, body]));
  for (const [index, link] of machine.links.entries()) {
    if (machine.broken.includes(index)) continue;
    const a = parts.get(link.a),
      b = parts.get(link.b);
    if (!a || !b) continue;
    const aCenter = a.kind === "popper" ? a : (bodies.get(a.id) ?? a),
      bCenter = b.kind === "popper" ? b : (bodies.get(b.id) ?? b);
    const p = socketPosition(a, link.kind, aCenter, bCenter),
      q = socketPosition(b, link.kind, bCenter, aCenter);
    drawLink(c, p, q, link.kind);
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
    const { active, blowing, face, motion } = spritePose(machine, part, body);
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
    if (blowing && machine.tick > 0) {
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
      const radius = Math.max(w, h) * 0.72;
      const glow = c.createRadialGradient(x, y, 1, x, y, radius);
      glow.addColorStop(0, "#90f4cf42");
      glow.addColorStop(1, "#90f4cf00");
      c.fillStyle = glow;
      c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
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
    paintMountedPart(
      c,
      {
        kind: part.kind,
        x,
        y,
        width: w,
        height: h,
        flip: face,
        tick: motion,
        active,
      },
      part.rotation,
    );
    c.restore();
    if (part.kind === "popper" && body) {
      const rubber = PARTS.tennis;
      drawPart(c, {
        kind: "tennis",
        x: body.x,
        y: body.y,
        width: rubber.width,
        height: rubber.height,
        flip: false,
        tick: 0,
        active: false,
      });
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
      paintMountedPart(
        c,
        {
          kind: ghost.kind,
          x,
          y,
          width: w,
          height: h,
          flip: ghost.flip,
          tick: 0,
          active: false,
        },
        piece?.rotation,
      );
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
