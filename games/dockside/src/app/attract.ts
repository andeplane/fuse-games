import { createAttractGame } from "fuse-netcode";
import { docksideGame, DEFAULT_SETTINGS } from "../game/game.js";
import { createArena } from "./arena.js";
export function createAttract(host: HTMLElement) {
  const demo = createAttractGame(docksideGame, DEFAULT_SETTINGS, { bots: 2 });
  const arena = createArena(host, true);
  return {
    advance: demo.advance,
    tick: demo.tick,
    render() {
      const world = demo.view().world;
      if (world) arena.draw(world, -1);
    },
    dispose: () => arena.dispose(),
  };
}
