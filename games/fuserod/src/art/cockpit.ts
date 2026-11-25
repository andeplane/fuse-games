import { ellipse, fill, metal, rect, stroke, type Brush } from "./drawing";

function ring(
  g: Brush,
  r: number,
  width: number,
  paint: string | CanvasGradient,
  start = 0,
  end = 2 * Math.PI,
) {
  g.beginPath();
  g.arc(0, 0, r, start, end);
  g.strokeStyle = paint;
  g.lineWidth = width;
  g.stroke();
}

/** Three-spoke wood rim with drilled chrome spokes, stitched leather grip and horn boss. */
export function wheel(
  g: Brush,
  x: number,
  y: number,
  r: number,
  steering: number,
) {
  g.save();
  g.translate(x, y);
  g.scale(r / 92, r / 92);
  const chrome = metal(
    g,
    -75,
    69,
    [0, "#ffe5ba"],
    [0.32, "#c4c9bd"],
    [0.46, "#697880"],
    [0.54, "#d9cead"],
    [0.76, "#747f80"],
    [1, "#39434c"],
  );
  g.rotate(Math.max(-1, Math.min(1, steering)) * 0.85);
  for (const a of [-1.37, 1.37, Math.PI]) {
    g.save();
    g.rotate(a);
    fill(g, "#202431", "M-9 0 L-5 -81 Q0 -91 6 -80 L13 3Z");
    fill(g, chrome, "M-6 -4 L-3 -81 Q1 -86 4 -79 L9 0Z");
    for (let i = 0; i < 4; i++) {
      ellipse(g, "#303743", 1, -26 - i * 12, 2.2 - i * 0.26, 3.8 - i * 0.3);
    }
    g.restore();
  }
  ring(g, 87, 14, "#121924");
  ring(
    g,
    87,
    11,
    metal(
      g,
      -95,
      92,
      [0, "#dea66e"],
      [0.16, "#9e6750"],
      [0.45, "#533d3f"],
      [0.68, "#905d49"],
      [1, "#bc8b66"],
    ),
  );
  ring(g, 88.8, 1.5, "#d6aa7d", Math.PI * 1.09, Math.PI * 1.87);
  g.save();
  g.setLineDash([1.3, 6]);
  ring(g, 83.5, 1.6, "#d2ac84");
  g.restore();
  ring(g, 78, 1.6, "#776b60", 3.4, 5.96);
  ellipse(g, "#222933", 0, 2, 23, 23);
  ellipse(g, chrome, 0, 0, 22, 22);
  ellipse(
    g,
    metal(g, -16, 18, [0, "#b79572"], [0.32, "#9e7762"], [0.86, "#664c47"]),
    0,
    0,
    16,
    16,
  );
  fill(g, "#eed3aa", "M-10 -4 H10 L7 -1 H1 L0 8 -3 8 -4 -1 H-8Z");
  g.restore();
}

export function consoleTrim(
  g: Brush,
  w: number,
  h: number,
  center: number,
  y: number,
  r: number,
) {
  const l = center - 2.45 * r,
    right = center + 3.9 * r;
  fill(
    g,
    metal(
      g,
      y - r - 6,
      y + r,
      [0, "#d0c8ab"],
      [0.11, "#77817f"],
      [0.18, "#a6a89b"],
      [0.79, "#4e5b61"],
      [1, "#b4b5a4"],
    ),
    `M${l - 9} ${h} V${y + 4} Q${l - 5} ${y - r - 6} ${center - 1.3 * r} ${y - r - 5} H${right - 9} Q${right + 2} ${y - r + 2} ${right + 5} ${y + 1} V${h}Z`,
  );
  fill(
    g,
    metal(g, y - r, y + r, [0, "#272c35"], [0.5, "#413a38"], [1, "#26262c"]),
    `M${l - 5} ${h} V${y + 4} Q${l - 1} ${y - r - 2} ${center - 1.3 * r} ${y - r - 1} H${right - 10} Q${right - 2} ${y - r + 4} ${right + 1} ${y + 3} V${h}Z`,
  );
  if (w > 770) {
    const l = w * 0.79,
      span = Math.min(w * 0.15, 180);
    stroke(
      g,
      "#79827f",
      1.6,
      `M${l - 10} ${y - 14} H${l + span + 8} l-4 30 H${l - 8}Z`,
    );
    for (let i = 0; i < 5; i++) {
      rect(g, "#151e29", l, y - 8 + i * 4, span, 2.4);
      rect(g, "#576267", l, y - 7 + i * 4, span, 0.6);
    }
    for (const x of [l - 15, l + span + 13])
      ellipse(g, "#c2c3ad", x, y, 3.4, 3.4);
  }
}
