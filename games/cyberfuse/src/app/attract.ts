import { createAttractGame } from "fuse-netcode";
import { demoCanvas } from "fuse-ui";
import { cyberfuseGame, DEFAULT_SETTINGS } from "../game/index.js";
import { createScene } from "../render/index.js";

export function createAttract(host: HTMLElement) {
  const demo = createAttractGame(cyberfuseGame, DEFAULT_SETTINGS, { bots: 2 });
  const canvas = demoCanvas(host);
  const scene = createScene(canvas);
  return {
    advance: demo.advance,
    tick: demo.tick,
    render() {
      const world = demo.view().world;
      if (world) scene.draw(world);
    },
    dispose() {
      scene.dispose();
      canvas.remove();
    },
  };
}
