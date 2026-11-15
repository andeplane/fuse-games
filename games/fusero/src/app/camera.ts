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

export interface CameraViewport {
  width: number;
  height: number;
}

export interface CameraOptions {
  /** Native local games use the display aspect; network play keeps the fair 640-wide logical screen. */
  wideScreen?: boolean;
  touchControls?: boolean;
}

function logicalWidth(viewport: CameraViewport, wideScreen: boolean): number {
  if (!wideScreen) return 640;
  const valid =
    Number.isFinite(viewport.width) &&
    Number.isFinite(viewport.height) &&
    viewport.width > 0 &&
    viewport.height > 0;
  if (!valid) return 640;
  // VideoPostProcessor::initWindow: fixed 480-high surface; round width up to even, minimum 320.
  return Math.max(
    320,
    Math.ceil(Math.round((480 * viewport.width) / viewport.height) / 2) * 2,
  );
}

/** A camera changes presentation only: each player follows their own worm; TVs and spectators see the map. */
export function cameraFor(
  world: CameraWorld,
  self: string,
  viewport: CameraViewport,
  options: CameraOptions = {},
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
  // CClient::SetupViewports supplies h=480, then CViewport::Setup halves both dimensions.
  // FOLLOW uses integer half-width/height; dimensions remain native even when a map is smaller.
  const width = logicalWidth(viewport, options.wideScreen !== false) / 2,
    height = 240;
  const x = worm.x - Math.trunc(width / 2);
  const y = worm.y - Math.trunc(height / 2);
  if (options.touchControls)
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
