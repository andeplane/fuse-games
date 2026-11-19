import type { PartKind } from "../../game/machine.js";
import {
  CYAN,
  type Context,
  GOLD,
  INK,
  type PartAppearance,
  type PartPainter,
  type Point,
  STEEL,
  TAU,
  bladeWheel,
  bolt,
  box,
  circle,
  cogs,
  line,
  poly,
  roller,
  shape,
} from "./canvas.js";

function paintMouseWheel(
  c: Context,
  { tick, palette: { metal, dark } }: PartAppearance,
) {
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
}

function paintPulley(c: Context, { tick, palette: { amber } }: PartAppearance) {
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
}

function paintRopeOrBelt(c: Context, { kind, tick }: PartAppearance) {
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
}

function paintSpringTool(
  c: Context,
  { kind, active, palette: { amber, red, dark } }: PartAppearance,
) {
  box(c, [-39, 7, 78, 37], 4, kind === "glove" ? dark : red);
  box(c, [-42, 5, 84, 10], 3, amber);
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
    box(c, [-13, -43, 42, 29], 10, red);
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
}

function paintBellows(c: Context, { palette: { metal, red } }: PartAppearance) {
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
  box(c, [26, -7, 20, 13], 3, metal);
}

function paintEyelet(c: Context, { palette: { metal } }: PartAppearance) {
  box(c, [-9, 0, 18, 43], 4, metal);
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
}

function paintScissors(
  c: Context,
  { active, palette: { metal, red } }: PartAppearance,
) {
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
}

function paintWindmill(
  c: Context,
  { tick, palette: { metal, amber } }: PartAppearance,
) {
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
}

function paintSpring(c: Context, { palette: { metal, red } }: PartAppearance) {
  box(c, [-45, 30, 90, 15], 3, metal);
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
  box(c, [-46, -41, 92, 19], 5, red);
  line(
    c,
    [
      [-36, -37],
      [32, -37],
    ],
    "#ffd1a9",
    2.5,
  );
}

function paintBelt(
  c: Context,
  { tick, active, palette: { metal, amber, dark } }: PartAppearance,
) {
  box(c, [-46, -42, 92, 82], 18, dark);
  for (const x of [-33, 33]) roller(c, x, 0, 12, tick * 0.14);
  box(c, [-46, -45, 92, 17], 5, amber);
  box(c, [-46, 28, 92, 11], 4, metal);
  for (let x = -39 + (tick % 9); x < 43; x += 9)
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
    [[-12, 0], [11, 0], ...(active ? [[4, -8] as Point] : [])],
    active ? CYAN : STEEL,
    4,
  );
}

function paintFan(
  c: Context,
  { tick, palette: { metal, dark } }: PartAppearance,
) {
  box(c, [-32, 30, 66, 14], 4, metal);
  box(c, [-8, 9, 16, 24], 4, metal);
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
}

function paintGear(c: Context, { tick }: PartAppearance) {
  cogs(c, tick * 0.09);
}

function paintBell(
  c: Context,
  { palette: { metal, amber, dark } }: PartAppearance,
) {
  box(c, [-45, 31, 90, 14], 6, dark);
  box(c, [-27, 21, 54, 10], 3, metal);
  c.beginPath();
  c.moveTo(-37, 18);
  c.bezierCurveTo(-24, 10, -32, -29, -7, -35);
  c.bezierCurveTo(20, -45, 26, -20, 27, 1);
  c.lineTo(36, 17);
  c.closePath();
  shape(c, amber);
  circle(c, -2, -35, 6, metal);
  box(c, [-38, 14, 77, 9], 4, GOLD);
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
}

export const motionPainters = {
  mouseWheel: paintMouseWheel,
  pulley: paintPulley,
  rope: paintRopeOrBelt,
  driveBelt: paintRopeOrBelt,
  jack: paintSpringTool,
  glove: paintSpringTool,
  popper: paintSpringTool,
  bellows: paintBellows,
  eyelet: paintEyelet,
  scissors: paintScissors,
  windmill: paintWindmill,
  spring: paintSpring,
  belt: paintBelt,
  fan: paintFan,
  gear: paintGear,
  bell: paintBell,
} satisfies Partial<Record<PartKind, PartPainter>>;
