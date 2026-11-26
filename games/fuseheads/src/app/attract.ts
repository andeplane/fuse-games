import {
  createWorld,
  stepWorld,
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_JUMP,
} from "../game/simulation.js";
import { createArena } from "../art/renderer.js";

export function createAttract(host: HTMLElement) {
  const canvas = host.ownerDocument.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);
  const arena = createArena(canvas);
  let world = createWorld(0, [0, 1], 42);
  let tick = 0;
  return {
    tick: () => tick,
    advance() {
      if (world.outcome !== "playing") world = createWorld(0, [0, 1], 42);
      const right = tick % 90 < 45;
      const jump = tick % 37 === 0 ? INPUT_JUMP : 0;
      stepWorld(world, [
        (right ? INPUT_RIGHT : INPUT_LEFT) | jump,
        (right ? INPUT_LEFT : INPUT_RIGHT) | jump,
      ]);
      tick++;
    },
    render: () => arena.draw(world),
    dispose: () => canvas.remove(),
  };
}
