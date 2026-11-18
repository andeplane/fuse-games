import {
  ellipse,
  fill,
  polygon,
  rect,
  stroke,
  type,
  type Brush,
} from "./drawing";

export interface RoadFeature {
  kind: "bridge" | "rough" | "rock" | "bank" | "guardrail";
  start: number;
  end: number;
  lane: number;
}

export function warningLabel(feature: RoadFeature) {
  switch (feature.kind) {
    case "bridge":
      return "NARROW BRIDGE";
    case "rough":
      return "ROUGH · 60 MPH";
    case "rock":
      return "ROCK · 30 MPH";
    default:
      return "";
  }
}

export function warningSign(
  g: Brush,
  x: number,
  y: number,
  scale: number,
  feature: RoadFeature,
) {
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  rect(g, "#565966", -2.4, -102, 4.8, 102);
  fill(g, "#342e3d", "M0 -123 L23 -100 0 -77 -23 -100Z");
  fill(g, "#f4ba75", "M0 -120 L20 -100 0 -80 -20 -100Z");
  if (feature.kind === "bridge") {
    stroke(
      g,
      "#463e48",
      3.5,
      "M-10 -111 L-6 -105 -6 -95 -10 -89 M10 -111 L6 -105 6 -95 10 -89",
    );
  } else {
    type(
      g,
      feature.kind === "rock" ? "30" : "60",
      0,
      -94,
      17,
      "#453d46",
      "center",
      900,
    );
  }
  g.restore();
}

export function boulder(g: Brush, x: number, y: number, scale: number) {
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  ellipse(g, "#221e2d70", 0, 0, 31, 5);
  fill(
    g,
    "#624953",
    "M-30 -2 L-26 -12 -14 -20 -2 -26 14 -23 26 -11 30 -1 8 1Z",
  );
  fill(g, "#c6a18a", "M-26 -12 L-14 -20 -2 -26 14 -23 5 -15 -8 -11Z");
  fill(
    g,
    "#9d8075",
    "M-26 -12 L-8 -11 2 -4 -29 -2Z M15 -22 L26 -11 10 -7 5 -15Z",
  );
  ellipse(g, "#856b65", 35, 1, 5, 2.8);
  g.restore();
}

export function girders(
  g: Brush,
  left: number,
  right: number,
  base: number,
  p: number,
) {
  const height = 185 * p,
    width = right - left,
    top = base - height;
  polygon(g, "#735658", [
    left,
    base,
    left + 4 * p,
    base,
    left + 8 * p,
    top,
    right - 8 * p,
    top,
    right - 4 * p,
    base,
    right,
    base,
    right - 2 * p,
    top - 6 * p,
    left + 2 * p,
    top - 6 * p,
  ]);
  stroke(
    g,
    "#c99c7d",
    2 * p,
    `M${left + p} ${base} L${left + 4 * p} ${top - 5 * p} H${right - 4 * p} L${right - p} ${base}`,
  );
  for (let i = 0; i < 6; i++) {
    const x = left + (width * i) / 6;
    stroke(
      g,
      "#986e67",
      4 * p,
      `M${x} ${top - 22 * p} l${width / 12} ${20 * p} ${width / 12} ${-20 * p}`,
    );
  }
  stroke(
    g,
    "#695967",
    5 * p,
    `M${left + 2 * p} ${top - 22 * p} H${right - 2 * p}`,
  );
  for (const x of [left, right]) {
    rect(g, "#484454", x - 3 * p, base - 30 * p, 6 * p, 29 * p);
    for (let i = 0; i < 3; i++)
      rect(g, "#efb77c", x - 3 * p, base - (7 + i * 9) * p, 6 * p, 3 * p);
  }
}

export function approach(
  g: Brush,
  w: number,
  distance: number,
  features: readonly RoadFeature[],
) {
  const f = features.find(
    (feature) =>
      warningLabel(feature) &&
      feature.end >= distance &&
      feature.start - distance <= 80,
  );
  if (!f) return;
  const label = warningLabel(f),
    meters = Math.max(0, Math.ceil((f.start - distance) / 5) * 5);
  const size = Math.max(12, Math.min(16, w * 0.027)),
    x = 12,
    y = w < 550 ? 60 : 10;
  g.save();
  g.font = `700 ${size}px "Barlow Condensed","Arial Narrow",sans-serif`;
  const text = meters ? `${label} · ${meters} M` : label;
  const width = g.measureText(text).width + 16;
  rect(g, "#252736ed", x, y, width, size * 1.7);
  rect(g, "#efb878", x, y, 3, size * 1.7);
  type(g, text, x + 9, y + size * 1.25, size, "#ffddaa");
  g.restore();
}
