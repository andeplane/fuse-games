import type { PartKind } from "../../game/machine.js";
import {
  CYAN,
  type Context,
  GOLD,
  INK,
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
} from "./canvas.js";

function paintWallOrTimber(c: Context, { kind }: PartAppearance) {
  box(
    c,
    [-49, -43, 98, 86],
    4,
    kind === "wall"
      ? gradient(c, "#c38b72", "#a16458", "#80544c")
      : gradient(c, "#e2ab72", "#be885c", "#885e43"),
  );
  for (const y of [-16, 13])
    line(
      c,
      [
        [-46, y],
        [46, y],
      ],
      "#674e48",
      3,
    );
  if (kind === "wall") {
    for (const [x, y] of [
      [0, -41],
      [-26, -15],
      [25, -15],
      [1, 13],
    ] as const)
      line(
        c,
        [
          [x, y],
          [x, y + 24],
        ],
        "#674e48",
        3,
      );
  } else
    for (const y of [-31, -1, 27]) {
      line(
        c,
        [
          [-39, y],
          [2, y + 2],
          [17, y],
          [38, y],
        ],
        "#926348",
        2,
      );
      bolt(c, -40, y, 2);
      bolt(c, 40, y, 2);
    }
}

function paintCage(
  c: Context,
  { palette: { metal, amber, dark } }: PartAppearance,
) {
  box(c, [-46, -39, 92, 77], 6, dark);
  for (let x = -37; x <= 38; x += 15)
    line(
      c,
      [
        [x, -34],
        [x, 33],
      ],
      STEEL,
      4,
    );
  box(c, [-48, 33, 96, 10], 3, amber);
  box(c, [-47, -44, 94, 11], 3, metal);
}

function paintPipe(c: Context, { kind, palette: { metal } }: PartAppearance) {
  if (kind === "pipe") c.rotate(Math.PI / 2);
  else c.scale(-1, 1);
  c.beginPath();
  c.moveTo(-44, kind === "pipe" ? 0 : 18);
  if (kind === "pipe") c.lineTo(44, 0);
  else {
    c.lineTo(0, 18);
    c.quadraticCurveTo(22, 18, 22, -9);
    c.lineTo(22, -41);
  }
  c.strokeStyle = INK;
  c.lineWidth = 32;
  c.stroke();
  c.strokeStyle = "#78a6ac";
  c.lineWidth = 26;
  c.stroke();
  box(c, [-47, kind === "pipe" ? -18 : 0, 9, 36], 2, metal);
  if (kind === "pipe") box(c, [38, -18, 9, 36], 2, metal);
  else box(c, [5, -44, 34, 8], 2, metal);
}

function paintRamp(c: Context, { palette: { amber, dark } }: PartAppearance) {
  poly(
    c,
    [
      [-46, -39],
      [47, 35],
      [46, 47],
      [-10, 47],
      [-45, 11],
    ],
    dark,
  );
  poly(
    c,
    [
      [-49, -42],
      [-45, -48],
      [49, 32],
      [47, 41],
    ],
    amber,
  );
  poly(
    c,
    [
      [-34, -12],
      [-17, 4],
      [-33, 6],
    ],
    INK,
    INK,
    1,
  );
  poly(
    c,
    [
      [-14, 12],
      [14, 35],
      [-11, 34],
    ],
    INK,
    INK,
    1,
  );
  line(
    c,
    [
      [-46, -43],
      [46, 35],
    ],
    "#ffe7a7",
    2.2,
  );
  bolt(c, -38, -9, 3);
  bolt(c, 30, 36, 3);
}

function paintShelf(c: Context, { palette: { amber, dark } }: PartAppearance) {
  box(c, [-49, -42, 98, 75], 4, dark);
  box(c, [-49, -45, 98, 24], 3, amber, INK, 2.5);
  for (let x = -38; x < 47; x += 12)
    line(
      c,
      [
        [x, 14],
        [x + 5, -7],
      ],
      "#63818b",
      2.2,
    );
  for (const x of [-43, 43]) bolt(c, x, 14, 2.2);
}

function paintGate(
  c: Context,
  { active, palette: { metal, amber, dark } }: PartAppearance,
) {
  box(c, [-43, -47, 27, 94], 3, metal);
  box(c, [16, -47, 27, 94], 3, metal);
  if (!active) {
    box(c, [-33, -32, 66, 62], 3, dark);
    for (const x of [-24, 0, 24])
      line(
        c,
        [
          [x, -26],
          [x, 22],
        ],
        GOLD,
        5,
      );
  }
  box(c, [-47, -46, 94, 15], 4, active ? CYAN : amber);
  for (const x of [-30, 30]) bolt(c, x, 37, 4);
}

function paintBasket(
  c: Context,
  { active, palette: { amber } }: PartAppearance,
) {
  c.beginPath();
  c.ellipse(0, -23, 44, 17, 0, 0, TAU);
  shape(c, "#192e30", "#c99e62", 5);
  poly(
    c,
    [
      [-44, -23],
      [-33, 39],
      [-20, 48],
      [22, 48],
      [33, 39],
      [44, -23],
      [28, -12],
      [-29, -12],
    ],
    amber,
  );
  for (const x of [-23, -9, 8, 24])
    line(
      c,
      [
        [x, -7],
        [x * 0.74, 35],
      ],
      "#936a47",
      3,
    );
  c.beginPath();
  c.ellipse(0, -24, 45, 18, 0, 0, TAU);
  c.strokeStyle = active ? CYAN : "#ffe3a5";
  c.lineWidth = 4;
  c.stroke();
  line(
    c,
    [
      [-30, 32],
      [-17, 35],
      [20, 35],
      [31, 30],
    ],
    "#6b5142",
    3,
  );
}

function paintDomino(c: Context) {
  box(c, [-40, -47, 80, 94], 7, gradient(c, "#ffecd0", "#d9d7b4", "#b4b295"));
  line(
    c,
    [
      [-30, 0],
      [30, 0],
    ],
    "#879b91",
    2,
  );
  for (const [x, y] of [
    [-17, -29],
    [16, -15],
    [-17, 16],
    [16, 30],
  ] as const)
    circle(c, x, y, 6, INK, INK, 1);
}

function paintSeesaw(
  c: Context,
  { active, palette: { metal, amber } }: PartAppearance,
) {
  poly(
    c,
    [
      [0, -12],
      [-20, 43],
      [21, 43],
    ],
    metal,
  );
  c.save();
  c.rotate(active ? -0.17 : 0.13);
  box(c, [-48, -18, 96, 23], 4, amber);
  line(
    c,
    [
      [-42, -15],
      [41, -15],
    ],
    "#fff0c3",
    3,
  );
  c.restore();
  bolt(c, 0, 7, 8);
}

export const frameworkPainters = {
  wall: paintWallOrTimber,
  timber: paintWallOrTimber,
  cage: paintCage,
  pipe: paintPipe,
  elbow: paintPipe,
  ramp: paintRamp,
  shelf: paintShelf,
  gate: paintGate,
  basket: paintBasket,
  domino: paintDomino,
  seesaw: paintSeesaw,
} satisfies Partial<Record<PartKind, PartPainter>>;
