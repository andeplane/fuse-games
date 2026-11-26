import {
  ellipse,
  fill,
  metal,
  rect,
  stroke,
  type,
  type Brush,
} from "./drawing";
export type TownKind = "garage" | "diner" | "strip" | "station";
export interface TownStopArt {
  name: string;
  kind: TownKind;
  distance: number;
}

/** Neon roadside architecture in a 320-wide footprint. Origin is ground-centre. */
export function landmark(g: Brush, kind: TownKind) {
  if (kind === "strip") {
    for (const x of [-114, 114]) rect(g, "#4b515d", x, -89, 6, 89);
    rect(g, "#73606b", -114, -98, 234, 18);
    for (let i = 0; i < 20; i++) {
      rect(g, "#ead3a8", -113 + i * 11.6, -98 + (i % 2) * 9, 11.6, 9);
    }
    type(g, "DRAGWAY", 0, -58, 18, "#f6c78d", "center");
    return;
  }
  if (kind === "garage") {
    rect(g, "#5c6670", -141, -63, 282, 64);
    rect(g, "#313c49", -126, -48, 132, 48);
    for (let i = 0; i < 8; i++) rect(g, "#58606b", -125, -45 + i * 5, 130, 1);
    rect(g, "#334552", 29, -47, 62, 47);
    rect(g, "#ddb984", -144, -72, 288, 9);
    type(g, "ROD WORKS", 64, -53, 11, "#f8d8a4", "center");
    return;
  }
  if (kind === "station") {
    rect(g, "#778780", -128, -68, 179, 68);
    rect(g, "#444e56", -120, -48, 58, 48);
    for (let i = 0; i < 8; i++) rect(g, "#7c8885", -119, -47 + i * 6, 56, 1);
    rect(g, "#273e4b", -52, -51, 87, 43);
    rect(g, "#e1c2a3", -45, -48, 3, 38);
    rect(g, "#e1c2a3", 0, -48, 3, 38);
    fill(g, "#b45b52", "M-149 -72 L-129 -85 105 -86 158 -72 147 -61 -150 -61Z");
    rect(g, "#e1b98f", -150, -70, 300, 5);
    rect(g, "#9e9b88", 115, -64, 5, 64);
    for (const x of [55, 85]) {
      rect(g, "#ac645a", x, -26, 13, 26);
      rect(g, "#d3caad", x, -25, 13, 11);
    }
    return;
  }
  fill(g, "#986757", "M-143 0 L-140 -57 125 -55 140 -17 140 0Z");
  fill(g, "#394d58", "M-133 -51 L119 -51 126 -20 -133 -20Z");
  for (let i = 0; i < 9; i++) {
    rect(g, "#d8a577", -132 + i * 28, -49, 23, 26);
    fill(g, "#8a776f", `M${-130 + i * 28} -48 h20 l-13 12 h-7Z`);
    rect(g, "#b7b9a4", -132 + i * 28, -51, 2, 35);
  }
  rect(
    g,
    metal(g, -20, 0, [0, "#c8cabe"], [0.35, "#737e80"], [1, "#9b9990"]),
    -140,
    -20,
    276,
    19,
  );
  for (let i = 0; i < 3; i++) rect(g, "#65747a", -137, -17 + i * 5, 267, 1.4);
  fill(g, "#ca7863", "M-155 -58 L-130 -72 103 -66 147 -52 135 -49 -150 -52Z");
  stroke(g, "#fbd6a1", 2.5, "M-151 -55 L135 -49");
  rect(g, "#65656d", -75, -122, 4, 64);
  ellipse(g, "#82515b", -73, -116, 42, 19);
  ellipse(g, "#e29a78", -73, -116, 38, 15);
  type(g, "DINER", -73, -111, 15, "#402b3a", "center", 900);
  fill(
    g,
    "#ebc194",
    "M-117 -114 L-126 -120 -99 -119 -96 -115Z M-120 -109 L-128 -114 -101 -114 -97 -111Z",
  );
}

export function destination(
  g: Brush,
  x: number,
  y: number,
  s: number,
  stop: TownStopArt,
) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  landmark(g, stop.kind);
  rect(g, "#625965", -102, -66, 3, 67);
  rect(g, "#625965", 4, -66, 3, 67);
  rect(g, "#ddc8a2", -107, -85, 119, 28);
  rect(g, "#3b6866", -104, -82, 113, 22);
  type(
    g,
    stop.name.slice(0, 23).toUpperCase(),
    -48,
    -67,
    stop.name.length > 14 ? 8 : 11,
    "#efdec0",
    "center",
  );
  g.restore();
}
