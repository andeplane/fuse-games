import { gauge, tail } from "./cars";
import { front } from "./front";
import { destination, type TownStopArt } from "./town-art";
import {
  approach,
  boulder,
  girders,
  warningSign,
  warningLabel,
  type RoadFeature,
} from "./hazards";
export type { RoadFeature } from "./hazards";
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
  police?: boolean;
  /** Absolute distance along the course in metres. */
  distance: number;
  /** Lane centre in half-road widths, from -1 (left) to +1 (right). */
  lateral: number;
  paint?: string;
  model?: number;
}

export interface RaceArt {
  townStop?: TownStopArt;
  /** Upcoming and active route features, in metres and half-road widths. */
  features?: readonly RoadFeature[];
  /** Positive camera bank when climbing the right aqueduct slope, in degrees. */
  bank?: number;
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
  const features = (state.features ?? []).filter(
    (f) => f.end >= dist - 6 && f.start <= dist + 420,
  );
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
  g.save();
  const bank = Math.max(-60, Math.min(60, state.bank ?? 0));
  if (bank) {
    g.translate(w / 2, sky);
    g.rotate((bank * Math.PI) / 180);
    g.translate(-w / 2, -sky);
    rect(g, "#19384d", -w, -w, w * 3, w + 1);
    // Continue the horizon past the windscreen edges during steep roll.
    for (const origin of [0, 2 * w]) {
      g.save();
      g.translate(origin, 0);
      g.scale(-1, 1);
      horizon(g, w, sky + 1, route, bend);
      g.restore();
    }
  }
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
    bank ? -w : 0,
    sky,
    bank ? 3 * w : w,
    bank ? roadH + w : roadH,
  );
  const segment = 5;
  const near = Math.floor(dist / segment),
    far = near + 70;
  for (let i = far; i >= near; i--) {
    const a =
        i === near && bank
          ? 1 + w / (2 * roadH)
          : proj(Math.max(0, i * segment - dist)),
      b = proj((i + 1) * segment - dist);
    if (route === "aqueduct") {
      for (const s of [-1, 1]) {
        const foot = s < 0 ? -0.57 : 0.74;
        polygon(g, i % 4 === 0 ? "#827d86" : "#a29a98", [
          edge(a, foot),
          y(a),
          edge(b, foot),
          y(b),
          edge(b, s * 1.6),
          y(b) - b * 140,
          edge(a, s * 1.6),
          y(a) - a * 140,
        ]);
        polygon(g, "#e4c3a3", [
          edge(a, s * 1.6),
          y(a) - a * 140,
          edge(b, s * 1.6),
          y(b) - b * 140,
          edge(b, s * 1.62),
          y(b) - b * 138,
          edge(a, s * 1.62),
          y(a) - a * 138,
        ]);
      }
    } else if (route === "canyon") {
      for (const s of [-1, 1]) {
        across(a, b, s, s * 1.176, i % 3 === 0 ? "#c29c80" : "#b18b76");
        across(a, b, s * 1.176, s * 1.2, "#e1b58b");
        across(a, b, s * 1.2, s * 1.43, i % 4 === 0 ? "#755a60" : "#83696a");
      }
    } else {
      across(a, b, -1.2, -1, i % 3 === 0 ? "#bf9b7f" : "#bb9379");
      across(a, b, 1, 1.2, i % 3 === 0 ? "#bf9b7f" : "#bb9379");
    }
    if (route === "aqueduct") {
      across(a, b, -0.57, 0.74, i % 3 === 0 ? "#8b8688" : "#90898a");
      across(a, b, 0.257, 0.274, "#665e66");
      across(a, b, 0.274, 0.328, "#595963");
      across(a, b, 0.328, 0.343, "#aba29b");
      if (i % 3 === 0) across(a, a + (b - a) * 0.035, -0.57, 0.74, "#716e77");
    } else {
      across(a, b, -1, 1, i % 2 === 0 ? "#525160" : "#555462");
      for (const s of [-1, 1]) {
        across(a, b, s * 0.977, s * 0.998, "#d4bead");
        if (i % 5 === 0) across(a, b, s * 0.64, s * 0.643, "#69636e");
      }
      if (i % 4 < 2) across(a, b, -0.011, 0.011, "#f4c897");
    }
    for (const f of features) {
      const at = (i + 0.5) * segment;
      if (at < f.start || at > f.end) continue;
      if (f.kind === "bridge") {
        across(a, b, -1.2, -0.36, "#514b59");
        across(a, b, 0.36, 1.2, "#514b59");
        across(a, b, -0.36, -0.34, "#dabd98");
        across(a, b, 0.34, 0.36, "#dabd98");
      } else if (f.kind === "rough") {
        across(a, b, -0.97, 0.97, i % 2 === 0 ? "#817378" : "#756970");
        for (let k = 0; k < 5; k++) {
          const lane = Math.sin(((i % 9) + k) * 42) * 0.8,
            p = a + ((b - a) * (k + 1)) / 7;
          stroke(
            g,
            "#564f58",
            Math.max(0.5, p * 2),
            `M${edge(p, lane)} ${y(p)} l${8 * p} ${3 * p} ${11 * p} ${-3 * p}`,
          );
        }
      } else if (f.kind === "guardrail") {
        const side = f.lane < 0 ? -1 : 1;
        polygon(g, "#a8a6a0", [
          edge(a, side),
          y(a) - a * 22,
          edge(b, side),
          y(b) - b * 22,
          edge(b, side),
          y(b) - b * 30,
          edge(a, side),
          y(a) - a * 30,
        ]);
        rect(g, "#53505a", edge(a, side), y(a) - a * 23, 3 * a, 23 * a);
      }
    }
    if (route === "strip") {
      // The right concrete rail marks the drag collision edge. Its front is shaded
      // and has expansion joints and amber reflectors for depth at speed.
      polygon(g, i % 4 === 0 ? "#7c7480" : "#908894", [
        edge(a, 0.87),
        y(a),
        edge(b, 0.87),
        y(b),
        edge(b, 0.875),
        y(b) - b * 27,
        edge(a, 0.875),
        y(a) - a * 27,
      ]);
      polygon(g, "#d5bc9e", [
        edge(a, 0.875),
        y(a) - a * 27,
        edge(b, 0.875),
        y(b) - b * 27,
        edge(b, 0.9),
        y(b) - b * 27,
        edge(a, 0.9),
        y(a) - a * 27,
      ]);
      if (i % 3 === 0)
        rect(g, "#f8b973", edge(a, 0.875), y(a) - a * 21, 3 * a, 7 * a);
    }
  }
  type ObjectOnRoad = { z: number; draw: () => void };
  const objects: ObjectOnRoad[] = [];
  const addFeatureObject = (at: number, draw: (p: number) => void) => {
    const z = at - dist;
    if (z >= 0 && z <= 360) objects.push({ z, draw: () => draw(proj(z)) });
  };
  for (const f of features) {
    if (warningLabel(f)) {
      addFeatureObject(f.start - 22, (p) =>
        warningSign(g, edge(p, -1.13), y(p), p * 2.2, f),
      );
    }
    if (f.kind === "rock")
      addFeatureObject(f.start, (p) =>
        boulder(g, edge(p, f.lane), y(p), p * 2.5),
      );
    if (f.kind === "bridge") {
      for (let at = f.start; at <= f.end; at += 12)
        addFeatureObject(at, (p) =>
          girders(g, edge(p, -0.36), edge(p, 0.36), y(p), p),
        );
    }
  }
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
  const stop = state.townStop;
  if (stop) {
    const z = stop.distance - dist;
    if (z >= -4 && z <= 330) {
      const p = proj(Math.max(2, z));
      objects.push({
        z,
        draw: () => destination(g, edge(p, 1.48), y(p), p * 1.6, stop),
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
          car.police ? "#303d4b" : (car.paint ?? "#5aa99f"),
          car.model ?? 0,
          car.police,
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
  g.restore();
  rearview(g, w, h, state);
  approach(g, w, dist, features);
  cockpit(g, w, h, state);
  g.restore();
}

function rearview(g: Brush, w: number, h: number, state: RaceArt) {
  const mw = Math.min(w * 0.24, 164),
    mh = mw * 0.27,
    x = (w - mw) / 2,
    y = h * 0.038;
  rect(g, "#444955", w * 0.5 - 2, 0, 4, y + 5);
  g.save();
  g.beginPath();
  g.roundRect(x, y, mw, mh, mh * 0.19);
  g.fillStyle = "#202c39";
  g.fill();
  g.clip();
  rect(
    g,
    metal(
      g,
      y,
      y + mh,
      [0, "#717385"],
      [0.57, "#e7bca1"],
      [0.58, "#736b74"],
      [1, "#6f6370"],
    ),
    x + 3,
    y + 3,
    mw - 6,
    mh - 6,
  );
  polygon(g, "#555562", [
    x + mw * 0.5,
    y + mh * 0.58,
    x + mw * 0.84,
    y + mh - 3,
    x + mw * 0.16,
    y + mh - 3,
  ]);
  const behind = state.opponents
    .filter(
      (c) =>
        c.distance < state.distance - 1.5 && c.distance > state.distance - 85,
    )
    .sort((a, b) => a.distance - b.distance);
  for (const car of behind) {
    const p = 6 / (state.distance - car.distance + 7);
    const px = x + mw * 0.5 - (car.lateral - state.lateral) * mw * 0.35 * p;
    front(
      g,
      px,
      y + mh * (0.6 + 0.41 * p),
      mw * 0.45 * p,
      car.police ? "#303d4b" : (car.paint ?? "#5aa99f"),
      car.model ?? 0,
      (car.lateral - state.lateral) * 0.4,
      car.police,
    );
  }
  g.restore();
}
