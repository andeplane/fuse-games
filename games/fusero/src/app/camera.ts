import type { PhysicsWorm } from "../engine/classic/physics-types.js";

export interface CameraWorld {
  terrain: { width: number; height: number };
  worms: readonly (Pick<
    PhysicsWorm,
    "id" | "x" | "y" | "vx" | "aim" | "facing"
  > & { spawnedOnce?: boolean })[];
}

export interface Camera {
  x: number;
  y: number;
  width: number;
  height: number;
  overview: boolean;
}

/** A camera changes presentation only: each player follows their own worm; TVs and spectators see the map. */
export function cameraFor(
  world: CameraWorld,
  self: string,
  narrow: boolean,
  touchControls = false,
): Camera {
  const worm = world.worms.find((worm) => worm.id === self);
  const { width: worldWidth, height: worldHeight } = world.terrain;
  if (!worm)
    return {
      x: 0,
      y: 0,
      width: worldWidth,
      height: worldHeight,
      overview: true,
    };
  // CViewport::Setup halves display dimensions; FOLLOW centres the worm without aim/velocity lead.
  const width = Math.min(worldWidth, narrow ? 192 : 320),
    height = Math.min(worldHeight, narrow ? 144 : 180);
  const x = worm.x - width / 2;
  const y = worm.y - height / 2;
  if (touchControls)
    return {
      x: Math.trunc(worm.spawnedOnce === false ? (worldWidth - width) / 2 : x),
      y: Math.trunc(
        worm.spawnedOnce === false ? (worldHeight - height) / 2 : y,
      ),
      width,
      height,
      overview: false,
    };
  return {
    x: Math.trunc(Math.max(0, Math.min(worldWidth - width, x))),
    y: Math.trunc(Math.max(0, Math.min(worldHeight - height, y))),
    width,
    height,
    overview: false,
  };
}
