import { ellipse, fill, metal, rect, stroke, type Brush } from "./drawing";
import { partPicture } from "./parts";

function part(g: Brush, name: string, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.translate(-140, -72);
  partPicture(g, name);
  g.restore();
}

/** Front-on bay or lift view. Coordinates centre the mechanical assembly at (0, 0). */
export function workshop(
  g: Brush,
  paint: string,
  name: string,
  progress: number,
) {
  const under =
    /under|gearbox|transmission|muffler|differential|final|axle|header|jack|tyre|tire/.test(
      name.toLowerCase(),
    );
  fill(
    g,
    paint,
    "M-268 106 L-249 -89 Q-232 -132 -181 -139 L181 -139 Q232 -132 249 -89 L268 106 Q195 132 0 135 Q-195 132 -268 106Z",
  );
  fill(
    g,
    metal(g, -112, 123, [0, "#2a3642"], [0.45, "#536168"], [1, "#1f2834"]),
    "M-219 91 L-205 -86 Q-199 -109 -155 -114 H155 Q199 -109 205 -86 L219 91 Q109 115 0 115 Q-109 115 -219 91Z",
  );
  stroke(
    g,
    "#d7d6bd",
    3,
    "M-261 102 Q-195 127 0 130 Q195 127 261 102 M-220 -102 Q-198 -127 -164 -129 H164 Q198 -127 220 -102",
  );
  if (under) {
    for (const side of [-1, 1]) {
      const x = side * 180;
      for (const y of [-69, 64]) {
        rect(g, "#202632", x - 22, y - 34, 44, 69);
        for (let i = 0; i < 7; i++)
          rect(g, "#444953", x - 21, y - 28 + i * 8, 42, 2);
      }
      stroke(
        g,
        "#797e7a",
        12,
        `M${side * 117} -105 Q${side * 140} 7 ${side * 100} 103`,
      );
    }
    stroke(g, "#8e9a92", 14, "M-173 70 H167 M0 -90 L0 79");
    part(g, "gearbox", -9, -52, 0.7);
    part(g, "differential", 6, 67, 0.62);
    stroke(g, "#b3aaa0", 8, "M74 -90 Q119 -66 96 -29 Q75 14 107 49 L131 98");
    fill(
      g,
      "#9faba5",
      "M79 13 Q90 8 100 15 L117 43 Q117 52 104 58 Q95 61 92 52Z",
    );
    part(g, "jack", -144, 94, 0.56);
  } else {
    // Firewall, radiator with cooling fins, battery, belt and hoses form the bay.
    rect(g, "#4b535c", -151, -93, 299, 18);
    for (let x = -133; x < 143; x += 15) rect(g, "#677575", x, -90, 3, 12);
    rect(g, "#242b36", -171, -56, 53, 69);
    rect(g, "#707f80", -173, -57, 56, 11);
    ellipse(g, "#c06b59", -159, -50, 5, 4);
    ellipse(g, "#acb5a8", -130, -50, 5, 4);
    stroke(g, "#bf705c", 4, "M-159 -50 Q-103 -62 -88 -28");
    ellipse(g, "#abb4a6", 150, -41, 19, 24);
    ellipse(g, "#525f63", 150, -46, 8, 5);
    stroke(g, "#272c38", 10, "M134 -27 Q118 -9 131 13 Q143 37 109 62");
    for (let i = 0; i < 6; i++)
      rect(g, "#727f7e", -120, 70 + i * 3.9, 240, 2.4);
    part(g, "engine", 0, 2, 1.7);
    for (const [x, y] of [
      [-77, -38],
      [73, -52],
      [-47, 57],
      [62, 42],
    ]) {
      ellipse(g, "#cbbf9e", x!, y!, 4, 3);
      stroke(g, "#656876", 1, `M${x! - 2} ${y!} l4 -1`);
    }
    if (/timing|strobe/.test(name)) {
      const px = -108 + progress * 20;
      part(g, "timing", px, 52, 0.73);
      fill(g, "#f7d9a747", `M${px - 22} 48 L-22 31 -17 57Z`);
    }
  }
  // The bench carries the selected item and the fasteners removed during the job.
  rect(
    g,
    metal(
      g,
      118,
      160,
      [0, "#685950"],
      [0.16, "#b19378"],
      [0.22, "#8f7668"],
      [1, "#64575b"],
    ),
    -274,
    117,
    548,
    49,
  );
  part(g, "bolt", -201, 134, 0.53);
  part(g, "wrench", 183, 137, 0.48);
  part(g, name, 0, 133, 0.67);
}
