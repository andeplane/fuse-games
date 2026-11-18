import { config } from "../sim/config.js";
import type { Point, Track, Wall } from "../sim/track.js";
import routes from "./courses-data.json" with { type: "json" };
import { getOffroadTerrain } from "./courses.js";

const UNIT = 256;
const WIDTH = 44 * UNIT;
const SCREEN_X = config.world.width / 320;
const SCREEN_Y = (config.world.height - 4) / 200;
const HORIZONTAL_SHEAR = 0x5555 / 65536 / 32;
const VERTICAL_SCALE = 0x471 / 65536;

export const OFFROAD_COURSE_NAMES = Object.freeze(
  routes.map(
    (_, index) => `offroad-${(index % 8) + 1}${index >= 8 ? "-reverse" : ""}`,
  ),
);

export function isOffroadCourse(name: string): boolean {
  return OFFROAD_COURSE_NAMES.includes(name);
}

function route(name: string) {
  const found = routes[OFFROAD_COURSE_NAMES.indexOf(name)];
  if (!found) throw new RangeError(`Unknown offroad course: ${name}`);
  return found;
}

/** Continuous version of GAME.EXE file 0x1a5f's ground projection, preserving subpixel motion. */
export function projectOffroad(
  name: string,
  x: number,
  y: number,
  height: number,
): Point {
  const offset = route(name).offset;
  return {
    x: (x / 32 + (WIDTH - y) * HORIZONTAL_SHEAR + offset[0]!) * SCREEN_X,
    y: (y * VERTICAL_SCALE + 128 - height / UNIT + offset[1]!) * SCREEN_Y,
  };
}

export function unprojectOffroad(
  name: string,
  point: Point,
  height: number,
): Point {
  const offset = route(name).offset;
  const y =
    (point.y / SCREEN_Y - offset[1]! - 128 + height / UNIT) / VERTICAL_SCALE;
  return {
    x: (point.x / SCREEN_X - offset[0]! - (WIDTH - y) * HORIZONTAL_SHEAR) * 32,
    y,
  };
}

export interface OffroadRegion {
  left: number;
  right: number;
  top: number;
  bottom: number;
  start: number;
  span: number;
  direction: number;
}

const OCTANT_LIMITS = [4, 5, 6, 8, 11, 17, 26, 81];

/** Original angular approximation at file 0x27e2, for the nonnegative sector coordinates in lap regions. */
function regionAngle(x: number, y: number): number {
  const ratio = Math.floor((4 * Math.max(x, y)) / Math.max(1, Math.min(x, y)));
  const bin = OCTANT_LIMITS.findIndex((limit) => ratio <= limit);
  const octant = bin < 0 ? 0 : 8 - bin;
  return 2 * (x < y ? 16 - octant : octant);
}

/** File 0x23dc chooses one of four straight and eight corner progress rules. */
export function nativeRegionProgress(
  region: OffroadRegion,
  x: number,
  y: number,
): number | null {
  if (!nativeRegionContains(region, x, y)) return null;
  const col = Math.floor(x / UNIT),
    row = Math.floor(y / UNIT);
  const east = col - region.left,
    south = region.bottom - row,
    west = region.right - col,
    north = row - region.top;
  const straight = [east, south, west, north];
  if (region.direction < 4) return region.start + straight[region.direction]!;
  const branch = (region.direction - 4) % 4;
  const reverse = region.direction >= 8;
  const axis = straight[(reverse ? 5 - branch : branch + 3) % 4]!;
  const other = straight[(reverse ? 4 - branch : branch) % 4]!;
  return region.start + ((regionAngle(axis, other) * region.span) >> 6);
}

/** The original tests integer cell coordinates; its X upper bound is open, its Y upper bound inclusive. */
export function nativeRegionContains(
  region: OffroadRegion,
  x: number,
  y: number,
): boolean {
  const col = Math.floor(x / UNIT);
  const row = Math.floor(y / UNIT);
  return (
    col >= region.left &&
    col < region.right &&
    row >= region.top &&
    row <= region.bottom
  );
}

type Terrain = NonNullable<ReturnType<typeof getOffroadTerrain>>;

export interface OffroadCourse {
  track: Track;
  terrain: Terrain;
  regions: OffroadRegion[];
  lapDistance: number;
  spawns: (Point & { height: number; heading: number })[];
  waypoints: Point[];
  /** The next region a truck on the reference line is targeting at each waypoint. */
  waypointRegion: number[];
}

/** Remove internal edges of the four triangular surface sectors in each cell. */
function boundaryWalls(terrain: Terrain, project: (p: Point) => Point): Wall[] {
  const edges = new Map<number, [Point, Point]>();
  // Corners and centers sit on a 89×89 half-cell lattice.
  const keyOf = (p: Point) => (p.y / 128) * 89 + p.x / 128;
  function toggle(a: Point, b: Point) {
    const aKey = keyOf(a),
      bKey = keyOf(b);
    const key = Math.min(aKey, bKey) * 8192 + Math.max(aKey, bKey);
    if (!edges.delete(key)) edges.set(key, [a, b]);
  }
  for (let y = 0; y < WIDTH; y += UNIT) {
    for (let x = 0; x < WIDTH; x += UNIT) {
      const center = { x: x + 128, y: y + 128 };
      const corners = [
        { x, y },
        { x: x + UNIT, y },
        { x: x + UNIT, y: y + UNIT },
        { x, y: y + UNIT },
      ];
      for (let i = 0; i < 4; i++) {
        const a = corners[i]!,
          b = corners[(i + 1) % 4]!;
        const sample = terrain.sample(
          Math.floor((center.x + a.x + b.x) / 3),
          Math.floor((center.y + a.y + b.y) / 3),
        );
        if (!sample || sample.blocked) continue;
        toggle(a, b);
        toggle(b, center);
        toggle(center, a);
      }
    }
  }
  return Array.from(edges.values(), ([start, end]) => {
    const a = project(start),
      b = project(end);
    return {
      a,
      b,
      minX: Math.min(a.x, b.x),
      maxX: Math.max(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxY: Math.max(a.y, b.y),
    };
  });
}

function makeCourse(name: string): OffroadCourse {
  const data = route(name),
    terrain = getOffroadTerrain(name);
  if (!terrain) throw new Error(`Missing offroad terrain for ${name}`);
  const ground = (p: Point) => {
    const height =
      terrain.sample(Math.min(p.x, WIDTH - 1), Math.min(p.y, WIDTH - 1))
        ?.height ?? data.height;
    return projectOffroad(name, p.x, p.y, height);
  };
  const waypoints = data.line.map(([x, y]) => ({ x: x! * UNIT, y: y! * UNIT }));
  const waypointRegion = data.line.map((row) => row[2]!);
  const regions = data.regions.map(
    ([left, right, top, bottom, start, span, direction]) => ({
      left: left!,
      right: right!,
      top: top!,
      bottom: bottom!,
      start: start!,
      span: span!,
      direction: direction!,
    }),
  );
  const spawns = data.grid.map(([x, y], slot) => ({
    x: x!,
    y: y!,
    height:
      slot === 4
        ? (terrain.sample(x!, y!)?.height ?? data.height)
        : data.height,
    heading: data.heading,
  }));
  // Rectangles own race progress. The shared renderer needs a line, so show the
  // narrower dimension as the crossing axis on the approach to each rectangle.
  const checkpoints = regions.map((r) => {
    const l = r.left * UNIT,
      h = r.right * UNIT,
      t = r.top * UNIT,
      b = Math.min(WIDTH, (r.bottom + 1) * UNIT);
    const x = (l + h) / 2,
      y = (t + b) / 2;
    const vertical = h - l < b - t;
    const a = ground(vertical ? { x, y: t } : { x: l, y }),
      end = ground(vertical ? { x, y: b } : { x: h, y });
    return { a, b: end, mid: { x: (a.x + end.x) / 2, y: (a.y + end.y) / 2 } };
  });
  const cols = config.world.width / config.tile,
    rows = (config.world.height - 4) / config.tile;
  const track: Track = {
    name,
    cols,
    rows,
    tile: config.tile,
    surface: Array.from({ length: cols * rows }, () => "dirt"),
    walls: boundaryWalls(terrain, ground),
    checkpoints,
    spawns: spawns.map((p) => ({
      ...projectOffroad(name, p.x, p.y, p.height),
      heading: p.heading === 0 ? 0 : Math.PI,
    })),
    waypoints: waypoints.map(ground),
    items: [],
    bridges: [],
  };
  return {
    track,
    terrain,
    spawns,
    waypoints,
    waypointRegion,
    regions,
    lapDistance: regions[regions.length - 1]!.start,
  };
}

const courses = new Map<string, OffroadCourse>();

export function getOffroadCourse(name: string): OffroadCourse {
  let course = courses.get(name);
  if (!course) {
    course = makeCourse(name);
    courses.set(name, course);
  }
  return course;
}
