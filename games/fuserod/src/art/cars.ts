import {
  ellipse,
  fill,
  metal,
  rect,
  stroke,
  type,
  type Brush,
} from "./drawing";

const steel = (g: Brush, top: number, bottom: number) =>
  metal(
    g,
    top,
    bottom,
    [0, "#fff4dc"],
    [0.32, "#d9f6ed"],
    [0.48, "#637c89"],
    [0.53, "#27384d"],
    [1, "#acc7c3"],
  );

function wheel(g: Brush, x: number, y: number, r: number) {
  ellipse(g, "#130f1c", x, y, r, r);
  ellipse(g, "#302b38", x, y, r * 0.88, r * 0.88);
  ellipse(g, "#dbd4c3", x, y, r * 0.75, r * 0.75);
  ellipse(g, "#323443", x, y, r * 0.67, r * 0.67);
  ellipse(g, steel(g, y - r * 0.6, y + r * 0.6), x, y, r * 0.57, r * 0.57);
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * i) / 4;
    ellipse(
      g,
      "#47505f",
      x + Math.cos(a) * r * 0.38,
      y + Math.sin(a) * r * 0.38,
      r * 0.065,
      r * 0.065,
    );
  }
  ellipse(g, "#cbdcdb", x, y, r * 0.22, r * 0.22);
  ellipse(g, "#7e8991", x, y + 2, r * 0.13, r * 0.13);
}

/** Original long-wheelbase coupe, local coordinates 0..500 by 0..185. */
export function profile(
  g: Brush,
  color: string,
  model: number,
  upgrade: number,
) {
  g.save();
  const fastback = Math.abs(Math.floor(model)) % 3 === 1;
  const hardtop = Math.abs(Math.floor(model)) % 3 === 2;
  ellipse(g, "#0d1018aa", 250, 159, 242, 19);
  wheel(g, 100, 134, 36);
  wheel(g, 399, 134, 36);
  fill(
    g,
    "#1b1a25",
    "M15 104 L58 87 146 71 355 73 430 78 469 89 486 114 483 139 450 144 Q448 92 398 92 Q355 91 350 149 L150 153 Q149 92 99 94 Q55 94 53 145 L18 139Z",
  );
  const shell =
    "M11 88 Q42 86 69 79 L137 70 Q158 43 185 31 Q212 23 272 24 Q299 25 309 33 L367 73 Q425 72 456 82 Q472 86 484 100 L487 123 480 132 442 138 Q438 94 399 92 Q364 91 351 143 L149 149 Q145 95 101 94 Q64 93 53 139 L17 133 Q9 127 11 110Z";
  fill(g, color, shell);
  g.save();
  g.clip(new Path2D(shell));
  rect(
    g,
    metal(
      g,
      27,
      146,
      [0, "#ffffff55"],
      [0.37, "#ffffff06"],
      [0.42, "#ffeece8f"],
      [0.49, "#ffffff15"],
      [0.63, "#0c233130"],
      [0.8, "#09182685"],
      [1, "#090f1ee6"],
    ),
    0,
    20,
    500,
    140,
  );
  fill(g, "#f1e4bdbe", "M14 94 Q157 93 308 86 L465 85 Q410 90 317 92 L54 109Z");
  fill(g, "#16293688", "M150 134 L345 118 349 133 150 146Z");
  g.restore();
  fill(
    g,
    steel(g, 27, 72),
    hardtop
      ? "M122 71 L141 34 Q148 23 174 22 L280 23 Q298 23 311 34 L367 74Z"
      : fastback
        ? "M92 75 Q130 58 173 37 Q207 20 262 23 Q295 25 312 36 L366 74Z"
        : "M135 71 Q158 40 184 30 Q211 22 274 24 Q296 25 310 35 L366 74Z",
  );
  const glass = metal(
    g,
    32,
    71,
    [0, "#13283b"],
    [0.58, "#355064"],
    [1, "#829699"],
  );
  if (fastback) {
    fill(
      g,
      glass,
      "M119 69 Q176 38 212 31 L221 32 208 66Z M229 31 Q289 26 305 42 L337 67 216 66Z",
    );
    fill(g, "#d3e5cd40", "M264 32 L280 33 253 65 241 65Z");
  } else {
    fill(
      g,
      glass,
      hardtop
        ? "M136 66 L150 34 Q153 29 173 29 L220 29 219 67Z"
        : "M151 67 Q171 41 192 34 Q205 30 220 30 L219 67Z",
    );
    fill(g, glass, "M225 30 L274 30 Q289 31 299 37 L339 68 224 67Z");
    fill(
      g,
      "#d3e5cd40",
      "M246 31 L252 31 229 66 225 66Z M264 31 L278 32 253 66 242 66Z",
    );
    stroke(g, "#e0cdb1", 2, "M299 35 L347 70");
  }
  stroke(
    g,
    "#342a389e",
    1.7,
    "M217 73 Q219 88 214 123 L207 133 Q264 133 303 128 Q316 127 319 113 L322 75",
  );
  stroke(g, steel(g, 80, 88), 3.5, "M233 81 L247 81");
  fill(g, "#e9cda2", "M13 90 L9 72 21 77 40 86Z");
  fill(g, "#de534b", "M13 94 Q25 90 37 92 L33 102 13 106Z");
  fill(g, "#d8cfaa", "M458 83 Q475 85 483 99 L470 99Z");
  fill(g, "#eacfa8", "M474 103 L486 103 485 111 473 113Z");
  for (let i = 0; i < 5; i++)
    stroke(g, "#4e494a", 1.5, `M${469 + i * 3} 116 l-2 9`);
  stroke(
    g,
    steel(g, 125, 140),
    5,
    "M9 126 Q22 133 47 132 M445 136 L485 127 491 122 M152 145 L348 139",
  );
  stroke(
    g,
    "#efd8b5aa",
    1.6,
    "M58 118 Q68 93 100 91 Q132 90 144 120 M356 119 Q368 92 400 90 Q426 91 436 116",
  );
  if (upgrade > 0) {
    fill(g, "#282734", "M354 73 L365 63 392 64 404 72Z");
    stroke(g, "#c2caca", 2, "M365 64 L390 65 395 69");
  }
  g.restore();
}

/** Tail view with separate paint, wraparound glass, lamps, trunk and bumper. */
export function tail(
  g: Brush,
  x: number,
  y: number,
  width: number,
  color: string,
  model: number,
  police = false,
) {
  g.save();
  g.translate(x, y);
  g.scale(width / 140, width / 140);
  const hardtop = Math.abs(Math.floor(model)) % 3 === 2;
  ellipse(g, "#160f2180", 0, -1, 78, 7);
  rect(g, "#100f19", -55, -25, 17, 25);
  rect(g, "#100f19", 38, -25, 17, 25);
  fill(
    g,
    color,
    hardtop
      ? "M-65 -18 L-63 -43 -48 -47 -44 -72 Q0 -78 45 -72 L49 -46 63 -43 67 -18 60 -9 -57 -9Z"
      : "M-65 -18 L-63 -44 -48 -48 -34 -65 Q-3 -73 32 -66 L49 -47 62 -44 66 -18 60 -9 -57 -9Z",
  );
  fill(
    g,
    "#293748",
    hardtop
      ? "M-39 -67 Q0 -72 40 -66 L42 -49 -43 -49Z"
      : "M-31 -62 Q0 -67 29 -62 L42 -48 -42 -48Z",
  );
  fill(g, "#cfddc448", "M-18 -63 L-11 -64 -28 -49 -37 -49Z");
  fill(g, "#fff0ca70", "M-60 -43 Q0 -48 59 -43 L48 -39 -47 -39Z");
  fill(g, "#16203570", "M-62 -32 Q0 -24 63 -33 L60 -15 -60 -15Z");
  stroke(g, "#eee0c4", 1.4, "M-58 -38 L-39 -36 40 -36 58 -38");
  fill(
    g,
    "#692b36",
    "M-57 -35 L-35 -32 -37 -23 -57 -25Z M57 -35 L35 -32 37 -23 57 -25Z",
  );
  stroke(g, "#ff624f", 3, "M-55 -32 L-39 -30 M55 -32 L39 -30");
  rect(g, "#b7bdaf", -9, -25, 18, 8);
  rect(g, "#373e46", -6, -22, 12, 2);
  stroke(g, steel(g, -17, -7), 5, "M-65 -16 Q-5 -9 64 -16");
  if (police) {
    fill(g, "#d9dcc8", "M-46 -43 Q0 -48 47 -43 L39 -36 -38 -36Z");
    type(g, "PATROL", 0, -29, 6.5, "#f1edd8", "center");
    rect(g, "#26323d", -19, -80, 38, 4);
    rect(g, "#fc7065", -17, -85, 14, 5);
    rect(g, "#85b5eb", 3, -85, 14, 5);
  }
  g.restore();
}

export function gauge(
  g: Brush,
  x: number,
  y: number,
  r: number,
  value: number,
  max: number,
  label: string,
  danger: number,
) {
  const from = Math.PI * 0.76,
    arc = Math.PI * 1.49;
  ellipse(g, steel(g, y - r, y + r), x, y, r, r);
  ellipse(g, "#101823", x, y, r * 0.93, r * 0.93);
  ellipse(g, "#1b2630", x, y, r * 0.79, r * 0.79);
  for (let i = 0; i <= 24; i++) {
    const a = from + (arc * i) / 24;
    const outer = r * 0.84,
      inner = r * (i % 4 === 0 ? 0.63 : 0.75);
    stroke(
      g,
      i / 24 >= danger ? "#fb855c" : "#c4d9cf",
      i % 4 === 0 ? 1.8 : 1,
      `M${x + Math.cos(a) * inner} ${y + Math.sin(a) * inner} L${x + Math.cos(a) * outer} ${y + Math.sin(a) * outer}`,
    );
  }
  type(g, label, x, y + r * 0.47, r * 0.22, "#c8d6cc", "center");
  const angle = from + arc * Math.min(1, Math.max(0, value / max));
  stroke(
    g,
    "#ff935f",
    2.8,
    `M${x - Math.cos(angle) * r * 0.15} ${y - Math.sin(angle) * r * 0.15} L${x + Math.cos(angle) * r * 0.7} ${y + Math.sin(angle) * r * 0.7}`,
  );
  ellipse(g, "#b1c7bf", x, y, r * 0.095, r * 0.095);
}
