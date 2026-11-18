import { ellipse, fill, metal, rect, stroke, type Brush } from "./drawing";
import { benchPart } from "./tools";

function bolt(g: Brush, x: number, y: number, r: number) {
  ellipse(g, "#283541", x, y, r, r * 0.75);
  ellipse(g, "#d0cfc0", x, y - 1, r * 0.74, r * 0.46);
  stroke(g, "#586776", 1.4, `M${x - r * 0.5} ${y - 1} l${r} -1`);
}

function engine(g: Brush) {
  fill(g, "#536779", "M67 57 L151 34 207 57 126 86Z");
  fill(g, "#475865", "M67 57 L126 80 126 119 83 104Z");
  fill(g, "#a76551", "M126 80 L207 57 190 100 126 119Z");
  fill(g, "#c98463", "M101 49 L153 34 181 44 125 62Z");
  for (let i = 0; i < 6; i++)
    stroke(g, "#67494b", 2.4, `M${129 + i * 9} ${83 - i * 2.55} l-5 25`);
  for (let i = 0; i < 4; i++) {
    const x = 141 + i * 13,
      y = 77 - i * 3.9;
    stroke(g, "#4c4751", 7, `M${x} ${y} q8 2 4 13 l-3 13`);
    stroke(g, "#c7b4a0", 3, `M${x} ${y - 1} q7 1 3 12 l-3 12`);
  }
  fill(
    g,
    "#9ab1aa",
    "M56 53 L77 40 124 57 116 70Z M129 63 L192 42 213 49 211 60 142 82Z",
  );
  fill(
    g,
    "#5d7379",
    "M56 53 L116 70 115 78 60 62Z M142 82 L211 60 208 66 144 88Z",
  );
  for (let i = 0; i < 3; i++) {
    stroke(
      g,
      "#e5e1c8",
      1.4,
      `M${67 + i * 3} ${48 - i * 2} l45 14 M${144 + i * 3} ${73 - i * 3} l51 -17`,
    );
  }
  ellipse(g, "#566672", 132, 40, 26, 10);
  rect(g, "#60636b", 106, 32, 52, 9);
  ellipse(
    g,
    metal(g, 22, 40, [0, "#e0ca9f"], [0.52, "#d0b382"], [1, "#808783"]),
    132,
    31,
    26,
    9,
  );
  ellipse(g, "#b2a58a", 132, 30, 16, 4);
  bolt(g, 132, 30, 3);
  ellipse(g, "#2c3541", 88, 91, 14, 16);
  ellipse(g, "#74828a", 88, 91, 10, 12);
  bolt(g, 88, 91, 5);
  bolt(g, 69, 55, 2.5);
  bolt(g, 107, 68, 2.5);
  bolt(g, 148, 77, 2.5);
  bolt(g, 204, 58, 2.5);
}

function tyre(g: Brush) {
  g.save();
  g.translate(142, 73);
  g.rotate(-0.16);
  ellipse(g, "#191f2b", -9, 0, 41, 55);
  rect(g, "#282e39", -10, -54, 21, 108);
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI * 0.5 + (i * Math.PI) / 15,
      y = Math.sin(a) * 52,
      left = -Math.cos(a) * 33 - 10;
    stroke(g, "#59616a", 2, `M${left} ${y} l8 2 5 -4 9 2`);
  }
  ellipse(
    g,
    metal(
      g,
      -55,
      55,
      [0, "#62636b"],
      [0.2, "#353944"],
      [0.72, "#262d39"],
      [1, "#1c2532"],
    ),
    10,
    0,
    38,
    54,
  );
  ellipse(g, "#a4aa9e", 10, 0, 30, 45);
  ellipse(g, "#363f48", 10, 0, 26, 40);
  ellipse(
    g,
    metal(
      g,
      -34,
      34,
      [0, "#e3dbc4"],
      [0.45, "#aebdb3"],
      [0.53, "#667681"],
      [1, "#c7d2c7"],
    ),
    10,
    0,
    21,
    33,
  );
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ellipse(g, "#414852", 10 + Math.cos(a) * 13, Math.sin(a) * 20, 3, 5);
  }
  ellipse(g, "#b4c1b8", 10, 0, 7, 10);
  g.restore();
}

function transmission(g: Brush) {
  fill(
    g,
    "#afbcb2",
    "M53 64 L76 39 109 36 129 48 166 55 182 63 212 64 218 74 205 84 177 85 166 94 126 99 110 111 83 111 61 95Z",
  );
  fill(
    g,
    "#657a84",
    "M53 65 L76 79 96 109 83 111 61 95Z M99 79 L128 67 172 70 181 79 210 74 205 84 177 85 166 94 126 99 110 110Z",
  );
  for (let i = 0; i < 4; i++) {
    stroke(g, "#60717a", 3, `M${76 + i * 9} ${48 - i * 1.6} l17 28 5 20`);
    stroke(g, "#70818a", 2.5, `M${130 + i * 8} ${60 + i} l9 12 -8 19`);
  }
  fill(g, "#bd866d", "M114 40 L127 36 141 47 129 51Z");
  bolt(g, 121, 42, 2.5);
  bolt(g, 72, 67, 3);
  bolt(g, 92, 99, 3);
  bolt(g, 178, 73, 3);
}

function pinion(g: Brush) {
  g.save();
  g.translate(131, 76);
  g.scale(1, 0.74);
  for (let i = 0; i < 14; i++) {
    g.save();
    g.rotate((i * Math.PI) / 7);
    rect(g, "#8d9a9a", -6, -59, 12, 15);
    g.restore();
  }
  ellipse(g, "#98aaa7", 0, 0, 52, 52);
  ellipse(g, "#354652", 0, 0, 42, 42);
  ellipse(g, metal(g, -38, 38, [0, "#cbb997"], [1, "#777c78"]), 0, 0, 36, 36);
  ellipse(g, "#34454f", 0, 0, 22, 22);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    bolt(g, Math.cos(a) * 30, Math.sin(a) * 30, 4);
  }
  g.restore();
  fill(g, "#849a9b", "M154 64 L197 37 209 39 217 50 170 80Z");
  for (let i = 0; i < 4; i++)
    stroke(g, "#52676e", 3, `M${163 + i * 9} ${63 - i * 5.5} l8 9`);
}

function repair(g: Brush) {
  fill(
    g,
    "#627981",
    "M78 109 L139 64 Q132 40 149 28 Q159 21 171 23 L156 41 164 52 176 51 190 33 Q200 53 186 67 Q177 77 158 76 L95 119 Q77 126 78 109Z",
  );
  fill(
    g,
    metal(g, 28, 116, [0, "#e5d3ae"], [0.45, "#a9bbb1"], [1, "#a6b4aa"]),
    "M77 104 L137 60 Q130 42 146 29 Q155 22 170 22 L154 40 162 49 175 47 189 31 Q196 48 184 62 Q173 73 155 70 L93 116 Q79 123 76 114 Q72 109 77 104Z",
  );
  ellipse(g, "#52636b", 85, 109, 5, 4);
  stroke(g, "#74858a", 2, "M97 102 L145 66");
}

export function partPicture(g: Brush, name: string) {
  const key = name.toLowerCase();
  if (benchPart(g, key)) return;
  if (/tire|tyre|wheel|grip/.test(key)) tyre(g);
  else if (/gearbox|trans|shift/.test(key)) transmission(g);
  else if (/final|ratio|drive|differential/.test(key)) pinion(g);
  else if (/repair|condition|service|wrench/.test(key)) repair(g);
  else engine(g);
}
