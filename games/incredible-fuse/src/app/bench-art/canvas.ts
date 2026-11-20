import type { PartKind } from "../../game/machine.js";

export type Context = CanvasRenderingContext2D;
export type Paint = string | CanvasGradient;
export type Point = [number, number];

export const INK = "#0a1925",
  STEEL = "#8abcca",
  LIGHT = "#dfedf0",
  CYAN = "#61f1e2",
  GOLD = "#ffc966";
export const TAU = Math.PI * 2;

export function gradient(
  c: Context,
  top: string,
  middle: string,
  base: string,
): CanvasGradient {
  const g = c.createLinearGradient(0, -46, 0, 46);
  g.addColorStop(0, top);
  g.addColorStop(0.48, middle);
  g.addColorStop(1, base);
  return g;
}
export function shape(c: Context, fill: Paint, edge = INK, width = 3) {
  c.fillStyle = fill;
  c.fill();
  if (width) {
    c.strokeStyle = edge;
    c.lineWidth = width;
    c.stroke();
  }
}
export function box(
  c: Context,
  [x, y, w, h]: readonly [x: number, y: number, width: number, height: number],
  r: number,
  fill: Paint,
  edge = INK,
  width = 3,
) {
  c.beginPath();
  c.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  shape(c, fill, edge, width);
}
export function circle(
  c: Context,
  x: number,
  y: number,
  r: number,
  fill: Paint,
  edge = INK,
  width = 3,
) {
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  shape(c, fill, edge, width);
}
function tracePoints(c: Context, points: Point[]) {
  c.beginPath();
  points.forEach(([x, y], i) => {
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  });
}
export function poly(
  c: Context,
  points: Point[],
  fill: Paint,
  edge = INK,
  width = 3,
) {
  tracePoints(c, points);
  c.closePath();
  shape(c, fill, edge, width);
}
export function line(
  c: Context,
  points: Point[],
  color: string,
  width: number,
) {
  tracePoints(c, points);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}
export function bolt(c: Context, x: number, y: number, r = 4) {
  circle(c, x, y, r, STEEL, INK, 1.5);
  line(
    c,
    [
      [x - r * 0.5, y + r * 0.3],
      [x + r * 0.5, y - r * 0.3],
    ],
    INK,
    1.5,
  );
}
export function roller(
  c: Context,
  x: number,
  y: number,
  r: number,
  turn: number,
) {
  circle(c, x, y, r, "#829eab");
  circle(c, x, y, r * 0.68, "#253c4a", STEEL, 1);
  c.save();
  c.translate(x, y);
  c.rotate(turn);
  for (let i = 0; i < 3; i++) {
    line(
      c,
      [
        [0, -r * 0.22],
        [0, -r * 0.48],
      ],
      "#bdcfd4",
      2.8,
    );
    c.rotate(TAU / 3);
  }
  c.restore();
  circle(c, x, y, r * 0.13, GOLD, INK, 1);
}
export function sphere(c: Context, bowling: boolean) {
  const g = c.createRadialGradient(-17, -22, 2, 0, 3, 56);
  const colors = bowling
    ? ["#f3d9ff", "#b581ec", "#62439b", "#271c45"]
    : ["#fff1b8", "#ffcc56", "#ed862f", "#904027"];
  [0, 0.23, 0.75, 1].forEach((pos, i) => g.addColorStop(pos, colors[i]!));
  circle(c, 0, 0, 47, g, INK, 3);
  c.beginPath();
  c.arc(-2, -1, 39, 3.55, 4.7);
  c.strokeStyle = "#fff8caab";
  c.lineWidth = 3;
  c.stroke();
  if (bowling)
    for (const [x, y] of [
      [-6, -14],
      [9, -19],
      [5, -3],
    ] as const)
      circle(c, x, y, 4.8, "#33223e", "#c8a0d0", 1);
  else {
    c.save();
    c.beginPath();
    c.arc(0, 0, 45, 0, TAU);
    c.clip();
    c.rotate(-0.34);
    for (const x of [-15, 15]) {
      c.beginPath();
      c.ellipse(x, -1, 34, 51, 0, 0, TAU);
      c.strokeStyle = "#7e462d";
      c.lineWidth = 2.8;
      c.stroke();
    }
    line(
      c,
      [
        [-50, 0],
        [50, 0],
      ],
      "#905036",
      2.4,
    );
    c.restore();
  }
}
export function bladeWheel(c: Context, angle: number) {
  c.save();
  c.rotate(angle);
  for (let i = 0; i < 4; i++) {
    c.beginPath();
    c.moveTo(-2, -3);
    c.bezierCurveTo(-30, -14, -32, -38, -14, -36);
    c.bezierCurveTo(1, -36, -4, -21, 4, -6);
    c.closePath();
    shape(c, gradient(c, "#d3f6f0", "#74cfc6", "#278789"), INK, 2);
    c.rotate(Math.PI / 2);
  }
  c.restore();
  circle(c, 0, 0, 8, GOLD);
  circle(c, -2, -2, 2, LIGHT, LIGHT, 0);
}
export function cogs(c: Context, tick: number) {
  c.rotate(tick);
  const points: Point[] = [];
  for (let i = 0; i < 10; i++)
    for (const [offset, r] of [
      [0, 37],
      [0.17, 47],
      [0.55, 47],
      [0.73, 37],
    ] as const) {
      const a = ((i + offset) * TAU) / 10;
      points.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  poly(c, points, gradient(c, "#fce6ae", "#e5ad62", "#936335"));
  circle(c, 0, 0, 29, "#4d5962", "#ffe4a4", 2);
  for (let i = 0; i < 5; i++) {
    c.rotate(TAU / 5);
    circle(c, 0, -20, 4, "#23343c", "#879697", 2);
  }
  circle(c, 0, 0, 10, STEEL);
  bolt(c, 0, 0, 4);
}

/** All artwork uses local part coordinates. The fixture itself supplies the physical dimensions. */
export interface PartPalette {
  metal: CanvasGradient;
  amber: CanvasGradient;
  red: CanvasGradient;
  dark: CanvasGradient;
}
export interface PartAppearance {
  kind: PartKind;
  tick: number;
  active: boolean;
  palette: PartPalette;
}
export type PartPainter = (c: Context, appearance: PartAppearance) => void;
