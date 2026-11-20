import { profile } from "./cars";
import type { VehicleFittings } from "./vehicle-families";
import {
  ellipse,
  fill,
  metal,
  polygon,
  rect,
  setup,
  stroke,
  type,
} from "./drawing";
import { horizon } from "./landscape";

export interface GarageArt {
  fittings?: VehicleFittings;
  paint?: string;
  model?: number;
  upgrade?: number;
}

export function drawGarage(canvas: HTMLCanvasElement, car: GarageArt = {}) {
  const frame = setup(canvas);
  if (!frame) return;
  const { g, w, h } = frame;
  g.save();
  horizon(g, w, 324, "strip", 0);
  rect(
    g,
    metal(g, 305, h, [0, "#5f5865"], [0.23, "#5b535b"], [1, "#272c3d"]),
    0,
    304,
    w,
    h - 304,
  );
  const doorLeft = w * 0.14,
    doorRight = w * 0.83;
  // Tiled forecourt with fine seams, perspective converging through the open bay.
  for (let i = -9; i <= 9; i++) {
    stroke(
      g,
      "#3a354061",
      1.3,
      `M${w * 0.55 + i * 52} 303 L${w * 0.55 + i * 160} 545`,
    );
  }
  for (const y of [317, 337, 370, 420, 490])
    stroke(g, "#33333f77", 1, `M0 ${y} L${w} ${y - 5}`);
  polygon(g, "#282a3b88", [0, 305, doorLeft, 305, w * 0.56, 529, 0, 540]);
  rect(g, "#333645", 0, 0, doorLeft, 320);
  rect(g, "#374250", doorRight, 0, w - doorRight, 333);
  for (let y = 18; y < 312; y += 16) {
    rect(g, "#46505a", 0, y, doorLeft, 2);
    rect(g, "#47545d", doorRight, y, w - doorRight, 2);
  }
  rect(g, "#222b39", doorLeft - 10, 0, 10, 324);
  rect(g, "#bfb3a0", doorLeft - 4, 54, 4, 265);
  rect(g, "#262e3a", doorRight, 0, 11, 333);
  rect(g, "#cbb197", doorRight, 57, 3, 250);
  rect(g, "#29303b", 0, 0, w, 54);
  for (let y = 6; y < 52; y += 8) rect(g, "#3e4750", 0, y, w, 2);
  rect(g, "#161c2a", 0, 50, w, 7);
  rect(g, "#eac8a4", doorLeft, 56, doorRight - doorLeft, 2);
  const logoX = doorLeft * 0.49,
    logoY = 149,
    badge = Math.min(doorLeft * 0.39, 33);
  ellipse(g, "#a7594e", logoX, logoY, badge, badge);
  ellipse(g, "#e0c9a6", logoX, logoY, badge * 0.86, badge * 0.86);
  ellipse(g, "#9b504b", logoX, logoY, badge * 0.76, badge * 0.76);
  type(g, "R", logoX, logoY + badge * 0.34, badge, "#fff1d4", "center", 900);
  // Service cabinet and tools, lit by the cool tube under the mezzanine.
  const cabinet = w * 0.125;
  rect(g, "#613b41", 0, 250, cabinet, 63);
  rect(g, "#c08b71", 0, 249, cabinet + 3, 4);
  for (let i = 0; i < 4; i++) {
    rect(g, "#984e4b", 2, 255 + i * 12, cabinet - 5, 9);
    rect(g, "#cca99a", cabinet * 0.2, 257 + i * 12, cabinet * 0.52, 1.4);
  }
  for (let i = 0; i < 4; i++) {
    const x = doorRight + 18 + i * 12,
      y = 200 + (i % 2) * 8;
    stroke(g, "#9faba7", 2, `M${x} ${y} l0 18 m-3 -20 q3 5 6 0`);
  }
  rect(g, "#242b3b", doorRight + 9, 232, w - doorRight - 9, 9);
  rect(g, "#a7c8ba", doorRight + 10, 231, w - doorRight - 10, 2);
  const carW = Math.min(w * 0.88, 800),
    scale = carW / 500,
    baseline = 395;
  ellipse(g, "#1d1b2baa", w * 0.5, baseline + 2, carW * 0.51, carW * 0.039);
  // Soft, elongated reflection in the concrete beneath the chassis.
  g.save();
  g.translate(w * 0.5 - carW * 0.5, baseline + 8);
  g.scale(scale, -scale * 0.18);
  g.globalAlpha = 0.13;
  profile(
    g,
    car.paint ?? "#dd604b",
    car.model ?? 0,
    car.upgrade ?? 0,
    car.fittings,
  );
  g.restore();
  g.save();
  g.translate(w * 0.5 - carW * 0.5, baseline - 170 * scale);
  g.scale(scale, scale);
  profile(
    g,
    car.paint ?? "#dd604b",
    car.model ?? 0,
    car.upgrade ?? 0,
    car.fittings,
  );
  g.restore();
  // Diagonal stripe painted along the threshold in the foreground.
  fill(g, "#d7a87575", `M0 488 L${w} 442 L${w} 445 L0 497Z`);
  fill(g, "#c8946a4d", `M0 500 L${w} 447 L${w} 449 L0 505Z`);
  g.restore();
}
