import {
  ellipse,
  fill,
  noise,
  rect,
  stroke,
  type,
  type Brush,
} from "./drawing";
import { roadside, type Route } from "./landscape";
import { vergeSprite } from "./verge";

export interface RoadTraffic {
  kind: "rock" | "debris" | "warning" | "bush";
  distance: number;
  lateral: number;
}

function barricade(g: Brush) {
  stroke(g, "#68585c", 5, "M-19 0 l6 -31 M20 0 l-6 -31");
  rect(g, "#dcbf92", -27, -31, 54, 14);
  for (let i = 0; i < 4; i++)
    fill(g, "#bf755c", `M${-26 + i * 13} -18 l7 -12 h7 l-7 12Z`);
  ellipse(g, "#e6a567", 0, -35, 4, 5);
}

export function trafficProp(
  g: Brush,
  x: number,
  y: number,
  s: number,
  kind: "debris" | "warning" | "bush",
) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  if (kind === "warning") barricade(g);
  else if (kind === "bush") {
    if (!vergeSprite(g, 0, 0, 54, 2)) roadside(g, 0, 0, 1, 4, "canyon", 1);
  } else {
    ellipse(g, "#24253568", 0, 0, 35, 6);
    fill(g, "#72574d", "M-32 -2 L11 -16 30 -11 -13 4Z");
    fill(g, "#c39168", "M-32 -4 L10 -18 29 -13 -14 2Z");
    fill(g, "#a6785e", "M-15 -14 L-6 -16 27 3 21 5Z");
    stroke(g, "#d7ab7d", 1.5, "M-24 -5 L10 -16 M-10 -13 L19 3");
  }
  g.restore();
}

function pole(g: Brush) {
  fill(g, "#6e5c59", "M-3 0 L-2 -102 1 -104 3 0Z");
  rect(g, "#65565b", -17, -94, 34, 4);
  for (const x of [-13, 0, 13]) {
    rect(g, "#484755", x - 1, -99, 3, 6);
    ellipse(g, "#a3b4a4", x, -99, 2.5, 1.6);
  }
  stroke(g, "#5b596a88", 1, "M-13 -99 Q26 -80 78 -90 M13 -98 Q51 -81 92 -89");
}

function tree(g: Brush, id: number, large: boolean) {
  const s = large ? 1.36 : 1;
  g.save();
  g.scale(s, s);
  fill(
    g,
    "#635157",
    "M-4 0 L-2 -32 -13 -54 -10 -55 -1 -42 1 -64 3 -63 3 -43 16 -58 18 -57 4 -34 3 0Z",
  );
  for (let i = 0; i < 10; i++) {
    const x = (noise(id + i * 8) - 0.5) * 42,
      y = -52 - noise(id * 0.7 + i * 3) * 18;
    ellipse(
      g,
      i % 3 === 0 ? "#6a6268" : "#535464",
      x,
      y,
      9 + noise(id + i) * 6,
      8 + noise(i + 104) * 5,
    );
  }
  g.restore();
}

function hydrant(g: Brush) {
  fill(
    g,
    "#a45c54",
    "M-7 0 L-6 -16 -10 -17 -10 -22 -6 -22 -5 -31 5 -31 6 -22 10 -22 10 -17 6 -16 7 0Z",
  );
  ellipse(g, "#c78968", 0, -31, 6, 4);
  rect(g, "#dec092", -6, -19, 12, 2);
}

export function furniture(
  g: Brush,
  x: number,
  y: number,
  s: number,
  id: number,
  route: Route,
  side: number,
  bend: number,
) {
  const slot = id % 12;
  if (route === "canyon") {
    const vegetation =
      slot === 4 || slot === 5
        ? 0
        : slot === 2
          ? 1
          : slot === 1 || slot === 6 || slot === 10
            ? 2
            : slot === 11
              ? 3
              : undefined;
    if (
      vegetation !== undefined &&
      vergeSprite(
        g,
        x,
        y,
        s *
          (vegetation === 0
            ? slot === 5
              ? 114
              : 77
            : vegetation === 1
              ? 68
              : 43),
        vegetation,
        id % 3 === 0,
      )
    )
      return;
  }
  if (slot === 0 || slot === 1 || slot === 2) {
    roadside(
      g,
      x,
      y,
      s,
      slot === 0 ? 0 : slot === 1 ? 1 : route === "canyon" ? 3 : 4,
      route,
      side,
    );
    return;
  }
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  if (slot === 3) pole(g);
  else if (slot === 4 || slot === 5) tree(g, id, slot === 5);
  else if (slot === 6 && route === "strip") hydrant(g);
  else if ((slot === 7 || slot === 8) && Math.abs(bend) > 0.16) {
    rect(g, "#5c5560", -1.8, -43, 3.6, 43);
    if (slot === 7) {
      rect(g, "#ddaf76", -17, -53, 34, 19);
      g.save();
      g.scale(Math.sign(bend), 1);
      stroke(g, "#5d4750", 4, "M-9 -50 l9 7 -9 7 M3 -50 l9 7 -9 7");
      g.restore();
    } else {
      fill(g, "#e0b476", "M0 -66 L16 -50 0 -34 -16 -50Z");
      g.save();
      g.scale(Math.sign(bend), 1);
      stroke(g, "#654d50", 3, "M-4 -40 q9 -5 3 -9 q-10 -6 4 -10");
      g.restore();
    }
  } else if (slot === 9) {
    rect(g, "#74686a", -2, -21, 4, 21);
    rect(g, "#d2c2a1", -3, -23, 6, 8);
    rect(g, "#e6a56d", -2, -22, 4, 3);
  } else roadside(g, 0, 0, 1, id + 4, route, side);
  g.restore();
}

export function routeBanner(
  g: Brush,
  left: number,
  right: number,
  y: number,
  p: number,
  route: Route,
  bend: number,
) {
  const h = 150 * p,
    boardW = 80 * p,
    center = (left + right) / 2;
  stroke(g, "#4c535e", 4 * p, `M${left} ${y} V${y - h} H${right} V${y}`);
  rect(g, "#d1bf9d", center - boardW, y - h - 20 * p, boardW * 2, 31 * p);
  rect(
    g,
    "#406667",
    center - boardW + 2 * p,
    y - h - 18 * p,
    boardW * 2 - 4 * p,
    27 * p,
  );
  type(
    g,
    route === "canyon"
      ? "CANYON COUNTY"
      : route === "aqueduct"
        ? "FLOOD CHANNEL"
        : "CITY LIMITS",
    center,
    y - h - 2 * p,
    12 * p,
    "#efdec0",
    "center",
  );
  const dir = Math.abs(bend) > 0.24 ? Math.sign(bend) : 0;
  stroke(
    g,
    "#e1d8b5",
    2 * p,
    `M${center} ${y - h + 7 * p} l${dir * 7 * p} ${-5 * p} m${-3 * p} 0 l${3 * p} 0 0 ${3 * p}`,
  );
}
