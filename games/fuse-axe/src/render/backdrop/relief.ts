import { dither, hash, type Raster } from "./kit.js";

export type Inside = (x: number, y: number) => boolean;
export type Box = readonly [x0: number, y0: number, x1: number, y1: number];
type Ramp = readonly [
  ink: number,
  dark: number,
  base: number,
  lit: number,
  accent?: number,
];
type Offset = readonly [dx: number, dy: number];
type Shade = "ink" | "dark" | "lit" | "accent";
type Edge = readonly [shade: Shade, offsets: readonly Offset[]];

const OUTLINE: Edge = [
  "ink",
  [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ],
];
const TOP: readonly Offset[] = [[0, -2]];
const RIGHT_LIGHT: Edge = [
  "lit",
  [
    [1, -1],
    [2, 0],
  ],
];
const LEFT_SHADE: readonly Offset[] = [
  [0, 2],
  [-2, 0],
];

/** Sample two pixels beyond the paint bounds so repeated edge probes reuse expensive geometry. */
function paddedMask([x0, y0, x1, y1]: Box, inside: Inside): Inside {
  const border = 2;
  const width = x1 - x0 + 2 * border;
  const mask = new Uint8Array(width * (y1 - y0 + 2 * border));
  const index = (x: number, y: number) =>
    (y - y0 + border) * width + x - x0 + border;
  for (let y = y0 - border; y < y1 + border; y++)
    for (let x = x0 - border; x < x1 + border; x++)
      mask[index(x, y)] = inside(x, y) ? 1 : 0;
  return (x, y) => mask[index(x, y)] === 1;
}

interface Lighting {
  edges: readonly Edge[];
  grain: number;
  cacheShape?: boolean;
}

function touchesOutside(
  at: Inside,
  x: number,
  y: number,
  offsets: readonly Offset[],
): boolean {
  for (const [dx, dy] of offsets) if (!at(x + dx, y + dy)) return true;
  return false;
}

/** Bakes a silhouette with its edges checked from highest to lowest priority. */
function reliefPainter({ edges, grain, cacheShape }: Lighting) {
  const ordered = [OUTLINE, ...edges];
  return (
    raster: Raster,
    box: Box,
    inside: Inside,
    [ink, dark, base, lit, accent = lit]: Ramp,
    tone?: (x: number, y: number) => number,
  ): void => {
    const [x0, y0, x1, y1] = box;
    const at = cacheShape ? paddedMask(box, inside) : inside;
    const shades = { ink, dark, lit, accent };
    const interior = [dark, base, lit];
    const colorAt = (x: number, y: number): number => {
      for (const [shade, offsets] of ordered)
        if (touchesOutside(at, x, y, offsets)) return shades[shade];

      if (tone) return dither(interior, tone(x, y), x, y);
      return hash(x, y) > grain ? dark : base;
    };
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        if (at(x, y)) raster.px(x, y, colorAt(x, y));
  };
}

/** Moss on the top and moonlight from the upper right. */
export const moonlitRelief = reliefPainter({
  edges: [["accent", TOP], RIGHT_LIGHT, ["dark", LEFT_SHADE]],
  grain: 0.93,
});

/** Snow on the top and an extra diagonal shadow on the lower left. */
export const snowyRelief = reliefPainter({
  edges: [["accent", TOP], RIGHT_LIGHT, ["dark", [...LEFT_SHADE, [-1, 1]]]],
  grain: 0.95,
  cacheShape: true,
});

/** Light on the top, warmth on the left, and shadow to the right and below. */
export const torchlitRelief = reliefPainter({
  edges: [
    ["lit", TOP],
    ["accent", [[-2, 0]]],
    [
      "dark",
      [
        [2, 0],
        [0, 2],
      ],
    ],
  ],
  grain: 0.94,
});
