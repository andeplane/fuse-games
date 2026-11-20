import { SUB } from "./math.js";
import type { MapDef, Rect } from "./maps.js";

/** A solid as the collision code wants it: centre and half extents, in sub-units. */
export interface Box {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

export const boxOf = (rect: Rect): Box => ({
  // Every rect has even sides, so the centre is a whole number of sub-units.
  cx: (rect.x * SUB * 2 + rect.w * SUB) / 2,
  cy: (rect.y * SUB * 2 + rect.h * SUB) / 2,
  hw: (rect.w * SUB) / 2,
  hh: (rect.h * SUB) / 2,
});
type BoxLayer = "solids" | "barriers" | "ledges";
type BoxLayers = Partial<Record<BoxLayer, readonly Box[]>>;

/** Lazily project each layer once per arena. */
const BOX_LAYERS = new WeakMap<MapDef, BoxLayers>();
function boxLayer(map: MapDef, layer: BoxLayer): readonly Box[] {
  let layers = BOX_LAYERS.get(map);
  if (!layers) BOX_LAYERS.set(map, (layers = {}));
  return (layers[layer] ??= map[layer].map(boxOf));
}

export const boxesOf = (map: MapDef): readonly Box[] => boxLayer(map, "solids");
export const barrierBoxesOf = (map: MapDef): readonly Box[] =>
  boxLayer(map, "barriers");
export const ledgeBoxesOf = (map: MapDef): readonly Box[] =>
  boxLayer(map, "ledges");

/** A liquid's rect in sub-units, where it is and again one field back on each wrapping axis it runs past. */
const zonesOf = (map: MapDef, rects: readonly Rect[]): Rect[] =>
  rects.flatMap((r) => {
    const xs = map.wrapX && r.x + r.w > map.w ? [r.x, r.x - map.w] : [r.x],
      ys = map.wrapY && r.y + r.h > map.h ? [r.y, r.y - map.h] : [r.y];
    return xs.flatMap((x) =>
      ys.map((y) => ({ x: x * SUB, y: y * SUB, w: r.w * SUB, h: r.h * SUB })),
    );
  });
const GOO_ZONES = new WeakMap<MapDef, readonly Rect[]>(),
  STREAM_ZONES = new WeakMap<MapDef, readonly Rect[]>();
/** The map's goo as sub-unit rects, each one in the field. */
export function gooZonesOf(map: MapDef): readonly Rect[] {
  let zones = GOO_ZONES.get(map);
  if (!zones) GOO_ZONES.set(map, (zones = zonesOf(map, map.goo)));
  return zones;
}
/** The map's jets, likewise. */
export function streamZonesOf(map: MapDef): readonly Rect[] {
  let zones = STREAM_ZONES.get(map);
  if (!zones) STREAM_ZONES.set(map, (zones = zonesOf(map, map.streams)));
  return zones;
}
