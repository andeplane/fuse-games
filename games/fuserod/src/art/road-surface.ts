import { noise, polygon, type Brush } from "./drawing";
import { vergeSprite } from "./verge";
import type { Route } from "./landscape";

const sources = {
  ground: new URL("./canyon-ground.webp", import.meta.url).href,
  asphalt: new URL("./asphalt-grain.webp", import.meta.url).href,
};
type Material = keyof typeof sources;
const images: Partial<Record<Material, HTMLImageElement>> = {};
const paints = new WeakMap<Brush, Partial<Record<Material, CanvasPattern>>>();
const transform = new WeakMap<Brush, DOMMatrix>();

function material(g: Brush, id: Material) {
  let map = paints.get(g);
  if (!map) {
    map = {};
    paints.set(g, map);
  }
  if (map[id]) return map[id];
  let image = images[id];
  if (!image) {
    image = g.canvas.ownerDocument.createElement("img");
    image.src = sources[id];
    images[id] = image;
  }
  if (image.complete && image.naturalWidth)
    map[id] = g.createPattern(image, "repeat") ?? undefined;
  return map[id];
}

export interface SurfaceProjection {
  edge: (p: number, lane: number) => number;
  y: (p: number) => number;
  p: (metres: number) => number;
  halfWidth: number;
}

export function paintSurfaceBand(
  g: Brush,
  id: Material,
  route: Route,
  projection: SurfaceProjection,
  worldA: number,
  worldB: number,
  distance: number,
  w: number,
) {
  const pattern = material(g, id);
  if (!pattern || worldB <= distance || worldA - distance > 350) return;
  const { edge, y, p, halfWidth } = projection;
  let matrix = transform.get(g);
  if (!matrix) {
    matrix = new DOMMatrix();
    transform.set(g, matrix);
  }
  // Split only the foreground. The small screen-space far bands already filter
  // the texels down to asphalt haze; the approach to the bonnet has visible grain.
  const step = worldA - distance < 20 ? 1 : worldB - worldA;
  const near = Math.max(worldA, distance);
  for (let at = near; at < worldB - 0.0001; at += step) {
    const end = Math.min(at + step, worldB),
      a = p(at - distance),
      b = p(end - distance),
      mid = (a + b) * 0.5;
    const ya = y(a),
      yb = y(b);
    if (ya - yb < 0.12) continue;
    const terrain = id === "ground";
    matrix.a = (halfWidth * mid * (terrain ? 2.8 : 1.6)) / 512;
    matrix.d = (ya - yb) / ((end - at) * 15);
    matrix.e = edge(mid, 0);
    matrix.f = ya + at * 15 * matrix.d;
    pattern.setTransform(matrix);
    g.globalAlpha = terrain
      ? route === "canyon"
        ? Math.min(0.99, 35 * mid)
        : 0.48
      : Math.min(0.92, 0.25 + mid * 2.8);
    g.fillStyle = pattern;
    g.beginPath();
    if (terrain) {
      g.rect(-w, yb - 0.3, 3 * w, ya - yb + 0.6);
    } else {
      g.moveTo(edge(a, -1), ya);
      g.lineTo(edge(a, 1), ya);
      g.lineTo(edge(b, 1), yb);
      g.lineTo(edge(b, -1), yb);
    }
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Low creosote and warm/cool rock facets on the canyon verges. */
export function desertPatch(
  g: Brush,
  x: number,
  y: number,
  size: number,
  id: number,
) {
  if (
    vergeSprite(
      g,
      x,
      y,
      size * (id % 4 === 0 ? 54 : 46),
      id % 4 === 0 ? 3 : 2,
      id % 3 === 0,
    )
  )
    return;
  g.save();
  g.translate(x, y);
  g.scale(size, size);
  const shade = id % 3 === 0 ? "#815f4f" : "#936146",
    sun = id % 3 === 0 ? "#c19970" : "#d69a62";
  polygon(g, "#6a514c73", [-20, 1, 4, -2, 20, 0, -14, 3]);
  if (id % 4 === 0) {
    polygon(g, shade, [-14, 0, -10, -6, -3, -11, 6, -10, 13, -4, 16, 1]);
    polygon(g, sun, [-11, -5, -3, -11, 6, -10, 2, -6, -6, -3]);
  } else {
    for (let i = 0; i < 6; i++) {
      const spread = (i - 2.5) * 4.1,
        height = 3 + noise(i + id) * 10;
      polygon(g, i % 3 === 0 ? "#a29568" : "#666b50", [
        spread * 0.25,
        0,
        spread * 0.8 - 2,
        -height * 0.7,
        spread,
        -height,
        spread * 0.78 + 2,
        -height * 0.45,
        spread * 0.44,
        0,
      ]);
    }
  }
  g.restore();
}
