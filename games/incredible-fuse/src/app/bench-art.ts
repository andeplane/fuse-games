import { PARTS, type PartKind } from "../game/machine.js";

type Context = CanvasRenderingContext2D;
type Paint = string | CanvasGradient;
type Point = [number, number];

const INK = "#0a1925",
  STEEL = "#8abcca",
  LIGHT = "#dfedf0",
  CYAN = "#61f1e2",
  GOLD = "#ffc966";
const TAU = Math.PI * 2;

function gradient(
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
function shape(c: Context, fill: Paint, edge = INK, width = 3) {
  c.fillStyle = fill;
  c.fill();
  if (width) {
    c.strokeStyle = edge;
    c.lineWidth = width;
    c.stroke();
  }
}
function box(
  c: Context,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: Paint,
  edge = INK,
  width = 3,
) {
  c.beginPath();
  c.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  shape(c, fill, edge, width);
}
function circle(
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
function poly(c: Context, points: Point[], fill: Paint, edge = INK, width = 3) {
  c.beginPath();
  points.forEach(([x, y], i) => {
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  });
  c.closePath();
  shape(c, fill, edge, width);
}
function line(c: Context, points: Point[], color: string, width: number) {
  c.beginPath();
  points.forEach(([x, y], i) => {
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  });
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}
function bolt(c: Context, x: number, y: number, r = 4) {
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
function roller(c: Context, x: number, y: number, r: number, turn: number) {
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
function sphere(c: Context, bowling: boolean) {
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
function bladeWheel(c: Context, angle: number) {
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
function cogs(c: Context, tick: number) {
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
export function drawPart(
  c: Context,
  kind: PartKind,
  x: number,
  y: number,
  w: number,
  h: number,
  flip: boolean,
  tick: number,
  active: boolean,
) {
  c.save();
  c.translate(x, y);
  c.scale(((flip ? -1 : 1) * w) / 100, h / 100);
  c.lineJoin = "round";
  c.lineCap = "round";
  const metal = gradient(c, "#cfebe8", "#7ba6b6", "#486076");
  const amber = gradient(c, "#ffe19a", "#f4ad52", "#ad693e");
  const red = gradient(c, "#ffb189", "#f17465", "#ad414c");
  const dark = gradient(c, "#516f7c", "#354a58", "#273945");
  switch (kind) {
    case "ball": {
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
      break;
    }
    case "basketball":
      sphere(c, false);
      break;
    case "baseball": {
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
      break;
    }
    case "tennis": {
      circle(c, 0, 0, 46, gradient(c, "#e7ff99", "#b6d75c", "#78943c"));
      for (const sign of [-1, 1]) {
        c.beginPath();
        c.arc(
          sign * 63,
          0,
          46,
          sign > 0 ? 2.32 : -0.82,
          sign > 0 ? 3.96 : 0.82,
        );
        c.strokeStyle = "#fff8c8";
        c.lineWidth = 4;
        c.stroke();
      }
      break;
    }
    case "wall":
    case "timber": {
      box(
        c,
        -49,
        -43,
        98,
        86,
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
      break;
    }
    case "mouseWheel": {
      circle(c, 0, -3, 40, dark);
      c.save();
      c.translate(0, -3);
      c.rotate(tick * 0.1);
      for (let i = 0; i < 9; i++) {
        line(
          c,
          [
            [0, -8],
            [0, -38],
          ],
          STEEL,
          3,
        );
        c.rotate(TAU / 9);
      }
      c.restore();
      poly(
        c,
        [
          [0, 1],
          [-20, 43],
          [20, 43],
        ],
        metal,
      );
      bolt(c, 0, -3, 7);
      break;
    }
    case "pulley": {
      poly(
        c,
        [
          [-14, -45],
          [14, -45],
          [23, -3],
          [-23, -3],
        ],
        amber,
      );
      roller(c, 0, 12, 31, tick * 0.1);
      bolt(c, 0, -34, 4);
      break;
    }
    case "rope":
    case "driveBelt": {
      if (kind === "driveBelt") {
        c.beginPath();
        c.roundRect(-46, -26, 92, 53, 25);
        c.strokeStyle = INK;
        c.lineWidth = 11;
        c.stroke();
        c.strokeStyle = "#87969a";
        c.lineWidth = 6;
        c.stroke();
        for (const x of [-23, 23]) roller(c, x, 0, 15, tick * 0.1);
      } else {
        c.beginPath();
        c.moveTo(-18, -47);
        c.bezierCurveTo(-50, -15, 46, 15, 13, 47);
        c.strokeStyle = INK;
        c.lineWidth = 33;
        c.stroke();
        c.strokeStyle = "#e6bb77";
        c.lineWidth = 24;
        c.stroke();
        c.setLineDash([3, 6]);
        c.strokeStyle = "#8f684a";
        c.lineWidth = 5;
        c.stroke();
        c.setLineDash([]);
      }
      break;
    }
    case "cage": {
      box(c, -46, -39, 92, 77, 6, dark);
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
      box(c, -48, 33, 96, 10, 3, amber);
      box(c, -47, -44, 94, 11, 3, metal);
      break;
    }
    case "cat":
    case "mouse":
    case "monkey": {
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
        for (const x of [-6, 28])
          circle(c, x, -27, kind === "mouse" ? 14 : 9, fur);
      circle(c, 19, -10, 3, INK);
      circle(c, 31, -1, 3, "#ed9b8c", INK, 1);
      const stride = Math.sin(tick * 0.55) * 6;
      box(c, -19 + stride, 32, 24, 9, 4, fur);
      box(c, 8 - stride, 30, 17, 9, 4, fur);
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

      break;
    }
    case "jack":
    case "glove":
    case "popper": {
      box(c, -39, 7, 78, 37, 4, kind === "glove" ? dark : red);
      box(c, -42, 5, 84, 10, 3, amber);
      if (kind === "jack" && !active) {
        c.translate(0, 6);
        c.scale(1, 0.47);
      }
      if (kind === "glove") {
        c.translate(-7, 8);
        c.rotate(Math.PI / 2);
        c.scale(1, active ? 1.05 : 0.68);
      }
      line(
        c,
        [
          [-17, 5],
          [15, -2],
          [-14, -11],
          [10, -19],
        ],
        STEEL,
        5,
      );
      if (kind === "jack") {
        circle(c, 3, -27, 16, GOLD);
        circle(c, -2, -31, 2, INK);
        circle(c, 8, -31, 2, INK);
        line(
          c,
          [
            [-3, -22],
            [2, -19],
            [8, -22],
          ],
          INK,
          2,
        );
      } else if (kind === "glove") {
        box(c, -13, -43, 42, 29, 10, red);
        circle(c, -13, -22, 8, red);
      } else {
        poly(
          c,
          [
            [-20, -10],
            [-28, -36],
            [19, -40],
            [17, -14],
          ],
          amber,
        );
        for (const [x, y] of [
          [-28, -42],
          [0, -47],
          [23, -45],
        ] as const)
          circle(c, x, y, 3, CYAN, INK, 1);
      }
      break;
    }
    case "fish": {
      c.beginPath();
      c.moveTo(-24, -38);
      c.bezierCurveTo(-62, -2, -42, 33, -18, 42);
      c.lineTo(19, 42);
      c.bezierCurveTo(45, 32, 57, -4, 24, -38);
      c.closePath();
      shape(c, gradient(c, "#accfce", "#629ca4", "#3d7692"), STEEL, 3);
      box(c, -29, -42, 58, 7, 3, metal, INK, 2);
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
      break;
    }
    case "bellows": {
      poly(
        c,
        [
          [-45, -13],
          [22, -38],
          [30, -24],
          [-23, 0],
          [32, 14],
          [24, 32],
          [-45, 9],
        ],
        red,
      );
      for (let x = -20; x <= 16; x += 9)
        line(
          c,
          [
            [x, -13 - x * 0.36],
            [x, 11 + x * 0.28],
          ],
          "#8d4a4c",
          3,
        );
      line(
        c,
        [
          [-43, -16],
          [29, -41],
        ],
        GOLD,
        7,
      );
      line(
        c,
        [
          [-44, 12],
          [31, 37],
        ],
        GOLD,
        7,
      );
      box(c, 26, -7, 20, 13, 3, metal);
      break;
    }
    case "spark": {
      box(c, -37, -23, 74, 64, 6, red);
      box(c, -41, 32, 82, 12, 3, metal);
      box(c, -41, -27, 82, 12, 3, amber);
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
      break;
    }
    case "outlet": {
      box(c, -38, -46, 76, 92, 6, metal);
      box(c, -25, -24, 50, 50, 12, "#e4debf");
      for (const x of [-10, 10]) box(c, x - 2, -12, 5, 14, 2, INK);
      circle(c, 0, 10, 4, INK);
      for (const y of [-36, 36]) bolt(c, 0, y, 3);
      break;
    }
    case "plunger": {
      box(c, -38, 7, 76, 38, 4, red);
      const press = active ? 22 : 0;
      box(c, -7, -32 + press, 14, 41 - press, 3, metal);
      box(c, -32, -40 + press, 64, 12, 5, amber);
      for (const x of [-27, 27]) bolt(c, x, 30, 3);
      break;
    }
    case "eyelet": {
      box(c, -9, 0, 18, 43, 4, metal);
      for (let y = 13; y < 41; y += 6)
        line(
          c,
          [
            [-9, y + 4],
            [9, y - 2],
          ],
          INK,
          2,
        );
      circle(c, 0, -17, 22, metal);
      circle(c, 0, -17, 13, "#223843", INK, 2);
      break;
    }
    case "lamp":
    case "candle":
    case "bulb": {
      if (kind === "candle") {
        box(
          c,
          -17,
          -9,
          34,
          49,
          4,
          gradient(c, "#fff3ca", "#edd59d", "#c69e67"),
        );
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
        box(c, -14, 12, 28, 26, 5, metal);
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
        box(c, -40, -15, 56, 32, 7, amber);
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
        box(c, -16, -20, 16, 6, 3, red);
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
      break;
    }
    case "generator":
    case "motor": {
      box(c, -45, 29, 90, 14, 4, metal);
      box(c, -37, -28, 68, 62, 9, kind === "generator" ? amber : metal);
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
      box(c, 29, -10, 19, 20, 3, metal);
      roller(c, 27, 0, 14, tick * 0.13);
      box(c, -25, -40, 23, 12, 3, red);
      break;
    }
    case "lens": {
      c.save();
      c.rotate(-0.55);
      box(c, -5, 13, 10, 40, 4, amber);
      circle(c, 0, -10, 30, metal);
      circle(
        c,
        0,
        -10,
        24,
        gradient(c, "#b8f0ed", "#75aaa9", "#527887"),
        INK,
        2,
      );
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
      break;
    }
    case "pumpkin": {
      box(c, -3, -42, 10, 19, 4, "#76956a");
      for (const [x, rx, col] of [
        [-19, 24, "#e49048"],
        [18, 24, "#da7d40"],
        [0, 24, "#f09a50"],
      ] as const) {
        c.beginPath();
        c.ellipse(x, 5, rx, 34, 0, 0, TAU);
        shape(c, col, "#965d3c", 2);
      }
      break;
    }
    case "heart": {
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
      break;
    }
    case "tree": {
      box(c, -6, 16, 12, 30, 2, "#a37752");
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
      break;
    }
    case "rocket": {
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
      break;
    }
    case "scissors": {
      const spread = active ? 7 : 21;
      for (const dir of [-1, 1]) {
        c.save();
        c.scale(1, dir);
        poly(
          c,
          [
            [-9, -5],
            [44, -spread],
            [43, 1],
            [0, 7],
          ],
          metal,
        );
        line(
          c,
          [
            [-29, 21],
            [-7, 4],
          ],
          STEEL,
          6,
        );
        circle(c, -31, 24, 12, red);
        circle(c, -31, 24, 6, INK);
        c.restore();
      }
      bolt(c, -4, 1, 5);
      break;
    }
    case "solar": {
      box(c, -6, 6, 12, 32, 3, metal);
      box(c, -27, 34, 54, 9, 3, amber);
      c.save();
      c.rotate(-0.12);
      box(c, -44, -36, 88, 54, 4, metal);
      box(c, -40, -32, 80, 46, 2, "#3f6a85", INK, 1);
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
      break;
    }
    case "windmill": {
      poly(
        c,
        [
          [-6, -14],
          [8, -14],
          [17, 45],
          [-16, 45],
        ],
        metal,
      );
      c.save();
      c.translate(0, -11);
      c.rotate(tick * 0.12);
      for (let i = 0; i < 4; i++) {
        poly(
          c,
          [
            [0, 0],
            [-7, -33],
            [1, -38],
            [11, -16],
          ],
          amber,
        );
        c.rotate(Math.PI / 2);
      }
      c.restore();
      bolt(c, 0, -11, 6);
      break;
    }
    case "pipe":
    case "elbow": {
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
      box(c, -47, kind === "pipe" ? -18 : 0, 9, 36, 2, metal);
      if (kind === "pipe") box(c, 38, -18, 9, 36, 2, metal);
      else box(c, 5, -44, 34, 8, 2, metal);
      break;
    }
    case "bowling":
      sphere(c, true);
      break;
    case "balloon": {
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
      break;
    }
    case "crate": {
      box(c, -47, -45, 94, 90, 5, gradient(c, "#edc083", "#ba854f", "#765039"));
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
      for (const x of [-42, 32]) box(c, x, -41, 10, 82, 2, "#e7ba78", INK, 2);
      for (const x of [-36, 36]) for (const y of [-33, 33]) bolt(c, x, y, 2.5);
      break;
    }
    case "ramp": {
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
      break;
    }
    case "shelf": {
      box(c, -49, -42, 98, 75, 4, dark);
      box(c, -49, -45, 98, 24, 3, amber, INK, 2.5);
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
      break;
    }
    case "spring": {
      box(c, -45, 30, 90, 15, 3, metal);
      line(
        c,
        [
          [-27, 28],
          [27, 20],
          [-24, 8],
          [24, -2],
          [-24, -13],
          [26, -22],
        ],
        INK,
        10,
      );
      line(
        c,
        [
          [-27, 28],
          [27, 20],
          [-24, 8],
          [24, -2],
          [-24, -13],
          [26, -22],
        ],
        CYAN,
        5.5,
      );
      box(c, -46, -41, 92, 19, 5, red);
      line(
        c,
        [
          [-36, -37],
          [32, -37],
        ],
        "#ffd1a9",
        2.5,
      );
      break;
    }
    case "belt": {
      box(c, -46, -42, 92, 82, 18, dark);
      for (const x of [-33, 33]) roller(c, x, 0, 12, tick * 0.14);
      box(c, -46, -45, 92, 17, 5, amber);
      box(c, -46, 28, 92, 11, 4, metal);
      for (let x = -39 + (tick % 5); x < 43; x += 9)
        line(
          c,
          [
            [x, -42],
            [x - 2, -32],
          ],
          INK,
          1.6,
        );
      line(
        c,
        [
          [-12, 0],
          [11, 0],
          [4, -8],
        ],
        CYAN,
        4,
      );
      break;
    }
    case "fan": {
      box(c, -32, 30, 66, 14, 4, metal);
      box(c, -8, 9, 16, 24, 4, metal);
      circle(c, 0, -9, 37, dark, INK, 4);
      c.save();
      c.translate(0, -9);
      bladeWheel(c, tick * 0.3);
      c.restore();
      c.beginPath();
      c.arc(0, -9, 33, 0, TAU);
      c.strokeStyle = "#96b6bc9c";
      c.lineWidth = 1.8;
      c.stroke();
      for (const y of [-24, -9, 6])
        line(
          c,
          [
            [-29, y],
            [29, y],
          ],
          "#b5cecc8f",
          1.3,
        );
      line(
        c,
        [
          [30, 30],
          [43, 30],
          [37, 24],
        ],
        CYAN,
        2.5,
      );
      break;
    }
    case "magnet": {
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
      for (const y of [-30, 30]) box(c, 18, y - 11, 26, 22, 2, metal, INK, 2);
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
      break;
    }
    case "switch": {
      box(c, -45, 5, 90, 34, 5, dark);
      box(c, -43, 1, 86, 15, 4, metal);
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
      box(c, 20, 8, 10, 5, 2, active ? CYAN : "#865944", INK, 1);
      break;
    }
    case "gate": {
      box(c, -43, -47, 27, 94, 3, metal);
      box(c, 16, -47, 27, 94, 3, metal);
      if (!active) {
        box(c, -33, -32, 66, 62, 3, dark);
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
      box(c, -47, -46, 94, 15, 4, active ? CYAN : amber);
      for (const x of [-30, 30]) bolt(c, x, 37, 4);
      break;
    }
    case "gear":
      cogs(c, tick * 0.09);
      break;
    case "basket": {
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
      break;
    }
    case "bell": {
      box(c, -45, 31, 90, 14, 6, dark);
      box(c, -27, 21, 54, 10, 3, metal);
      c.beginPath();
      c.moveTo(-37, 18);
      c.bezierCurveTo(-24, 10, -32, -29, -7, -35);
      c.bezierCurveTo(20, -45, 26, -20, 27, 1);
      c.lineTo(36, 17);
      c.closePath();
      shape(c, amber);
      circle(c, -2, -35, 6, metal);
      box(c, -38, 14, 77, 9, 4, GOLD);
      line(
        c,
        [
          [-22, -2],
          [-18, -16],
          [-12, -23],
        ],
        "#fff1c3",
        3,
      );
      break;
    }
    case "domino": {
      box(c, -40, -47, 80, 94, 7, gradient(c, "#ffecd0", "#d9d7b4", "#b4b295"));
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
      break;
    }
    case "seesaw": {
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
      box(c, -48, -18, 96, 23, 4, amber);
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
      break;
    }
  }
  c.restore();
}

export function partIcon(kind: PartKind): HTMLCanvasElement {
  const icon = document.createElement("canvas");
  icon.width = 112;
  icon.height = 72;
  icon.setAttribute("aria-hidden", "true");
  const c = icon.getContext("2d");
  if (!c) return icon;
  const def = PARTS[kind],
    s = Math.min(100 / def.width, 60 / def.height);
  drawPart(c, kind, 56, 36, def.width * s, def.height * s, false, 0, false);
  return icon;
}
