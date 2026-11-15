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

export function encodeTerrainRow(pixels: ArrayLike<number>): string {
  if (
    !Number.isInteger(pixels.length) ||
    pixels.length < 1 ||
    pixels.length > MAX_TERRAIN_DIMENSION
  )
    throw new RangeError("Invalid terrain row width");
  let row = "",
    previous = -1,
    length = 0;
  for (let x = 0; x < pixels.length; x++) {
    const material = pixels[x]!;
    if (material !== ROCK && material !== AIR && material !== DIRT)
      throw new RangeError("Invalid Classic material");
    if (material === previous) length++;
    else {
      if (length) row += runCode(length, previous as MaterialIndex);
      previous = material;
      length = 1;
    }
  }
  return row + runCode(length, previous as MaterialIndex);
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

/** Edit only touched spans. Unchanged rows remain identical strings across checkpoints. */
function editRow(
  terrain: PixelTerrain,
  y: number,
  edits: ReadonlyMap<number, MaterialIndex>,
): void {
  if (!edits.size) return;
  const before = terrain.rows[y]!;
  let out = "",
    previous = -1,
    length = 0;
  const append = (material: MaterialIndex, count: number) => {
    if (!count) return;
    if (material === previous) length += count;
    else {
      if (length) out += runCode(length, previous as MaterialIndex);
      previous = material;
      length = count;
    }
  };
  const changed = [...edits].sort(([a], [b]) => a - b);
  let next = 0;
  visitTerrainRow(before, (start, count, material) => {
    const end = start + count;
    let cursor = start;
    while (next < changed.length && changed[next]![0] < end) {
      const [x, replacement] = changed[next++]!;
      append(material, x - cursor);
      append(replacement, 1);
      cursor = x + 1;
    }
    append(material, end - cursor);
  });
  terrain.rows[y] = out + runCode(length, previous as MaterialIndex);
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
  if (materialAt(terrain, x, y) === material) return false;
  editRow(terrain, y, new Map([[x, material]]));
  return true;
}

function hole(size: number): TerrainMask {
  return HOLE_MASKS[Math.max(0, Math.min(4, Math.trunc(size)))]!;
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
  const mask = hole(size),
    left = Math.trunc(cx) - Math.floor(mask.width / 2),
    top = Math.trunc(cy) - Math.floor(mask.height / 2);
  if (wrapAround) {
    let wrappedX = left,
      wrappedY = top;
    if (left <= Math.floor(mask.width / 2)) wrappedX = left + terrain.width;
    if (left >= terrain.width - Math.floor(mask.width / 2))
      wrappedX = left - terrain.width;
    if (top <= Math.floor(mask.height / 2)) wrappedY = top + terrain.height;
    if (top >= terrain.height - Math.floor(mask.height / 2))
      wrappedY = top - terrain.height;
    if (wrappedX !== left || wrappedY !== top)
      carveHole(
        terrain,
        size,
        wrappedX + Math.floor(mask.width / 2),
        wrappedY + Math.floor(mask.height / 2),
      );
  }
  const x0 = Math.max(0, left),
    y0 = Math.max(0, top),
    x1 = Math.min(terrain.width, left + mask.width),
    y1 = Math.min(terrain.height, top + mask.height);
  let count = 0;
  for (let y = y0; y < y1; y++) {
    const edits = new Map<number, MaterialIndex>();
    // Native ClipRefRectWith clips the destination but starts hole_px at 0,0.
    // Preserve this boundary quirk; PlaceDirt below uses the correctly offset source.
    for (let x = x0; x < x1; x++)
      if (
        mask.rows[y - y0]?.[x - x0] === "#" &&
        materialAt(terrain, x, y) === DIRT
      ) {
        edits.set(x, AIR);
        count++;
      }
    editRow(terrain, y, edits);
  }
  return count;
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
  return placeMask(terrain, hole(size), cx, cy, true);
}

function placeMask(
  terrain: PixelTerrain,
  mask: TerrainMask,
  cx: number,
  cy: number,
  countRimTwice: boolean,
): number {
  const left = Math.trunc(cx) - Math.floor(mask.width / 2),
    top = Math.trunc(cy) - Math.floor(mask.height / 2);
  let count = 0;
  for (let my = 0; my < mask.height; my++) {
    const y = top + my;
    if (y < 0 || y >= terrain.height) continue;
    const edits = new Map<number, MaterialIndex>();
    for (let mx = 0; mx < mask.width; mx++) {
      const x = left + mx,
        value = mask.rows[my]![mx];
      if (
        x < 0 ||
        x >= terrain.width ||
        value === "." ||
        materialAt(terrain, x, y) !== AIR
      )
        continue;
      edits.set(x, DIRT);
      // CMap.cpp1199 reads the pre-write flag; empty rim pixels increment twice.
      count += countRimTwice && value === "b" ? 2 : 1;
    }
    editRow(terrain, y, edits);
  }
  return count;
}

export function placeGreenDirt(
  terrain: PixelTerrain,
  cx: number,
  cy: number,
): number {
  return Number.isFinite(cx) && Number.isFinite(cy)
    ? placeMask(terrain, GREEN_DIRT_MASK, cx, cy, false)
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

/** Source helper bounds are half-open: offsets −3…2, not an inclusive 7×7 box. */
export function isGoodSpawnPoint(
  terrain: PixelTerrain,
  x: number,
  y: number,
): boolean {
  x = Math.trunc(x);
  y = Math.trunc(y);
  for (let dy = -3; dy < 3; dy++)
    for (let dx = -3; dx < 3; dx++)
      if (isRock(terrain, x + dx, y + dy)) return false;
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
    for (
      let y = Math.max(8, Math.floor(cy - ry));
      y < Math.min(height - 8, cy + ry + 1);
      y++
    )
      for (
        let x = Math.max(8, Math.floor(cx - rx));
        x < Math.min(width - 8, cx + rx + 1);
        x++
      )
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) rows[y]![x] = AIR;
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
      const side = shelf % 2 ? 1 : -1;
      for (let dx = 11; dx <= 28; dx++)
        for (let dy = 0; dy < 3; dy++) rows[y + dy]![x + dx * side] = DIRT;
    }
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (x < 8 || y < 8 || x >= width - 8 || y >= height - 8)
        rows[y]![x] = ROCK;
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
