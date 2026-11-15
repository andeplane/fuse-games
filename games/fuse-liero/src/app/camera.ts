import { WIDTH, HEIGHT, direction, type WorldView } from "../engine/index.js";

export interface Camera {
  x: number;
  y: number;
  width: number;
  height: number;
  overview: boolean;
}

/** A camera changes presentation only: each player follows their own worm; TVs and spectators see the map. */
export function cameraFor(
  world: Pick<WorldView, "worms">,
  self: string,
  narrow: boolean,
): Camera {
  const worm = world.worms.find((worm) => worm.id === self);
  if (!worm)
    return { x: 0, y: 0, width: WIDTH, height: HEIGHT, overview: true };
  const width = narrow ? 384 : 640,
    height = narrow ? 288 : 360;
  const aim = direction(worm.aim);
  const x =
    worm.x + aim.x * 36 + Math.max(-28, Math.min(28, worm.vx * 10)) - width / 2;
  const y = worm.y + aim.y * 24 - height / 2;
  return {
    x: Math.round(Math.max(0, Math.min(WIDTH - width, x))),
    y: Math.round(Math.max(0, Math.min(HEIGHT - height, y))),
    width,
    height,
    overview: false,
  };
}
