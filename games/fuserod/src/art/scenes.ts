import { drawGarage, type GarageArt } from "./garage";
import {
  ellipse,
  fill,
  metal,
  noise,
  rect,
  setup,
  stroke,
  type,
  type Brush,
} from "./drawing";
import { profile } from "./cars";
import { horizon } from "./landscape";
import { portrait } from "./portraits";
import { landmark } from "./town-art";
import { workshop } from "./workshop";

export type SceneLocation =
  "garage" | "diner" | "station" | "champion" | "workshop";
export interface SceneOptions extends GarageArt {
  rival?: number;
  part?: string;
  /** Fraction complete for optional fuel, repair or timing animation. */
  progress?: number;
}

function positioned(
  g: Brush,
  x: number,
  y: number,
  s: number,
  draw: () => void,
) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  draw();
  g.restore();
}

function pump(g: Brush, p: number) {
  ellipse(g, "#3128387a", 0, 2, 51, 7);
  fill(
    g,
    "#8e625d",
    "M-30 0 L-27 -132 Q-26 -146 -15 -149 H16 Q28 -146 28 -134 L31 0Z",
  );
  fill(
    g,
    metal(
      g,
      -141,
      0,
      [0, "#e8c9a7"],
      [0.45, "#dfceb3"],
      [0.48, "#c17562"],
      [1, "#a64f4a"],
    ),
    "M-24 -3 L-24 -129 Q-24 -143 -13 -145 H14 Q25 -143 25 -129 L25 -3Z",
  );
  rect(g, "#657780", -18, -126, 37, 40);
  rect(g, "#e2d6b5", -15, -122, 30, 31);
  const a = Math.PI * (1.13 + 0.75 * p);
  stroke(
    g,
    "#964b4a",
    2,
    `M0 -96 L${Math.cos(a) * 12} ${-96 + Math.sin(a) * 15}`,
  );
  for (let i = 0; i < 5; i++)
    rect(g, "#6b6d66", -12 + i * 6, -118 + Math.abs(i - 2), 1.5, 3);
  rect(g, "#4f565b", -16, -79, 32, 10);
  type(g, "FUEL", 0, -59, 8, "#f1d9b6", "center");
  ellipse(g, "#dbb394", 0, -158, 21, 14);
  ellipse(g, "#6d3c48", 0, -158, 18, 10);
  type(g, "F", 0, -154, 12, "#ffe3b0", "center", 900);
  rect(g, "#637176", -30, -6, 61, 6);
}

function finish(g: Brush, w: number, s: number) {
  const centre = w / 2;
  for (let i = 0; i < 53; i++) {
    const x = noise(i + 721) * w,
      y = 60 + noise(i + 315) * 210;
    g.save();
    g.translate(x, y);
    g.rotate(noise(i + 450) * 3.5);
    rect(
      g,
      ["#f5be79", "#ed8275", "#ded6a3", "#88b6a7"][i % 4]!,
      0,
      0,
      (2 + noise(i) * 4) * s,
      2 * s,
    );
    g.restore();
  }
  positioned(g, centre, 309, s, () => {
    for (const side of [-1, 1]) {
      g.save();
      g.scale(side, 1);
      stroke(g, "#d4c5a7", 4, "M-50 0 L-116 -123");
      g.transform(1, 0.15, 0.36, 1, -115, -122);
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 6; col++)
          rect(
            g,
            (row + col) % 2 ? "#394452" : "#e1d5b8",
            -col * 9,
            row * 8,
            9,
            8,
          );
      g.restore();
    }
    fill(
      g,
      "#b28154",
      "M-30 -71 Q-67 -83 -57 -53 Q-50 -34 -23 -37 L-23 -47 Q-44 -43 -49 -59 Q-54 -71 -29 -63Z M30 -71 Q67 -83 57 -53 Q50 -34 23 -37 L23 -47 Q44 -43 49 -59 Q54 -71 29 -63Z",
    );
    fill(
      g,
      metal(g, -81, -14, [0, "#f8d599"], [0.55, "#d29d60"], [1, "#ac7853"]),
      "M-35 -79 H35 Q34 -40 10 -29 L6 -18 21 -15 23 -9 H-23 L-21 -15 -6 -18 -10 -29 Q-34 -40 -35 -79Z",
    );
    ellipse(g, "#b48861", 0, -78, 35, 5);
    ellipse(g, "#edcc97", 0, -79, 30, 2);
    rect(g, "#43414a", -29, -8, 58, 8);
  });
}

export function drawScene(
  canvas: HTMLCanvasElement,
  kind: SceneLocation,
  options: SceneOptions = {},
) {
  if (kind === "garage") {
    drawGarage(canvas, options);
    return;
  }
  const frame = setup(canvas);
  if (!frame) return;
  const { g, w, h } = frame,
    paint = options.paint ?? "#4ba99e",
    s = Math.min(1.36, w / 730),
    p = Math.max(0, Math.min(1, options.progress ?? 0));
  g.save();
  if (kind === "workshop") {
    rect(
      g,
      metal(g, 0, h, [0, "#273542"], [0.55, "#4d565d"], [1, "#272e3d"]),
      0,
      0,
      w,
      h,
    );
    for (let x = 0; x < w; x += 33) {
      for (let y = 40; y < 290; y += 32)
        ellipse(g, "#9ba89545", x, y, 1.6, 1.6);
    }
    for (let i = 0; i < 3; i++) {
      rect(g, "#c0c8bb", w * (0.12 + i * 0.32), 48, w * 0.12, 4);
      rect(g, "#e3d9bc", w * (0.12 + i * 0.32), 53, w * 0.12, 1);
    }
    positioned(g, w * 0.5, h * 0.55, Math.min(w / 570, 1.3), () =>
      workshop(g, paint, options.part ?? "engine", p),
    );
    g.restore();
    return;
  }
  horizon(g, w, 302, kind === "champion" ? "canyon" : "strip", 0);
  rect(
    g,
    metal(g, 302, h, [0, "#81747a"], [0.3, "#575661"], [1, "#343746"]),
    0,
    302,
    w,
    h - 302,
  );
  for (let i = -5; i <= 5; i++)
    stroke(
      g,
      "#3f3c493f",
      1,
      `M${w * 0.5 + i * 56} 302 L${w * 0.5 + i * 176} 540`,
    );
  if (kind === "diner") {
    positioned(g, w * 0.51, 304, s * 1.43, () => landmark(g, "diner"));
    // Rival in the booth window; the player's car is parked in the foreground.
    positioned(g, w * 0.71, 304 - 59 * s, s * 0.22, () => {
      portrait(g, options.rival ?? 0);
    });
  } else if (kind === "station") {
    positioned(g, w * 0.57, 304, s * 1.53, () => landmark(g, "station"));
    positioned(g, w * 0.22, 304, s, () => {
      rect(g, "#6c7779", -3, -131, 7, 131);
      ellipse(g, "#a86057", 0, -134, 34, 16);
      ellipse(g, "#dba27c", 0, -134, 31, 13);
      type(g, "OCTANE", 0, -130, 10, "#52363c", "center", 900);
    });
  } else finish(g, w, s);
  const carScale = Math.min((w * 0.75) / 500, 1.35),
    cx = kind === "station" ? w * 0.63 : w * 0.5,
    base = 433;
  positioned(g, cx - 250 * carScale, base - 171 * carScale, carScale, () =>
    profile(
      g,
      paint,
      options.model ?? 0,
      options.upgrade ?? 0,
      options.fittings,
    ),
  );
  if (kind === "station") {
    const px = Math.max(40 * s, cx - 266 * carScale),
      py = base - 3 * s;
    positioned(g, px, py, s * 0.98, () => pump(g, p));
    const nozzle = cx - 206 * carScale,
      ny = base - 74 * carScale;
    const hose = `M${px + 25 * s} ${py - 91 * s} C${px + 42 * s} ${py - 64 * s} ${px + 38 * s} ${py + 1 * s} ${px + 58 * s} ${py - 4 * s} S${nozzle - 20 * s} ${ny + 4 * s} ${nozzle} ${ny}`;
    stroke(g, "#272c36", 5 * s, hose);
    stroke(g, "#6e6c6d", 1.4 * s, hose);
    stroke(
      g,
      "#a9b0a4",
      5 * s,
      `M${nozzle - 4 * s} ${ny + 2 * s} l${12 * s} ${-5 * s}`,
    );
  }
  stroke(g, "#c1a39180", 2, `M0 479 L${w} 454`);
  g.restore();
}
