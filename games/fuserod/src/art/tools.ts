import { ellipse, fill, metal, rect, stroke, type Brush } from "./drawing";

/** Dismantled parts and bench tools, framed in a 280 × 144 view. */
export function benchPart(g: Brush, key: string): boolean {
  const steel = metal(
    g,
    30,
    116,
    [0, "#d9cbb1"],
    [0.42, "#a5b9b6"],
    [0.5, "#637783"],
    [1, "#c0c9bf"],
  );
  if (/carb|fuel mix/.test(key)) {
    fill(g, "#8d745d", "M86 76 L105 58 158 54 182 73 179 95 149 108 98 96Z");
    fill(g, steel, "M83 77 L101 54 156 49 185 69 164 85 117 88Z");
    for (const x of [112, 144]) {
      rect(g, "#947f65", x - 11, 48, 25, 19);
      ellipse(g, "#cfbb94", x + 2, 48, 15, 8);
      ellipse(g, "#433e41", x + 2, 48, 9, 4);
    }
    for (const x of [100, 117, 161]) {
      ellipse(g, "#d8cbad", x, 84, 4, 3);
      rect(g, "#978d77", x - 1, 85, 3, 12);
    }
    stroke(g, "#a9b9b2", 3, "M98 66 L86 60 74 63 M171 76 L188 80 196 76");
    return true;
  }
  if (/muffler|silencer/.test(key)) {
    stroke(g, "#5f7079", 12, "M64 93 L90 86 101 75 M164 63 L180 59 199 45");
    stroke(g, steel, 7, "M64 91 L89 84 100 73 M164 61 L179 57 198 43");
    fill(
      g,
      steel,
      "M88 74 Q92 64 108 60 L151 48 Q166 46 178 61 L177 68 Q169 80 155 83 L111 96 Q95 98 89 86Z",
    );
    for (let i = 0; i < 3; i++)
      stroke(g, "#74838a", 2, `M${96 + i * 25} ${70 - i * 8} q13 1 15 19`);
    return true;
  }
  if (/header|exhaust/.test(key)) {
    fill(g, "#9d9382", "M75 64 L162 41 170 48 79 74Z");
    for (let i = 0; i < 4; i++) {
      const x = 85 + i * 22,
        y = 67 - i * 6;
      const d = `M${x} ${y} q4 16 20 19 Q153 80 183 91`;
      stroke(g, "#6d6463", 9, d);
      stroke(g, "#cfab89", 5, d);
    }
    fill(g, "#829093", "M174 83 L197 86 200 99 179 101Z");
    return true;
  }
  if (/manifold|intake/.test(key)) {
    fill(
      g,
      "#677986",
      "M71 92 L181 64 196 72 80 103Z M96 60 L158 41 175 50 111 72Z",
    );
    for (let i = 0; i < 4; i++) {
      const x = 98 + i * 21,
        y = 64 - i * 5;
      const path = `M${x} ${y} q2 9 -6 15 q-10 6 -4 15`;
      stroke(g, "#59616a", 11, path);
      stroke(g, steel, 7, path);
    }
    ellipse(g, "#c3c3af", 137, 56, 20, 9);
    ellipse(g, "#394956", 137, 56, 14, 6);
    return true;
  }
  if (/bolt|fasten/.test(key)) {
    for (let i = 0; i < 3; i++) {
      g.save();
      g.translate(85 + i * 38, 76 - (i % 2) * 15);
      g.rotate(-0.4 + i * 0.2);
      rect(g, "#72828a", -8, -10, 16, 47);
      for (let j = 0; j < 7; j++)
        stroke(g, "#d6d7c2", 1.7, `M-8 ${j * 4 + 4} l16 -3`);
      fill(g, steel, "M-16 -21 L-5 -30 11 -30 20 -20 18 -8 4 -3 -12 -8Z");
      fill(g, "#67747b", "M-14 -19 L-5 -25 10 -26 16 -19 7 -16 -6 -16Z");
      g.restore();
    }
    return true;
  }
  if (/jack|lift/.test(key)) {
    fill(g, "#465768", "M65 101 L162 87 199 96 104 112Z");
    fill(
      g,
      "#c88765",
      "M83 96 L112 61 132 66 107 97Z M117 88 L148 52 161 57 138 89Z",
    );
    stroke(g, "#8d695e", 8, "M94 93 L127 82 151 55");
    stroke(g, steel, 5, "M170 92 L188 47 202 30");
    fill(g, "#697780", "M135 52 L161 46 174 52 149 59Z");
    ellipse(g, "#2a3542", 84, 103, 9, 6);
    ellipse(g, "#2a3542", 178, 97, 8, 5);
    return true;
  }
  if (/timing|strobe|ignition/.test(key)) {
    stroke(g, "#2a303e", 3, "M130 98 Q113 128 78 110 Q63 96 76 90");
    fill(
      g,
      "#a8665b",
      "M89 53 L156 42 173 50 162 65 140 68 131 101 115 98 118 71 93 72Z",
    );
    fill(g, steel, "M91 52 L155 41 172 48 103 62Z");
    ellipse(g, "#4e5760", 94, 62, 10, 12);
    ellipse(g, "#ffe1a5", 92, 61, 6, 8);
    stroke(g, "#d0a884", 2, "M136 70 L128 90");
    return true;
  }
  return false;
}
