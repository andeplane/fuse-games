import { FLOOR_TOP_PX } from "../../engine/view-kit.js";
import { bayer, dither, hash, type Raster } from "./kit.js";

/** Fill the sky to the top of the floor, before painting its silhouettes. */
export function paintSky(
  raster: Raster,
  palette: readonly number[],
  tone: (x: number, y: number) => number,
): void {
  for (let y = 0; y < FLOOR_TOP_PX; y++)
    for (let x = 0; x < raster.width; x++)
      raster.px(x, y, dither(palette, tone(x, y), x, y));
}

/** The broad glow around a moon, fading to nothing 70 pixels out. */
export const moonGlow = (distance: number, intensity: number): number =>
  Math.max(0, 1 - distance / 70) * intensity;

interface Stars {
  count: number;
  top: number;
  height: number;
  /** Keep subpixel positions for visibility tests; Raster snaps the painted pixel. */
  subpixel?: boolean;
  color(index: number, x: number, y: number): number | undefined;
}

/** Paint one deterministic star field, with color and visibility chosen by the scene. */
export function paintStars(raster: Raster, stars: Stars): void {
  const position = stars.subpixel ? (value: number) => value : Math.floor;
  for (let index = 0; index < stars.count; index++) {
    const x = position(hash(index, 1) * raster.width);
    const y = stars.top + position(hash(index, 2) * stars.height);
    const color = stars.color(index, x, y);
    if (color !== undefined) raster.px(x, y, color);
  }
}

type Circle = readonly [x: number, y: number, radius: number];

interface Moon {
  disc: Circle;
  /** Sample the disc at a pixel corner (0) or center (0.5). Surface marks use corners. */
  sampleOffset: number;
  lightCenter: readonly [x: number, y: number];
  marks: readonly Circle[];
  colors: { light: number; shadow: number; marks: number };
  halo: { radius: number; fade: number; color: number };
}

/** Paint a dithered halo, a shadow limb, and the lit surface and its markings. */
export function paintMoon(raster: Raster, moon: Moon): void {
  const {
    disc: [cx, cy, radius],
    halo,
    sampleOffset,
    lightCenter,
    marks,
    colors,
  } = moon;
  const left = Math.floor(cx - halo.radius);
  const right = Math.ceil(cx + halo.radius);
  const top = Math.floor(cy - halo.radius);
  const bottom = Math.ceil(cy + halo.radius);
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const sampleX = x + sampleOffset;
      const sampleY = y + sampleOffset;
      const distance = Math.hypot(sampleX - cx, sampleY - cy);
      if (distance >= halo.radius) continue;
      if (distance >= radius) {
        if (bayer(x, y) < (halo.radius - distance) / halo.fade)
          raster.px(x, y, halo.color);
      } else if (
        Math.hypot(sampleX - lightCenter[0], sampleY - lightCenter[1]) > radius
      ) {
        raster.px(x, y, colors.shadow);
      } else {
        const marked = marks.some(
          ([mx, my, r]) => Math.hypot(x - mx, y - my) < r,
        );
        raster.px(x, y, marked ? colors.marks : colors.light);
      }
    }
}
