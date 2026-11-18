// Reconstructed from the DOS game's contour builder (GAME.EXE file offset
// 0x229b) and wheel contact lookup (0x1d0a). Coordinates use 256 units/cell.
const SIDE = 44;
const CELL_SIZE = 256;
const WORLD_SIZE = SIDE * CELL_SIZE;
const SLOPE_LIMITS = [
  [18, 37],
  [16, 32],
  [17, 34],
  [16, 32],
  [14, 28],
  [18, 36],
  [16, 30],
  [15, 30],
] as const;

export type OffroadFacet = Omit<OffroadTerrainSample, "height">;

export interface OffroadTerrainSample {
  /** Unsigned 16-bit terrain plane height. Collision overrides it for blocked contacts. */
  readonly height: number;
  readonly blocked: boolean;
  readonly kind: number;
  readonly direction: number;
  readonly slopeX: number;
  readonly slopeY: number;
}

export interface OffroadTerrain {
  /** Returns null outside the grid or for noninteger coordinates. */
  sample(x: number, y: number): OffroadTerrainSample | null;
}

export function decodeOffroadTerrain(
  trackIndex: number,
  contour: Uint8Array,
  quad: Uint8Array,
  poly: Uint8Array,
): OffroadTerrain {
  const limits = SLOPE_LIMITS[trackIndex];
  if (!limits) throw new Error("Invalid Off Road course index");
  if (contour.length !== SIDE * SIDE * 2)
    throw new Error("Invalid contour length");
  if (quad.length % 8 || quad.length > 65536)
    throw new Error("Invalid quad length");
  if (!poly.length || poly.length % 4 || poly.length > 65536)
    throw new Error("Invalid poly length");

  const contours = new DataView(
    contour.buffer,
    contour.byteOffset,
    contour.byteLength,
  );
  const quads = new DataView(quad.buffer, quad.byteOffset, quad.byteLength);
  // Keep a snapshot. Callers may reuse the file buffers after import.
  const polygons = new DataView(Uint8Array.from(poly).buffer);
  const sectors = new Uint16Array(SIDE * SIDE * 4);
  function checkPolygon(offset: number) {
    if (offset % 4 || offset + 4 > poly.length)
      throw new Error("Invalid polygon offset");
  }
  for (let p = 0; p < quad.length; p += 2)
    checkPolygon(quads.getUint16(p, true));
  for (let cell = 0; cell < SIDE * SIDE; cell++) {
    const pointer = contours.getUint16(cell * 2, true);
    if ((pointer & 1) === 0) {
      checkPolygon(pointer);
      sectors.fill(pointer, cell * 4, cell * 4 + 4);
    } else {
      const offset = pointer - 1;
      if (offset % 8 || offset + 8 > quad.length)
        throw new Error("Invalid quad offset");
      for (let i = 0; i < 4; i++)
        sectors[cell * 4 + i] = quads.getUint16(offset + i * 2, true);
    }
  }

  const centers = new Uint8Array(SIDE * SIDE);
  const slope = (cell: number, sector: number, field: number) =>
    polygons.getInt8(sectors[cell * 4 + sector]! + field);
  let rowHeight = 0x8000;
  for (let row = 0; row < SIDE; row++) {
    const first = row * SIDE;
    let height = rowHeight;
    for (let col = 0; col < SIDE; col++) {
      const cell = first + col;
      centers[cell] = height >>> 8;
      if (col + 1 < SIDE)
        height += 128 * (slope(cell, 1, 2) + slope(cell + 1, 2, 2));
    }
    if (row + 1 < SIDE)
      rowHeight -= 128 * (slope(first, 0, 3) + slope(first + SIDE, 3, 3));
  }
  const [bias, limit] = limits;
  const facets: OffroadFacet[] = [];
  for (let p = 0; p < polygons.byteLength; p += 4) {
    const kind = polygons.getUint8(p);
    const slopeX = polygons.getInt8(p + 2);
    const slopeY = polygons.getInt8(p + 3);
    facets.push({
      kind,
      direction: polygons.getUint8(p + 1),
      slopeX,
      slopeY,
      blocked:
        (kind & 128) !== 0 ||
        ((bias + slopeX) & 255) >= limit ||
        ((bias + slopeY) & 255) >= limit,
    });
  }
  return terrainFromFacets(
    centers,
    sectors.map((offset) => offset / 4),
    facets,
  );
}

/** Compose a contact sampler from precomputed grid heights and four facets per cell. */
export function terrainFromFacets(
  centers: Uint8Array,
  sectors: Uint16Array,
  facets: readonly OffroadFacet[],
): OffroadTerrain {
  return {
    sample(x, y) {
      if (
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        x < 0 ||
        y < 0 ||
        x >= WORLD_SIZE ||
        y >= WORLD_SIZE
      )
        return null;
      const cell = (y >>> 8) * SIDE + (x >>> 8);
      const fx = x & 255;
      const fy = y & 255;
      const sector = (fx + fy < 256 ? 2 : 0) + (fx >= fy ? 1 : 0);
      const facet = facets[sectors[cell * 4 + sector]!]!;
      const height =
        ((centers[cell]! << 8) +
          ((fx & 254) - 128) * facet.slopeX +
          ((fy & 254) - 128) * facet.slopeY) &
        65535;
      return { height, ...facet };
    },
  };
}
