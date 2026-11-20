import { createAttractGame } from "fuse-netcode";
import { demoCanvas } from "fuse-ui";
import { DEFAULT_SETTINGS, fuserodGame } from "../game/index.js";
import { drawScene } from "../art/scenes.js";
import { paintRace } from "./race-screen.js";
export function createAttract(host: HTMLElement) {
  const canvas = demoCanvas(host);
  const game = createAttractGame(
    fuserodGame,
    { ...DEFAULT_SETTINGS, route: "canyon", variant: "duel" },
    { bots: 2 },
  );
  return {
    tick: game.tick,
    advance: game.advance,
    render() {
      const frame = game.view();
      if (frame.tick < 155) {
        drawScene(canvas, "title", { showTitle: false });
        return;
      }
      paintRace(canvas, frame, frame.racers[0]?.id ?? "");
    },
    dispose() {
      canvas.remove();
    },
  };
}
