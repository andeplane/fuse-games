import { VIEW_H, VIEW_W, type MapDef, type Rect } from "../engine/view-kit.js";

/**
 * Where to draw something `reach` pixels across centred on (`x`, `y`): where it is, and again one field over on
 * each wrapping axis whose seam it overlaps, so a body leaving by one edge is already arriving at the other.
 */
type Seams = Pick<MapDef, "wrapX" | "wrapY"> & Partial<Pick<MapDef, "w" | "h">>;
export function copies(
  map: Seams,
  x: number,
  y: number,
  reach: number,
): { x: number; y: number }[] {
  const along = (at: number, size: number, wraps: boolean) => {
    const all = [at];
    if (wraps && at < reach) all.push(at + size);
    if (wraps && at > size - reach) all.push(at - size);
    return all;
  };
  const ys = along(y, map.h ?? VIEW_H, map.wrapY);
  return along(x, map.w ?? VIEW_W, map.wrapX).flatMap((cx) =>
    ys.map((cy) => ({ x: cx, y: cy })),
  );
}

/**
 * Where to draw a solid: where it is, and one field back on each wrapping axis it runs past the end of, so the
 * part over the edge shows at the start.
 */
export function solidCopies(map: Seams, solid: Rect): Rect[] {
  const w = map.w ?? VIEW_W,
    h = map.h ?? VIEW_H,
    xs =
      map.wrapX && solid.x + solid.w > w ? [solid.x, solid.x - w] : [solid.x],
    ys =
      map.wrapY && solid.y + solid.h > h ? [solid.y, solid.y - h] : [solid.y];
  return xs.flatMap((x) => ys.map((y) => ({ ...solid, x, y })));
}
