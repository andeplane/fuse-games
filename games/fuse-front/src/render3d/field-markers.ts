import {
  SUB,
  TILE_PX,
  type HeroView,
  type RouteStop,
  type UnitView,
  type WorldView,
} from "../engine/view.js";
import { routeMarks } from "../render/route.js";
import type { Overlay, TargetPulse } from "../render/renderer.js";
import type { Batch } from "./instances.js";
import { standY, type HeightField } from "./terrain.js";

const LANE_DOT = 4;

interface Point {
  x: number;
  y: number;
  z: number;
}

interface Geometry {
  lanes: readonly Point[];
  camps: readonly Point[];
}

type StrategicMap = Pick<
  WorldView,
  "width" | "height" | "lanes" | "camps" | "terrain"
>;

interface GeometryEntry {
  lanes: WorldView["lanes"];
  camps: WorldView["camps"];
  terrain: WorldView["terrain"];
  geometry: Geometry;
}

/** Project static lane and camp coordinates once for each adopted height field. */
export function createStrategicMarkerCache() {
  const fields = new WeakMap<HeightField, GeometryEntry>();
  return (world: StrategicMap, field: HeightField): Geometry => {
    const entry = fields.get(field);
    if (
      entry &&
      entry.lanes === world.lanes &&
      entry.camps === world.camps &&
      entry.terrain === world.terrain
    )
      return entry.geometry;
    const geometry = projectMarkers(world, field);
    fields.set(field, {
      lanes: world.lanes,
      camps: world.camps,
      terrain: world.terrain,
      geometry,
    });
    return geometry;
  };
}

function projectMarkers(world: StrategicMap, field: HeightField): Geometry {
  const point = (x: number, z: number): Point => ({
    x,
    y: standY(world, field, x, z),
    z,
  });
  const lanes: Point[] = [];
  for (const lane of world.lanes) {
    for (let i = 1; i < lane.path.length; i++) {
      const a = lane.path[i - 1]!,
        b = lane.path[i]!;
      const dx = b.x - a.x,
        dz = b.y - a.y;
      const count = Math.max(1, Math.round(Math.hypot(dx, dz) / LANE_DOT));
      for (let j = 0; j < count; j++)
        lanes.push(
          point(a.x + 0.5 + (dx * j) / count, a.y + 0.5 + (dz * j) / count),
        );
    }
  }
  const camps = world.camps.map((camp) => point(camp.x + 0.5, camp.y + 0.5));
  return { lanes, camps };
}

const TILE = SUB * TILE_PX;

interface TargetingFrame {
  world: WorldView;
  field: HeightField;
  t: number;
  self: number;
  now: number;
  overlay: Overlay;
  targetPulse: TargetPulse;
  unitsBefore: ReadonlyMap<number, UnitView>;
  heroesBefore: ReadonlyMap<number, HeroView>;
}

interface MarkerBatches {
  ring: Batch;
  aimRing: Batch;
  aimLine: Batch;
}

interface MarkerColors {
  target: readonly number[];
  route: Record<RouteStop["kind"], readonly number[]>;
}

type ProjectedPoint = readonly [x: number, y: number, z: number];

function appendLine(
  batch: Batch,
  [ax, ay, az]: ProjectedPoint,
  [bx, by, bz]: ProjectedPoint,
  width: number,
  color: readonly number[],
): void {
  const dx = bx - ax,
    dz = bz - az;
  const length = Math.hypot(dx, dz);
  if (length > 0.01)
    batch.push(
      (ax + bx) / 2,
      (ay + by) / 2,
      (az + bz) / 2,
      Math.atan2(dx, dz),
      width,
      1,
      length,
      color,
    );
}

/** Append route and target instances using one terrain projection per required point. */
export function appendTargetMarkers(
  {
    world,
    field,
    t,
    self,
    now,
    overlay,
    targetPulse,
    unitsBefore,
    heroesBefore,
  }: TargetingFrame,
  batches: MarkerBatches,
  colors: MarkerColors,
): void {
  const hero = world.heroes.find((h) => h.seat === self && h.hp > 0);
  const target = hero?.target;
  const pulse = targetPulse.of(target, now);
  if (!hero) return;
  const at = (x: number, z: number): ProjectedPoint => [
    x / TILE,
    standY(world, field, x / TILE, z / TILE),
    z / TILE,
  ];
  const ringAt = ([px, py, pz]: ProjectedPoint, r: number) => {
    batches.aimRing.push(px, py, pz, 0, r / TILE, 1, r / TILE, colors.target);
  };
  const p = heroesBefore.get(hero.seat) ?? hero;
  const hx = p.x + (hero.x - p.x) * t,
    hz = p.y + (hero.y - p.y) * t;
  let projectedHero: ProjectedPoint | undefined;
  const heroPoint = () => (projectedHero ??= at(hx, hz));
  let routeFrom: ProjectedPoint | undefined;
  // The queued route: a leg to each waypoint and its rings, in its kind's colour, dimming along the way.
  for (const m of routeMarks(hero.route, hx, hz)) {
    const colour = colors.route[m.kind].map((c) => c * m.fade);
    // The marker is a solid band (the bodies' ring), its second ring a thin one; the leg is a doubled aim line.
    const point = at(m.x, m.y),
      [px, py, pz] = point,
      [outer, inner] = m.rings;
    batches.ring.push(px, py, pz, 0, outer / TILE, 1, outer / TILE, colour);
    if (inner > 0)
      batches.aimRing.push(
        px,
        py,
        pz,
        0,
        inner / TILE,
        1,
        inner / TILE,
        colour,
      );
    appendLine(batches.aimLine, routeFrom ?? heroPoint(), point, 2, colour);
    routeFrom = point;
  }
  if (overlay.range > 0) ringAt(heroPoint(), overlay.range);
  if (overlay.area > 0 && overlay.cursor)
    ringAt(at(overlay.cursor.x, overlay.cursor.y), overlay.area);
  for (const m of overlay.marks) ringAt(at(m.x, m.y), TILE * 0.55);
  if (!target) return;
  // A moving target is drawn where its body is drawn, between frames.
  const was =
    target.of === "unit"
      ? unitsBefore.get(target.id)
      : target.of === "hero"
        ? heroesBefore.get(target.id)
        : undefined;
  const tx = was ? was.x + (target.x - was.x) * t : target.x,
    tz = was ? was.y + (target.y - was.y) * t : target.y;
  const targetPoint = at(tx, tz);
  ringAt(targetPoint, TILE * (target.chosen ? 0.7 : 0.55) * (1 + pulse * 0.8));
  if (target.chosen) ringAt(targetPoint, TILE * 0.85 * (1 + pulse * 0.8));
  appendLine(batches.aimLine, heroPoint(), targetPoint, 1, colors.target);
}
