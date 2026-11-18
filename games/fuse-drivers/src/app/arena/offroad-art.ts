import { getOffroadCourse, projectOffroad } from "../../game/offroad/course.js";
import type {
  OffroadTerrain,
  OffroadTerrainSample,
} from "../../game/offroad/terrain.js";
import type { Point, Track } from "../../game/sim/track.js";
import type { StadiumTheme } from "./theme.js";
import {
  deckMaterial,
  drawFuseRails,
  finishFuseMaterials,
  floodlitFacet,
  furnishStadium,
  markFuseTrack,
} from "./fuse-materials.js";

const CELL = 256;
const GRID = 44;
const WIDTH = 320;
const HEIGHT = 200;

// Each contact cell is four triangular planes meeting at its centre. Paint the back, sides,
// then front in increasing world Y, so a raised lip covers the ground immediately behind it.
const EDGES = [
  [
    [0, 0],
    [CELL, 0],
  ],
  [
    [0, CELL],
    [0, 0],
  ],
  [
    [CELL, 0],
    [CELL, CELL],
  ],
  [
    [CELL, CELL],
    [0, CELL],
  ],
] as const;

const DIRT = [
  "#66330c",
  "#81400d",
  "#9a4e0f",
  "#b26014",
  "#c97a22",
  "#da963e",
  "#e8af62",
];
const WATER = ["#142f7b", "#194cb2", "#376bd2", "#6197e5"];

function paintFacet(sample: OffroadTerrainSample): string {
  // The grade facing the light is bright even on a bank that the tyres cannot climb.
  const light = (sample.slopeX + sample.slopeY * 1.6) / 6;
  const palette = sample.kind === 2 ? WATER : DIRT;
  return palette[
    Math.max(
      0,
      Math.min(
        palette.length - 1,
        Math.round((palette.length - 1) / 2 - light),
      ),
    )
  ]!;
}

/** Find the driveable faces connected to the grid. Outer ground and enclosed infields also
 * contain flat contact planes; painting a kerb on their far side draws a second fictitious course. */
function raceway(terrain: OffroadTerrain, spawn: Point): Uint8Array {
  const passable = new Uint8Array(GRID * GRID * 4);
  const samples = [
    [128, 64],
    [64, 128],
    [192, 128],
    [128, 192],
  ] as const;
  for (let cell = 0; cell < GRID * GRID; cell++) {
    const x = (cell % GRID) * CELL,
      y = Math.floor(cell / GRID) * CELL;
    samples.forEach(([dx, dy], face) => {
      passable[cell * 4 + face] = terrain.sample(x + dx, y + dy)!.blocked
        ? 0
        : 1;
    });
  }
  const reachable = new Uint8Array(passable.length);
  const pending: number[] = [];
  const visit = (i: number) => {
    if (passable[i] && !reachable[i]) {
      reachable[i] = 1;
      pending.push(i);
    }
  };
  const cell = Math.floor(spawn.y / CELL) * GRID + Math.floor(spawn.x / CELL);
  for (let i = 0; i < 4; i++) visit(cell * 4 + i);
  while (pending.length) {
    const i = pending.pop()!,
      idx = i >>> 2,
      face = i & 3;
    if (face === 0 || face === 3) {
      visit(idx * 4 + 1);
      visit(idx * 4 + 2);
      visit(face === 0 ? i - GRID * 4 + 3 : i + GRID * 4 - 3);
    } else {
      visit(idx * 4);
      visit(idx * 4 + 3);
      if (face === 1 && idx % GRID > 0) visit(i - 3);
      if (face === 2 && idx % GRID < GRID - 1) visit(i + 3);
    }
  }
  return reachable;
}

/** Draw the course from its measured contact planes. The artwork, light and grit are native to Fuse. */
export function paintOffroadGround(
  ctx: CanvasRenderingContext2D,
  track: Track,
  terrain: OffroadTerrain,
  theme: StadiumTheme = "classic",
): void {
  const fuse = theme === "fuse";
  const resolution = fuse ? 3 : 1;
  const canvas = ctx.canvas.ownerDocument.createElement("canvas");
  canvas.width = WIDTH * resolution;
  canvas.height = HEIGHT * resolution;
  const pixel = canvas.getContext("2d");
  if (!pixel) return;
  pixel.scale(resolution, resolution);
  const deck = fuse ? deckMaterial(pixel) : "#82430e";
  const footprint = fuse ? new Path2D() : undefined;
  const scaleX = WIDTH / ctx.canvas.width;
  const scaleY = HEIGHT / ctx.canvas.height;
  const project = (x: number, y: number, height: number): Point => {
    const point = projectOffroad(track.name, x, y, height);
    return { x: point.x * scaleX, y: point.y * scaleY };
  };
  pixel.fillStyle = deck;
  pixel.fillRect(0, 0, WIDTH, HEIGHT);
  pixel.lineWidth = 0.7;
  const reachable = raceway(terrain, getOffroadCourse(track.name).spawns[0]!);
  // A hard collision plane can be arbitrarily steep (some vertical faces span forty
  // screen pixels). Only its landward edge is visible above the dirt as a low barrier.
  const edges = new Map<number, { a: Point; b: Point; stripe: boolean }>();
  function outsideEdge(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    a: Point,
    b: Point,
  ) {
    const first = (ay / 128) * 89 + ax / 128;
    const second = (by / 128) * 89 + bx / 128;
    const key = Math.min(first, second) * 8192 + Math.max(first, second);
    if (!edges.delete(key))
      edges.set(key, {
        a,
        b,
        stripe: Math.floor((ax + bx + ay + by) / 512) % 3 !== 0,
      });
  }
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const x = col * CELL;
      const y = row * CELL;
      const center = terrain.sample(x + 128, y + 128)!;
      const mid = project(x + 128, y + 128, center.height);
      for (const [face, [a, b]] of EDGES.entries()) {
        const sample = terrain.sample(
          x + (a[0] + b[0] + 256) / 4,
          y + (a[1] + b[1] + 256) / 4,
        )!;
        if (sample.blocked) continue;
        const corner = ([dx, dy]: readonly [number, number]) =>
          project(
            x + dx,
            y + dy,
            center.height +
              (dx - 128) * sample.slopeX +
              (dy - 128) * sample.slopeY,
          );
        const p = corner(a);
        const q = corner(b);
        const onCourse = !!reachable[(row * GRID + col) * 4 + face];
        if (onCourse) {
          footprint?.moveTo(mid.x, mid.y);
          footprint?.lineTo(p.x, p.y);
          footprint?.lineTo(q.x, q.y);
          footprint?.closePath();
          outsideEdge(x + a[0], y + a[1], x + b[0], y + b[1], p, q);
          outsideEdge(x + 128, y + 128, x + a[0], y + a[1], mid, p);
          outsideEdge(x + 128, y + 128, x + b[0], y + b[1], mid, q);
        }
        pixel.fillStyle = pixel.strokeStyle = fuse
          ? onCourse || sample.kind === 2
            ? floodlitFacet(sample, onCourse)
            : deck
          : paintFacet(sample);
        pixel.beginPath();
        pixel.moveTo(mid.x, mid.y);
        pixel.lineTo(p.x, p.y);
        pixel.lineTo(q.x, q.y);
        pixel.closePath();
        pixel.stroke();
        pixel.fill();
      }
    }
  }
  if (footprint) {
    furnishStadium(pixel, footprint);
    markFuseTrack(pixel, footprint, track, scaleX, scaleY);
    finishFuseMaterials(pixel);
    drawFuseRails(pixel, [...edges.values()]);
  } else {
    // A sparse one-pixel dither gives flat dirt a surface without obscuring the shading on jumps.
    const dirt = pixel.getImageData(0, 0, WIDTH, HEIGHT);
    let noise = 417;
    for (let i = 0; i < dirt.data.length; i += 4) {
      noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
      const grain = noise >>> 28;
      if (grain > 2) continue;
      const delta = grain === 0 ? 18 : -15;
      dirt.data[i] = dirt.data[i]! + delta;
      dirt.data[i + 1] = dirt.data[i + 1]! + delta;
      dirt.data[i + 2] = dirt.data[i + 2]! + delta / 2;
    }
    pixel.putImageData(dirt, 0, 0);
    pixel.lineCap = "round";
    for (const offset of [0, -2]) {
      for (const line of edges.values()) {
        pixel.strokeStyle =
          offset === 0 ? "#602508" : line.stripe ? "#c93715" : "#f5d8aa";
        pixel.lineWidth = offset === 0 ? 2.8 : 2;
        pixel.beginPath();
        pixel.moveTo(line.a.x, line.a.y + offset);
        pixel.lineTo(line.b.x, line.b.y + offset);
        pixel.stroke();
      }
    }
  }
  const finish = track.checkpoints.at(-1)!;
  const dx = (finish.b.x - finish.a.x) * scaleX;
  const dy = (finish.b.y - finish.a.y) * scaleY;
  const length = Math.hypot(dx, dy);
  pixel.save();
  pixel.translate(finish.a.x * scaleX, finish.a.y * scaleY);
  pixel.rotate(Math.atan2(dy, dx));
  if (fuse) {
    pixel.fillStyle = "#192134";
    pixel.fillRect(-1, -3, length + 2, 6);
    pixel.fillStyle = "#ffe76a";
    pixel.fillRect(-1, -3, length + 2, 0.6);
    pixel.fillRect(-1, 2.4, length + 2, 0.6);
  }
  for (let d = 0; d < length; d += 2) {
    for (let row = 0; row < 2; row++) {
      pixel.fillStyle = (d / 2 + row) % 2 ? "#f9ecd2" : "#282025";
      pixel.fillRect(d, row * 2 - 2, Math.min(2, length - d), 2);
    }
  }
  pixel.restore();
  ctx.imageSmoothingEnabled = fuse;
  ctx.drawImage(canvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
}
