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
  const own = alive.find((actor) => actor.seat === me);
  // A knocked-out operator spectates the survivors. A TV keeps the whole squad in frame.
  return own ? [own] : alive.length ? alive : squad;
}

function origin(center: number, span: number, extent: number): number {
  if (span > extent) return (extent - span) / 2;
  return Math.min(extent - span, Math.max(0, center - span / 2));
}

export function frameCamera(
  world: MissionState,
  party: readonly Point[],
  width: number,
  height: number,
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
    width / Math.max(150, xmax - xmin + 66),
    height / Math.max(134, ymax - ymin + 58),
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
