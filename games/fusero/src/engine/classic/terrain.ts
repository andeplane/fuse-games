/*
 * OpenLieroX CMap terrain operations — altered TypeScript port for Fusero.
 * Source: openlierox/openlierox 0a20c6d0a10ed63b28a15f05c771913c294efbf6,
 * src/common/CMap.cpp:1007–1340,2381; src/game/CMap.h:410–462.
 * Based on Jason Boettcher's work, enhanced by Dark Charlie and Albert Zeyer.
 * Code under LGPL; retain the upstream COPYING.LIB distributed with this port.
 */
import type { PhysicsTerrainPort } from "./physics-types.js";
import {
  GREEN_DIRT_MASK,
  HOLE_MASKS,
  type TerrainMask,
} from "./terrain-masks.js";
import {
  AIR,
  DIRT,
  ROCK,
  CLASSIC_MATERIALS,
  MAX_TERRAIN_DIMENSION,
  MAX_TERRAIN_PIXELS,
  type MaterialIndex,
  type PixelTerrain,
} from "./terrain-types.js";
export * from "./terrain-types.js";

const runLength = (code: number): number => Math.floor((code - 32) / 3) + 1;
const runMaterial = (code: number): MaterialIndex =>
  ((code - 32) % 3) as MaterialIndex;
const runCode = (length: number, material: MaterialIndex): string =>
  String.fromCharCode(32 + (length - 1) * 3 + material);

/** Accumulate canonical runs, including across edited span boundaries. */
function terrainRowWriter(row = "") {
  let previous: MaterialIndex = AIR;
  let length = 0;
  return {
    append(material: MaterialIndex, count: number) {
      if (!count) return;
      if (material === previous) {
        length += count;
      } else {
        if (length) row += runCode(length, previous);
        previous = material;
        length = count;
      }
    },
    finish: () => row + runCode(length, previous),
  };
}

export function encodeTerrainRow(pixels: ArrayLike<number>): string {
  if (
    !Number.isInteger(pixels.length) ||
    pixels.length < 1 ||
    pixels.length > MAX_TERRAIN_DIMENSION
  )
    throw new RangeError("Invalid terrain row width");
  const writer = terrainRowWriter();
  for (let x = 0; x < pixels.length; x++) {
    const material = pixels[x]!;
    if (material !== ROCK && material !== AIR && material !== DIRT)
      throw new RangeError("Invalid Classic material");
    writer.append(material, 1);
  }
  return writer.finish();
}

export function validTerrainRow(row: unknown, width: number): row is string {
  if (!Number.isInteger(width) || width < 1 || width > MAX_TERRAIN_DIMENSION)
    return false;
  if (typeof row !== "string" || row.length < 1 || row.length > width)
    return false;
  let x = 0,
    previous = -1;
  for (let i = 0; i < row.length; i++) {
    const code = row.charCodeAt(i);
    if (code < 32 || code > 32 + (MAX_TERRAIN_DIMENSION - 1) * 3 + DIRT)
      return false;
    const material = runMaterial(code),
      length = runLength(code);
    if (material === previous || x + length > width) return false;
    previous = material;
    x += length;
  }
  return x === width;
}

/** Efficient presentation adapter: one callback per material span, not per pixel. */
export function visitTerrainRow(
  row: string,
  visit: (x: number, length: number, material: MaterialIndex) => void,
): void {
  let x = 0;
  for (let i = 0; i < row.length; i++) {
    const code = row.charCodeAt(i),
      length = runLength(code);
    visit(x, length, runMaterial(code));
    x += length;
  }
}

export function decodeTerrainRow(row: string, width: number): Uint8Array {
  if (!validTerrainRow(row, width))
    throw new RangeError("Invalid encoded terrain row");
  const pixels = new Uint8Array(width);
  visitTerrainRow(row, (x, length, material) =>
    pixels.fill(material, x, x + length),
  );
  return pixels;
}

export function materialAt(
  terrain: PixelTerrain,
  x: number,
  y: number,
): MaterialIndex {
  x = Math.trunc(x);
  y = Math.trunc(y);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= terrain.width ||
    y >= terrain.height
  )
    return ROCK;
  const row = terrain.rows[y]!;
  let end = 0;
  for (let i = 0; i < row.length; i++) {
    const code = row.charCodeAt(i);
    end += runLength(code);
    if (x < end) return runMaterial(code);
  }
  return ROCK;
}

export const solid = (terrain: PixelTerrain, x: number, y: number): boolean =>
  materialAt(terrain, x, y) !== AIR;
export const isRock = (terrain: PixelTerrain, x: number, y: number): boolean =>
  materialAt(terrain, x, y) === ROCK;
export const canHook = solid;

interface RowPaint {
  left: number;
  right: number;
  source?: MaterialIndex;
  replacement: MaterialIndex;
  weight(x: number): number;
}

/** Keep the adjacent prefix run open so it can merge with the first edited span. */
function beginRowEdit(row: string, index: number) {
  const writer = terrainRowWriter(row.slice(0, Math.max(0, index - 1)));
  if (index > 0) {
    const code = row.charCodeAt(index - 1);
    writer.append(runMaterial(code), runLength(code));
  }
  return writer;
}

/** Walk only to the end of the mask and rewrite the runs between the first and last touched columns. */
function paintRow(terrain: PixelTerrain, y: number, paint: RowPaint): number {
  const row = terrain.rows[y]!;
  let writer: ReturnType<typeof terrainRowWriter> | undefined;
  let count = 0;
  let end = 0;
  let index = 0;
  for (; end < paint.right && index < row.length; index++) {
    const code = row.charCodeAt(index);
    const material = runMaterial(code);
    let cursor = end;
    end += runLength(code);
    if (
      material !== paint.replacement &&
      (paint.source === undefined || material === paint.source)
    ) {
      const right = Math.min(end, paint.right);
      for (let x = Math.max(cursor, paint.left); x < right; x++) {
        const weight = paint.weight(x);
        if (!weight) continue;
        writer ??= beginRowEdit(row, index);
        writer.append(material, x - cursor);
        writer.append(paint.replacement, 1);
        cursor = x + 1;
        count += weight;
      }
    }
    writer?.append(material, end - cursor);
  }
  if (!writer) return 0;
  // Merge with the first unchanged suffix run, then keep the rest verbatim.
  if (index < row.length) {
    const code = row.charCodeAt(index++);
    writer.append(runMaterial(code), runLength(code));
  }
  terrain.rows[y] = writer.finish() + row.slice(index);
  return count;
}

export function setMaterial(
  terrain: PixelTerrain,
  x: number,
  y: number,
  material: MaterialIndex,
): boolean {
  x = Math.trunc(x);
  y = Math.trunc(y);
  if (
    x < 0 ||
    y < 0 ||
    x >= terrain.width ||
    y >= terrain.height ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  )
    return false;
  return (
    paintRow(terrain, y, {
      left: x,
      right: x + 1,
      replacement: material,
      weight: () => 1,
    }) > 0
  );
}

function hole(size: number): TerrainMask {
  return HOLE_MASKS[Math.max(0, Math.min(4, Math.trunc(size)))]!;
}

interface MaskPaint {
  origin: "clipped" | "original";
  source: MaterialIndex;
  replacement: MaterialIndex;
  weight(mark: string | undefined): number;
}

const CARVE_DIRT: MaskPaint = {
  origin: "clipped",
  source: DIRT,
  replacement: AIR,
  weight: (mark) => Number(mark === "#"),
};
const PLACE_DIRT: MaskPaint = {
  origin: "original",
  source: AIR,
  replacement: DIRT,
  // CMap.cpp1199 reads the pre-write flag; empty rim pixels increment twice.
  weight: (mark) => (mark === "." ? 0 : mark === "b" ? 2 : 1),
};
const PLACE_GREEN_DIRT: MaskPaint = {
  origin: "original",
  source: AIR,
  replacement: DIRT,
  weight: (mark) => Number(mark !== "."),
};

function paintMask(
  terrain: PixelTerrain,
  mask: TerrainMask,
  origin: { left: number; top: number },
  paint: MaskPaint,
): number {
  const { left, top } = origin;
  const x0 = Math.max(0, left);
  const y0 = Math.max(0, top);
  const x1 = Math.min(terrain.width, left + mask.width);
  const y1 = Math.min(terrain.height, top + mask.height);
  if (x0 >= x1) return 0;
  // Native ClipRefRectWith clips the carve destination but still starts hole_px at 0,0.
  const maskLeft = paint.origin === "clipped" ? x0 : left;
  const maskTop = paint.origin === "clipped" ? y0 : top;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    const maskRow = mask.rows[y - maskTop];
    count += paintRow(terrain, y, {
      left: x0,
      right: x1,
      source: paint.source,
      replacement: paint.replacement,
      weight: (x) => paint.weight(maskRow?.[x - maskLeft]),
    });
  }
  return count;
}

function wrappedStart(start: number, extent: number, halfMask: number): number {
  // The far-edge test goes last in CMap. It wins when both tests match a small map.
  if (start >= extent - halfMask) return start - extent;
  if (start <= halfMask) return start + extent;
  return start;
}

/** Source CarveHole uses pink pixels only, and never removes rock. */
export function carveHole(
  terrain: PixelTerrain,
  size: number,
  cx: number,
  cy: number,
  wrapAround = false,
): number {
  if (!Number.isFinite(size) || !Number.isFinite(cx) || !Number.isFinite(cy))
    return 0;
  const mask = hole(size);
  const halfWidth = Math.floor(mask.width / 2);
  const halfHeight = Math.floor(mask.height / 2);
  const left = Math.trunc(cx) - halfWidth;
  const top = Math.trunc(cy) - halfHeight;
  if (wrapAround) {
    const x = wrappedStart(left, terrain.width, halfWidth);
    const y = wrappedStart(top, terrain.height, halfHeight);
    // Native CarveHole edits the wrapped copy first and counts only the primary copy.
    if (x !== left || y !== top)
      carveHole(terrain, size, x + halfWidth, y + halfHeight);
  }
  return paintMask(terrain, mask, { left, top }, CARVE_DIRT);
}

/** Source PlaceDirt paints the whole nonblack mask, including its brown rim. */
export function placeDirt(
  terrain: PixelTerrain,
  size: number,
  cx: number,
  cy: number,
): number {
  if (!Number.isFinite(size) || !Number.isFinite(cx) || !Number.isFinite(cy))
    return 0;
  return placeMask(terrain, hole(size), cx, cy, PLACE_DIRT);
}

function placeMask(
  terrain: PixelTerrain,
  mask: TerrainMask,
  cx: number,
  cy: number,
  paint: MaskPaint,
): number {
  const left = Math.trunc(cx) - Math.floor(mask.width / 2);
  const top = Math.trunc(cy) - Math.floor(mask.height / 2);
  return paintMask(terrain, mask, { left, top }, paint);
}

export function placeGreenDirt(
  terrain: PixelTerrain,
  cx: number,
  cy: number,
): number {
  return Number.isFinite(cx) && Number.isFinite(cy)
    ? placeMask(terrain, GREEN_DIRT_MASK, cx, cy, PLACE_GREEN_DIRT)
    : 0;
}

export const carveSpawn = (
  terrain: PixelTerrain,
  x: number,
  y: number,
): number => carveHole(terrain, 4, x, y);

export function asPhysicsTerrain(
  terrain: PixelTerrain,
  wrapAround = false,
): PhysicsTerrainPort {
  return {
    width: terrain.width,
    height: terrain.height,
    material: (x, y) => CLASSIC_MATERIALS[materialAt(terrain, x, y)]!,
    carve: (x, y, size) => carveHole(terrain, size, x, y, wrapAround),
  };
}

const SPAWN_HALF_WIDTH = 3;

/** The native spawn clearance is a half-open square, offset −3 through +2. */
export function isGoodSpawnPoint(
  terrain: PixelTerrain,
  x: number,
  y: number,
): boolean {
  const left = Math.trunc(x) - SPAWN_HALF_WIDTH;
  const right = Math.trunc(x) + SPAWN_HALF_WIDTH;
  const top = Math.trunc(y) - SPAWN_HALF_WIDTH;
  const bottom = Math.trunc(y) + SPAWN_HALF_WIDTH;
  if (!(
    left >= 0 &&
    right <= terrain.width &&
    top >= 0 &&
    bottom <= terrain.height
  ))
    return false;
  for (let py = top; py < bottom; py++) {
    const row = terrain.rows[py]!;
    let end = 0;
    for (let index = 0; index < row.length && end < right; index++) {
      const code = row.charCodeAt(index);
      end += runLength(code);
      if (end > left && runMaterial(code) === ROCK) return false;
    }
    if (end < right) return false;
  }
  return true;
}

/** Exactly 1000 native attempts, returning the final candidate even when all fail. */
export function findSpot(
  terrain: PixelTerrain,
  nextFloat: () => number,
): { x: number; y: number } {
  let x = 0,
    y = 0;
  for (let attempt = 0; attempt < 1000; attempt++) {
    x = Math.fround(Math.fround(nextFloat()) * terrain.width);
    y = Math.fround(Math.fround(nextFloat()) * terrain.height);
    if (isGoodSpawnPoint(terrain, x, y)) break;
  }
  return { x, y };
}

function dimensions(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_TERRAIN_DIMENSION &&
    height <= MAX_TERRAIN_DIMENSION &&
    width * height <= MAX_TERRAIN_PIXELS
  );
}

export function uniformTerrain(
  width: number,
  height: number,
  material: MaterialIndex,
): PixelTerrain {
  if (!dimensions(width, height))
    throw new RangeError("Terrain dimensions exceed snapshot budget");
  if (material !== ROCK && material !== AIR && material !== DIRT)
    throw new RangeError("Invalid Classic material");
  return {
    width,
    height,
    rows: Array.from({ length: height }, () => runCode(width, material)),
  };
}

const CAVE_BORDER = 8;

/** Seeded map design is cosmetic content; physical masks/collisions remain the original pixel geometry. */
export function createTerrain(
  seed: number,
  width = 1536,
  height = 864,
): PixelTerrain {
  if (!dimensions(width, height))
    throw new RangeError("Terrain dimensions exceed snapshot budget");
  const rows = Array.from({ length: height }, () =>
    new Uint8Array(width).fill(DIRT),
  );
  let rng = seed >>> 0;
  const random = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const carve = (cx: number, cy: number, rx: number, ry: number) => {
    const left = Math.max(CAVE_BORDER, Math.floor(cx - rx));
    const right = Math.min(width - CAVE_BORDER, cx + rx + 1);
    const top = Math.max(CAVE_BORDER, Math.floor(cy - ry));
    const bottom = Math.min(height - CAVE_BORDER, cy + ry + 1);
    for (let y = top; y < bottom; y++) {
      const row = rows[y]!;
      const distanceY = ((y - cy) / ry) ** 2;
      for (let x = left; x < right; x++)
        if (((x - cx) / rx) ** 2 + distanceY <= 1) row[x] = AIR;
    }
  };
  const depths = [0.16, 0.38, 0.61, 0.84];
  for (const depth of depths) {
    let from = (random() - 0.5) * 36,
      to = (random() - 0.5) * 36;
    for (let x = 12; x < width - 12; x += 8) {
      if ((x - 12) % 128 === 0) {
        from = to;
        to = (random() - 0.5) * 36;
      }
      const bend = from + (to - from) * (((x - 12) % 128) / 128);
      carve(x, height * depth + bend, 36, 38);
    }
  }
  for (const across of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const x = Math.round(width * across),
      top = Math.round(height * depths[0]!),
      bottom = Math.round(height * depths[3]!);
    for (let y = top; y <= bottom; y += 8) carve(x, y, 30, 28);
    for (let y = top + 18, shelf = 0; y < bottom - 10; y += 18, shelf++) {
      const facesRight = shelf % 2 === 1;
      const left = Math.max(0, x + (facesRight ? 11 : -28));
      const right = Math.max(0, Math.min(width, x + (facesRight ? 29 : -10)));
      for (let dy = 0; dy < 3; dy++) rows[y + dy]!.fill(DIRT, left, right);
    }
  }
  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    if (y < CAVE_BORDER || y >= height - CAVE_BORDER) row.fill(ROCK);
    else {
      row.fill(ROCK, 0, CAVE_BORDER);
      row.fill(ROCK, Math.max(0, width - CAVE_BORDER));
    }
  }
  return { width, height, rows: rows.map(encodeTerrainRow) };
}

export function encodeTerrain(terrain: PixelTerrain): PixelTerrain {
  return {
    width: terrain.width,
    height: terrain.height,
    rows: [...terrain.rows],
  };
}

export function decodeTerrain(raw: unknown): PixelTerrain | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).length !== 3 ||
    !["width", "height", "rows"].every((key) => Object.hasOwn(value, key)) ||
    !dimensions(value.width as number, value.height as number) ||
    !Array.isArray(value.rows) ||
    value.rows.length !== value.height ||
    !value.rows.every((row) => validTerrainRow(row, value.width as number))
  )
    return;
  return {
    width: value.width as number,
    height: value.height as number,
    rows: [...value.rows] as string[],
  };
}
