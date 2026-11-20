import { boxOf, boxesOf, type Box } from "./arena-geometry.js";
import type { MapDef, Mover, Pt } from "./maps.js";
import { SUB, wrap } from "./math.js";

/** How far along its travel a mover is on `step`, out of `of`: out, a wait, back, a wait. */
function along(mover: Mover, step: number): { at: number; of: number } {
  const half = mover.period / 2,
    of = half - mover.dwell,
    phase = wrap(step, mover.period),
    gone = phase < half ? phase : phase - half,
    moved = gone < of ? gone : of;
  return { at: phase < half ? moved : of - moved, of };
}

/**
 * How far a mover is from where it is written down on micro-step `step`, in sub-units: out along `travel`, a wait,
 * and back. Whole numbers in, whole numbers out, and a mirrored mover is mirrored.
 */
export function moverOffset(mover: Mover, step: number): Pt {
  const { at, of } = along(mover, step),
    // Truncated toward zero either way, so a travel of −n is the mirror image of a travel of n.
    out = (pixels: number) => Math.trunc((pixels * SUB * at) / of) + 0;
  return { x: out(mover.travel.x), y: out(mover.travel.y) };
}
/**
 * Where a mover's top left corner is on step `step`, in pixels, for whoever draws it: `step` may be a fraction
 * between two steps, and the answer is one too. The rules never read this.
 */
export function moverPlace(mover: Mover, step: number): Pt {
  const { at, of } = along(mover, step);
  return {
    x: mover.x + (mover.travel.x * at) / of,
    y: mover.y + (mover.travel.y * at) / of,
  };
}
/** A mover as a box where it is on micro-step `step`. */
export function moverBoxAt(mover: Mover, step: number): Box {
  const box = boxOf(mover),
    off = moverOffset(mover, step);
  return { ...box, cx: box.cx + off.x, cy: box.cy + off.y };
}
/**
 * Where the movers are comes round again every so often, so it is worked out once per place in that round and kept:
 * a memo keyed by the arena, which holds nothing alive. A map whose movers keep different periods has no short round
 * and is worked out afresh each time.
 */
interface Round {
  period: number;
  movers: (readonly Box[] | undefined)[];
  all: (readonly Box[] | undefined)[];
}
const ROUNDS = new WeakMap<MapDef, Round>();
function roundOf(map: MapDef): Round {
  let round = ROUNDS.get(map);
  if (!round) {
    const period = map.movers[0]?.period ?? 0,
      shared =
        Number.isInteger(period) &&
        period > 0 &&
        period <= 3600 &&
        map.movers.every((mover) => mover.period === period);
    ROUNDS.set(
      map,
      (round = { period: shared ? period : 0, movers: [], all: [] }),
    );
  }
  return round;
}
const projectMovers = (map: MapDef, step: number): Box[] =>
  map.movers.map((mover) => moverBoxAt(mover, step));

/** The map's movers as boxes where they are on micro-step `step`, in the order of `MapDef.movers`. */
export function moverBoxesAt(map: MapDef, step: number): readonly Box[] {
  const round = roundOf(map);
  if (!round.period) return projectMovers(map, step);
  return (round.movers[wrap(step, round.period)] ??= projectMovers(map, step));
}

/**
 * Everything solid on micro-step `step`: the map's solids, then its movers where they are then. With no movers it
 * is the solids themselves.
 */
export function boxesAt(map: MapDef, step: number): readonly Box[] {
  if (map.movers.length === 0) return boxesOf(map);
  const round = roundOf(map);
  if (!round.period) return [...boxesOf(map), ...projectMovers(map, step)];
  const phase = wrap(step, round.period);
  return (round.all[phase] ??= [
    ...boxesOf(map),
    ...(round.movers[phase] ??= projectMovers(map, step)),
  ]);
}
