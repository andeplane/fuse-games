import type { PartKind } from "../../game/machine.js";
import {
  CYAN,
  type Context,
  GOLD,
  INK,
  LIGHT,
  type PartAppearance,
  type PartPainter,
  type Point,
  STEEL,
  TAU,
  bolt,
  box,
  circle,
  gradient,
  line,
  poly,
  roller,
  shape,
} from "./canvas.js";

function paintSpark(
  c: Context,
  { tick, active, palette: { metal, amber, red } }: PartAppearance,
) {
  box(c, [-37, -23, 74, 64], 6, red);
  box(c, [-41, 32, 82, 12], 3, metal);
  box(c, [-41, -27, 82, 12], 3, amber);
  for (let x = -24; x <= 24; x += 24)
    line(
      c,
      [
        [x - 9, -12],
        [x, 23],
        [x + 9, -12],
      ],
      GOLD,
      3,
    );
  if (active) {
    const pts: Point[] = [];
    for (let i = 0; i < 12; i++) {
      const r = i % 2 ? 8 : 22,
        a = (TAU * i) / 12 + tick * 0.09;
      pts.push([r * Math.cos(a), -23 + r * Math.sin(a)]);
    }
    poly(c, pts, amber, "#e67d49", 2);
  }
}

function paintOutlet(c: Context, { palette: { metal } }: PartAppearance) {
  box(c, [-38, -46, 76, 92], 6, metal);
  box(c, [-25, -24, 50, 50], 12, "#e4debf");
  for (const x of [-10, 10]) box(c, [x - 2, -12, 5, 14], 2, INK);
  circle(c, 0, 10, 4, INK);
  for (const y of [-36, 36]) bolt(c, 0, y, 3);
}

function paintPlunger(
  c: Context,
  { active, palette: { metal, amber, red } }: PartAppearance,
) {
  box(c, [-38, 7, 76, 38], 4, red);
  const press = active ? 22 : 0;
  box(c, [-7, -32 + press, 14, 41 - press], 3, metal);
  box(c, [-32, -40 + press, 64, 12], 5, amber);
  for (const x of [-27, 27]) bolt(c, x, 30, 3);
}

function paintLight(
  c: Context,
  { kind, active, palette: { metal, amber, red } }: PartAppearance,
) {
  if (kind === "candle") {
    box(c, [-17, -9, 34, 49], 4, gradient(c, "#fff3ca", "#edd59d", "#c69e67"));
    line(
      c,
      [
        [0, -7],
        [0, -16],
      ],
      INK,
      3,
    );
    if (active) {
      c.beginPath();
      c.moveTo(0, -12);
      c.bezierCurveTo(-20, -21, -3, -34, 4, -45);
      c.bezierCurveTo(2, -31, 21, -18, 0, -12);
      shape(c, amber, "#dd8657", 2);
    }
  } else if (kind === "bulb") {
    c.beginPath();
    c.moveTo(-13, 11);
    c.bezierCurveTo(-13, 2, -30, -7, -30, -20);
    c.bezierCurveTo(-30, -53, 29, -54, 30, -22);
    c.bezierCurveTo(30, -7, 13, 1, 13, 11);
    c.closePath();
    shape(c, active ? "#ffe69d" : "#9ccbc9");
    line(
      c,
      [
        [-5, 11],
        [-10, -12],
        [0, -5],
        [9, -12],
        [5, 11],
      ],
      GOLD,
      2,
    );
    box(c, [-14, 12, 28, 26], 5, metal);
    for (const y of [18, 25, 32])
      line(
        c,
        [
          [-13, y],
          [12, y - 2],
        ],
        INK,
        2,
      );
  } else {
    box(c, [-40, -15, 56, 32], 7, amber);
    poly(
      c,
      [
        [9, -15],
        [33, -31],
        [42, -29],
        [42, 29],
        [32, 31],
        [9, 16],
      ],
      metal,
    );
    box(c, [-16, -20, 16, 6], 3, red);
    line(
      c,
      [
        [37, -22],
        [37, 21],
      ],
      CYAN,
      4,
    );
  }
}

function paintMotorOrGenerator(
  c: Context,
  { kind, tick, palette: { metal, amber, red } }: PartAppearance,
) {
  box(c, [-45, 29, 90, 14], 4, metal);
  box(c, [-37, -28, 68, 62], 9, kind === "generator" ? amber : metal);
  for (const x of [-20, -11, -2, 7])
    line(
      c,
      [
        [x, -17],
        [x, 19],
      ],
      "#3e5360",
      3,
    );
  box(c, [29, -10, 19, 20], 3, metal);
  roller(c, 27, 0, 14, tick * 0.13);
  box(c, [-25, -40, 23, 12], 3, red);
}

function paintLens(c: Context, { palette: { metal, amber } }: PartAppearance) {
  c.save();
  c.rotate(-0.55);
  box(c, [-5, 13, 10, 40], 4, amber);
  circle(c, 0, -10, 30, metal);
  circle(c, 0, -10, 24, gradient(c, "#b8f0ed", "#75aaa9", "#527887"), INK, 2);
  line(
    c,
    [
      [-14, -15],
      [-7, -24],
      [2, -27],
    ],
    LIGHT,
    3,
  );
  c.restore();
}

function paintRocket(c: Context, { palette: { amber, red } }: PartAppearance) {
  poly(
    c,
    [
      [-13, 13],
      [-30, 32],
      [-25, -2],
      [-12, -18],
    ],
    red,
  );
  poly(
    c,
    [
      [13, 13],
      [30, 32],
      [25, -2],
      [12, -18],
    ],
    red,
  );
  c.beginPath();
  c.moveTo(-12, 23);
  c.bezierCurveTo(-25, -6, -12, -34, 0, -46);
  c.bezierCurveTo(17, -30, 22, -4, 12, 23);
  c.closePath();
  shape(c, amber);
  circle(c, 0, -10, 7, CYAN);
  poly(
    c,
    [
      [-6, 25],
      [1, 43],
      [7, 25],
    ],
    red,
  );
}

function paintSolar(c: Context, { palette: { metal, amber } }: PartAppearance) {
  box(c, [-6, 6, 12, 32], 3, metal);
  box(c, [-27, 34, 54, 9], 3, amber);
  c.save();
  c.rotate(-0.12);
  box(c, [-44, -36, 88, 54], 4, metal);
  box(c, [-40, -32, 80, 46], 2, "#3f6a85", INK, 1);
  for (const x of [-19, 0, 19])
    line(
      c,
      [
        [x, -30],
        [x, 12],
      ],
      "#8cc7cf",
      2,
    );
  line(
    c,
    [
      [-37, -10],
      [37, -10],
    ],
    "#8cc7cf",
    2,
  );
  c.restore();
}

function paintMagnet(c: Context, { palette: { metal } }: PartAppearance) {
  c.beginPath();
  c.moveTo(29, -30);
  c.lineTo(-5, -30);
  c.bezierCurveTo(-47, -30, -47, 30, -5, 30);
  c.lineTo(29, 30);
  c.strokeStyle = INK;
  c.lineWidth = 26;
  c.stroke();
  c.strokeStyle = "#e87967";
  c.lineWidth = 20;
  c.stroke();
  for (const y of [-30, 30]) box(c, [18, y - 11, 26, 22], 2, metal, INK, 2);
  line(
    c,
    [
      [-19, -24],
      [-9, -27],
      [7, -27],
    ],
    "#ffb9a0",
    3,
  );
}

function paintSwitch(
  c: Context,
  { active, palette: { metal, dark } }: PartAppearance,
) {
  box(c, [-45, 5, 90, 34], 5, dark);
  box(c, [-43, 1, 86, 15], 4, metal);
  c.save();
  c.translate(-14, 0);
  if (active) c.rotate(0.64);
  c.translate(14, 0);
  line(
    c,
    [
      [-14, 0],
      [11, -31],
    ],
    INK,
    11,
  );
  line(
    c,
    [
      [-14, 0],
      [11, -31],
    ],
    STEEL,
    6,
  );
  circle(c, 11, -31, 10, active ? CYAN : "#ee825f");
  c.restore();
  circle(c, -14, 0, 8, GOLD);
  box(c, [20, 8, 10, 5], 2, active ? CYAN : "#865944", INK, 1);
}

export const powerPainters = {
  spark: paintSpark,
  outlet: paintOutlet,
  plunger: paintPlunger,
  lamp: paintLight,
  candle: paintLight,
  bulb: paintLight,
  generator: paintMotorOrGenerator,
  motor: paintMotorOrGenerator,
  lens: paintLens,
  rocket: paintRocket,
  solar: paintSolar,
  magnet: paintMagnet,
  switch: paintSwitch,
} satisfies Partial<Record<PartKind, PartPainter>>;
