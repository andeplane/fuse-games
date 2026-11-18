import type { MissionState } from "../sim/index.js";

export const TILE_W = 16;
export const TILE_H = 12;
export type Actor = MissionState["actors"][number];
type Point = { x: number; y: number };

export interface Camera {
  left: number;
  top: number;
  width: number;
  height: number;
  zoom: number;
}

export function followedActors(world: MissionState, me?: string): Actor[] {
  const squad = world.actors.filter((actor) => actor.seat !== null);
  const alive = squad.filter((actor) => actor.hp > 0);
  const own = squad.find((actor) => actor.seat === me);
  if (own) return [own.hp > 0 ? own : (alive[0] ?? own)];
  return alive.length ? alive : squad;
}

export interface Panel<T extends Point> {
  x: number;
  y: number;
  width: number;
  height: number;
  party: T[];
  localZoom: number;
}

const span = (points: readonly Point[], axis: "x" | "y") => {
  const values = points.map((point) => point[axis]);
  return Math.max(...values) - Math.min(...values);
};

function localScale(width: number, height: number) {
  return Math.min(width / (width > height ? 300 : 150), height / 200);
}

/** GAME.C uses strict 300 × 180 world-pixel bounds for the two DOS seats. For three
 * to six Fuse operators, merge the closest compatible groups while preserving seat
 * order for the final panels. A chain of neighbours cannot join across a larger gap. */
export function cameraPanels<T extends Point>(
  party: readonly T[],
  width: number,
  height: number,
): Panel<T>[] {
  const groups = party.map((operator) => [operator]);
  for (;;) {
    let first = -1,
      second = -1,
      nearest = Infinity;
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const together = [...groups[i]!, ...groups[j]!];
        const dx = span(together, "x"),
          dy = span(together, "y");
        const distance = (dx / 300) ** 2 + (dy / 180) ** 2;
        if (dx < 300 && dy < 180 && distance < nearest) {
          first = i;
          second = j;
          nearest = distance;
        }
      }
    if (first < 0) break;
    groups[first]!.push(...groups[second]!);
    groups.splice(second, 1);
  }
  if (!groups.length) groups.push([]);
  const baseZoom = localScale(width, height);
  const gutter = Math.min(
    width / 8,
    height / 8,
    Math.max(2, Math.round(2 * baseZoom)),
  );
  const rows =
    groups.length <= 2 ? 1 : width >= height ? 2 : Math.ceil(groups.length / 2);
  const result: Panel<T>[] = [];
  const cellHeight = (height - gutter * (rows - 1)) / rows;
  for (let row = 0; row < rows; row++) {
    const cols = Math.ceil((groups.length - result.length) / (rows - row));
    const cellWidth = (width - gutter * (cols - 1)) / cols;
    for (let col = 0; col < cols; col++) {
      result.push({
        party: groups[result.length]!,
        x: col * (cellWidth + gutter),
        y: row * (cellHeight + gutter),
        width: cellWidth,
        height: cellHeight,
        localZoom: Math.min(baseZoom, cellHeight / 200),
      });
    }
  }
  return result;
}

function origin(center: number, span: number, extent: number): number {
  if (span > extent) return (extent - span) / 2;
  return Math.min(extent - span, Math.max(0, center - span / 2));
}

export function frameCamera(
  world: Pick<MissionState, "width" | "height">,
  party: readonly Point[],
  width: number,
  height: number,
  localZoom = localScale(width, height),
): Camera {
  const mapW = world.width * TILE_W;
  const mapH = world.height * TILE_H;
  const xs = party.map((actor) => actor.x);
  const ys = party.map((actor) => actor.y);
  const xmin = xs.length ? Math.min(...xs) : mapW / 2;
  const xmax = xs.length ? Math.max(...xs) : xmin;
  const ymin = ys.length ? Math.min(...ys) : mapH / 2;
  const ymax = ys.length ? Math.max(...ys) : ymin;
  // Keep at least ten tiles across on a portrait phone. A large television opens up sideways.
  const zoom = Math.min(
    localZoom,
    width / (xmax - xmin + 66),
    height / (ymax - ymin + 58),
  );
  const spanX = width / zoom;
  const spanY = height / zoom;
  return {
    left: origin((xmin + xmax) / 2, spanX, mapW),
    top: origin((ymin + ymax) / 2 - 5, spanY, mapH),
    width: spanX,
    height: spanY,
    zoom,
  };
}
