import { gauge, tail } from "./cars";
import {
  ellipse,
  fill,
  metal,
  polygon,
  rect,
  setup,
  stroke,
  type,
  type Brush,
} from "./drawing";
import { horizon, roadside, type Route } from "./landscape";

export { drawGarage, type GarageArt } from "./garage";
export type { Route } from "./landscape";

export interface RoadOpponent {
  /** Absolute distance along the course in metres. */
  distance: number;
  /** Lane centre in half-road widths, from -1 (left) to +1 (right). */
  lateral: number;
  paint?: string;
  model?: number;
}

export interface RaceArt {
  distance: number;
  speed: number;
  lateral: number;
  curve: number;
  opponents: readonly RoadOpponent[];
  paint?: string;
  model?: number;
  route?: Route;
  gear?: number;
  rpm?: number;
  finishDistance?: number;
}

function cockpit(g: Brush, w: number, h: number, state: RaceArt) {
  const paint = state.paint ?? "#ce614d",
    hoodY = h * 0.838;
  // Raised fenders and two pressed bonnet creases track the vehicle, not the scenery.
  fill(
    g,
    paint,
    `M0 ${hoodY + 31} Q${w * 0.15} ${hoodY - 13} ${w * 0.24} ${hoodY + 7} Q${w * 0.49} ${hoodY - 1} ${w * 0.75} ${hoodY + 7} Q${w * 0.86} ${hoodY - 13} ${w} ${hoodY + 31} L${w} ${h} H0Z`,
  );
  fill(
    g,
    metal(
      g,
      hoodY - 7,
      hoodY + 42,
      [0, "#fff0b978"],
      [0.22, "#f3b5a832"],
      [0.6, "#19283f52"],
      [1, "#192438d9"],
    ),
    `M0 ${hoodY + 31} Q${w * 0.15} ${hoodY - 13} ${w * 0.24} ${hoodY + 7} Q${w * 0.49} ${hoodY - 1} ${w * 0.75} ${hoodY + 7} Q${w * 0.86} ${hoodY - 13} ${w} ${hoodY + 31} L${w} ${h} H0Z`,
  );
  stroke(
    g,
    "#f9d5b198",
    2,
    `M${w * 0.23} ${hoodY + 8} L${w * 0.14} ${hoodY + 38} M${w * 0.76} ${hoodY + 8} L${w * 0.85} ${hoodY + 38}`,
  );
  const dashY = h * 0.9;
  fill(
    g,
    metal(
      g,
      dashY,
      h,
      [0, "#435057"],
      [0.09, "#aabbaf"],
      [0.15, "#28323a"],
      [0.58, "#1e2832"],
      [1, "#151c26"],
    ),
    `M0 ${dashY + 2} Q${w * 0.5} ${dashY - 16} ${w} ${dashY + 2} V${h} H0Z`,
  );
  const d = Math.min(29, w * 0.075),
    cluster = w * 0.52;
  gauge(g, cluster - d * 2.45, h - 23, d, state.speed, 230, "KM/H", 0.9);
  gauge(g, cluster + d * 0.27, h - 24, d, state.rpm ?? 0, 8000, "RPM", 0.79);
  const gearX = cluster + 2.25 * d,
    gearY = h - 24;
  rect(g, "#111c27", gearX - d * 0.48, gearY - d * 0.49, d * 0.96, d * 0.98);
  type(
    g,
    String(state.gear ?? "–"),
    gearX,
    gearY + d * 0.3,
    d * 0.83,
    "#efc693",
    "center",
  );
  // Only the upper rim of the driving wheel enters the view.
  const wheelX = w * 0.22,
    wheelR = Math.min(w * 0.178, 88),
    wheelY = h + wheelR * 0.64;
  g.beginPath();
  g.arc(wheelX, wheelY, wheelR, Math.PI * 1.04, Math.PI * 1.96);
  g.strokeStyle = "#0e1620";
  g.lineWidth = 13;
  g.stroke();
  g.strokeStyle = "#765754";
  g.lineWidth = 7;
  g.stroke();
  g.strokeStyle = "#bf9c80";
  g.lineWidth = 1.2;
  g.stroke();
}

export function drawRace(canvas: HTMLCanvasElement, state: RaceArt) {
  const frame = setup(canvas);
  if (!frame) return;
  const { g, w, h } = frame,
    route = state.route ?? "strip";
  const dist = Math.max(0, state.distance);
  const bend = Math.max(-1, Math.min(1, state.curve));
  const cameraLane = Math.max(-1.7, Math.min(1.7, state.lateral));
  const sky = h * 0.46,
    roadH = h - sky;
  const vanishing = w * (0.5 + bend * 0.14),
    bottom = Math.max(w * 0.79, 365);
  const proj = (z: number) => 10 / (z + 10);
  const y = (p: number) => sky + p * roadH;
  const center = (p: number) =>
    vanishing +
    (w * 0.5 - vanishing) * p +
    bend * w * 0.08 * p * (1 - p) -
    cameraLane * p * bottom;
  const edge = (p: number, lane: number) => center(p) + bottom * p * lane;
  const across = (
    p: number,
    q: number,
    left: number,
    right: number,
    color: string,
  ) => {
    polygon(g, color, [
      edge(p, left),
      y(p),
      edge(p, right),
      y(p),
      edge(q, right),
      y(q),
      edge(q, left),
      y(q),
    ]);
  };
  g.save();
  horizon(g, w, sky + 1, route, bend);
  rect(
    g,
    metal(
      g,
      sky,
      h,
      [0, "#a78885"],
      [0.35, route === "aqueduct" ? "#847f83" : "#aa8271"],
      [1, route === "aqueduct" ? "#595c6b" : "#745a5d"],
    ),
    0,
    sky,
    w,
    roadH,
  );
  const segment = 5;
  const near = Math.floor(dist / segment),
    far = near + 70;
  for (let i = far; i >= near; i--) {
    const a = proj(Math.max(0, i * segment - dist)),
      b = proj((i + 1) * segment - dist);
    if (route === "aqueduct") {
      across(a, b, -1.8, -1, i % 4 === 0 ? "#978a85" : "#aa9c95");
      across(a, b, 1, 1.8, i % 4 === 0 ? "#8e8085" : "#9e9192");
    } else {
      across(a, b, -1.2, -1, i % 3 === 0 ? "#bf9b7f" : "#bb9379");
      across(a, b, 1, 1.2, i % 3 === 0 ? "#bf9b7f" : "#bb9379");
    }
    across(a, b, -1, 1, i % 2 === 0 ? "#525160" : "#555462");
    // The two shoulders and worn centre stripe remain visible into a bend.
    for (const s of [-1, 1]) {
      across(a, b, s * 0.977, s * 0.998, "#d4bead");
      if (i % 5 === 0) across(a, b, s * 0.64, s * 0.643, "#69636e");
    }
    if (i % 4 < 2) across(a, b, -0.011, 0.011, "#f4c897");
  }
  type ObjectOnRoad = { z: number; draw: () => void };
  const objects: ObjectOnRoad[] = [];
  for (
    let i = Math.floor(dist / 20) + 1;
    i <= Math.floor((dist + 250) / 20);
    i++
  ) {
    const z = i * 20 - dist,
      p = proj(z);
    for (const side of [-1, 1]) {
      const id = i + (side === 1 ? 15 : 0);
      const x = edge(p, side * (1.26 + (id % 4) * 0.11));
      if (x < -100 || x > w + 100) continue;
      objects.push({
        z,
        draw: () => roadside(g, x, y(p), p * 3.3, id, route, side),
      });
    }
  }
  for (const car of state.opponents) {
    const z = car.distance - dist;
    if (z < -1.5 || z > 340) continue;
    const p = proj(Math.max(0, z) + 3.6);
    objects.push({
      z,
      draw: () =>
        tail(
          g,
          edge(p, car.lateral),
          y(p),
          bottom * p * 0.45,
          car.paint ?? "#5aa99f",
          car.model ?? 0,
        ),
    });
  }
  if (state.finishDistance !== undefined) {
    const z = state.finishDistance - dist;
    if (z >= 0 && z <= 235) {
      const p = proj(z);
      objects.push({
        z,
        draw: () => {
          const l = edge(p, -1.08),
            r = edge(p, 1.08),
            base = y(p),
            top = base - p * 275,
            height = p * 32;
          rect(g, "#34424b", l - 3 * p, top, 5 * p, base - top);
          rect(g, "#34424b", r, top, 5 * p, base - top);
          rect(g, "#deded1", l, top, r - l, height);
          for (let i = 0; i < 18; i++)
            rect(
              g,
              "#343948",
              l + (i * (r - l)) / 18,
              top + ((i % 2) * height) / 2,
              (r - l) / 18,
              height / 2,
            );
        },
      });
    }
  }
  objects.sort((a, b) => b.z - a.z);
  for (const object of objects) object.draw();
  cockpit(g, w, h, state);
  g.restore();
}
