import type { PartKind } from "../../game/machine.js";
import {
  type Context,
  GOLD,
  INK,
  LIGHT,
  type PartAppearance,
  type PartPainter,
  STEEL,
  TAU,
  bolt,
  box,
  circle,
  gradient,
  line,
  poly,
  shape,
  sphere,
} from "./canvas.js";

function paintBall(c: Context) {
  const g = c.createRadialGradient(-16, -19, 2, 0, 3, 51);
  for (const [pos, color] of [
    [0, "#fff"],
    [0.2, "#ccf4f5"],
    [0.46, "#86b5c4"],
    [0.55, "#376579"],
    [0.8, "#547c8c"],
    [1, "#233f51"],
  ] as const)
    g.addColorStop(pos, color);
  circle(c, 0, 0, 47, g);
}

function paintBasketball(c: Context) {
  sphere(c, false);
}

function paintBaseball(c: Context) {
  circle(c, 0, 0, 46, gradient(c, "#fffae6", "#f2e9c9", "#c3bfac"));
  for (const f of [-1, 1]) {
    c.save();
    c.scale(f, 1);
    c.beginPath();
    c.arc(-63, 0, 43, -0.94, 0.94);
    c.strokeStyle = "#cc5d54";
    c.lineWidth = 3;
    c.stroke();
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.3,
        x = -63 + 43 * Math.cos(a),
        y = 43 * Math.sin(a);
      line(
        c,
        [
          [x - 3, y + 2],
          [x + 3, y - 2],
        ],
        "#bd514e",
        2.2,
      );
    }
    c.restore();
  }
}

function paintTennis(c: Context) {
  circle(c, 0, 0, 46, gradient(c, "#e7ff99", "#b6d75c", "#78943c"));
  for (const sign of [-1, 1]) {
    c.beginPath();
    c.arc(sign * 63, 0, 46, sign > 0 ? 2.32 : -0.82, sign > 0 ? 3.96 : 0.82);
    c.strokeStyle = "#fff8c8";
    c.lineWidth = 4;
    c.stroke();
  }
}

function paintAnimal(c: Context, { kind, tick }: PartAppearance) {
  const fur =
    kind === "cat" ? "#ebad6c" : kind === "mouse" ? "#a7bab9" : "#a97e65";
  c.beginPath();
  c.moveTo(-20, 25);
  c.bezierCurveTo(-47, 32, -53, 3, -36, -7 + Math.sin(tick * 0.35) * 5);
  c.strokeStyle = INK;
  c.lineWidth = 9;
  c.stroke();
  c.strokeStyle = fur;
  c.lineWidth = 5;
  c.stroke();
  circle(c, -6, 19, 22, fur);
  circle(c, 11, -7, 25, fur);
  if (kind === "cat") {
    poly(
      c,
      [
        [-13, -18],
        [-12, -43],
        [3, -28],
      ],
      fur,
    );
    poly(
      c,
      [
        [15, -30],
        [32, -41],
        [32, -12],
      ],
      fur,
    );
  } else
    for (const x of [-6, 28]) circle(c, x, -27, kind === "mouse" ? 14 : 9, fur);
  circle(c, 19, -10, 3, INK);
  circle(c, 31, -1, 3, "#ed9b8c", INK, 1);
  const stride = Math.sin(tick * 0.55) * 6;
  box(c, [-19 + stride, 32, 24, 9], 4, fur);
  box(c, [8 - stride, 30, 17, 9], 4, fur);
  if (kind === "cat") {
    for (const offset of [0, 6])
      line(
        c,
        [
          [26, 5 + offset],
          [42, 3 + offset],
        ],
        "#926546",
        1.5,
      );
  }
  if (kind === "mouse" || kind === "monkey") {
    line(
      c,
      [
        [-18, 3],
        [-26, -12],
      ],
      GOLD,
      4,
    );
    circle(c, -28, -15, 5, GOLD, INK, 1);
    circle(c, -22, -19, 4, GOLD, INK, 1);
  }
}

function paintFish(
  c: Context,
  { palette: { metal, amber, red } }: PartAppearance,
) {
  c.beginPath();
  c.moveTo(-24, -38);
  c.bezierCurveTo(-62, -2, -42, 33, -18, 42);
  c.lineTo(19, 42);
  c.bezierCurveTo(45, 32, 57, -4, 24, -38);
  c.closePath();
  shape(c, gradient(c, "#accfce", "#629ca4", "#3d7692"), STEEL, 3);
  box(c, [-29, -42, 58, 7], 3, metal, INK, 2);
  c.scale(0.64, 0.64);
  c.translate(-2, 5);
  poly(
    c,
    [
      [13, 4],
      [46, -19],
      [45, 22],
    ],
    amber,
  );
  c.beginPath();
  c.ellipse(-8, 2, 32, 21, 0, 0, TAU);
  shape(c, gradient(c, "#ffcc91", "#eb8865", "#c26452"));
  poly(
    c,
    [
      [-14, -16],
      [0, -34],
      [11, -15],
    ],
    red,
  );
  circle(c, -24, -2, 6, "#fff4cf");
  circle(c, -26, -2, 2, INK);
}

function paintPumpkin(c: Context) {
  box(c, [-3, -42, 10, 19], 4, "#76956a");
  for (const [x, rx, col] of [
    [-19, 24, "#e49048"],
    [18, 24, "#da7d40"],
    [0, 24, "#f09a50"],
  ] as const) {
    c.beginPath();
    c.ellipse(x, 5, rx, 34, 0, 0, TAU);
    shape(c, col, "#965d3c", 2);
  }
}

function paintHeart(c: Context, { palette: { red } }: PartAppearance) {
  c.beginPath();
  c.moveTo(0, 32);
  c.bezierCurveTo(-70, -5, -42, -68, 0, -32);
  c.bezierCurveTo(42, -69, 70, -5, 0, 32);
  shape(c, red);
  poly(
    c,
    [
      [0, 29],
      [-5, 37],
      [5, 37],
    ],
    red,
  );
  line(
    c,
    [
      [0, 37],
      [-2, 44],
      [1, 49],
    ],
    LIGHT,
    2,
  );
}

function paintTree(c: Context) {
  box(c, [-6, 16, 12, 30], 2, "#a37752");
  for (const [y, w] of [
    [34, 41],
    [14, 33],
    [-6, 25],
  ] as const)
    poly(
      c,
      [
        [0, y - 38],
        [-w, y],
        [w, y],
      ],
      gradient(c, "#a4d9ad", "#6baa8b", "#48836e"),
    );
}

function paintBowling(c: Context) {
  sphere(c, true);
}

function paintBalloon(c: Context, { palette: { red } }: PartAppearance) {
  c.beginPath();
  c.moveTo(0, 34);
  c.bezierCurveTo(-16, 26, -45, 3, -45, -18);
  c.bezierCurveTo(-46, -62, 49, -62, 45, -15);
  c.bezierCurveTo(43, 7, 20, 23, 0, 34);
  shape(c, red);
  c.beginPath();
  c.moveTo(-30, -21);
  c.quadraticCurveTo(-28, -36, -11, -39);
  c.strokeStyle = "#ffe2c8";
  c.lineWidth = 5;
  c.stroke();
  poly(
    c,
    [
      [0, 30],
      [-7, 41],
      [6, 41],
    ],
    "#e97664",
    INK,
    2,
  );
  line(
    c,
    [
      [0, 41],
      [4, 45],
      [1, 50],
    ],
    "#d4cbbe",
    2,
  );
}

function paintCrate(c: Context) {
  box(c, [-47, -45, 94, 90], 5, gradient(c, "#edc083", "#ba854f", "#765039"));
  for (const y of [-19, 2, 22])
    line(
      c,
      [
        [-39, y],
        [39, y],
      ],
      "#8b6345",
      2.7,
    );
  poly(
    c,
    [
      [-41, 29],
      [29, -40],
      [40, -29],
      [-29, 40],
    ],
    "#d6a266",
    INK,
    2,
  );
  for (const x of [-42, 32]) box(c, [x, -41, 10, 82], 2, "#e7ba78", INK, 2);
  for (const x of [-36, 36]) for (const y of [-33, 33]) bolt(c, x, y, 2.5);
}

export const bodiesPainters = {
  ball: paintBall,
  basketball: paintBasketball,
  baseball: paintBaseball,
  tennis: paintTennis,
  cat: paintAnimal,
  mouse: paintAnimal,
  monkey: paintAnimal,
  fish: paintFish,
  pumpkin: paintPumpkin,
  heart: paintHeart,
  tree: paintTree,
  bowling: paintBowling,
  balloon: paintBalloon,
  crate: paintCrate,
} satisfies Partial<Record<PartKind, PartPainter>>;
