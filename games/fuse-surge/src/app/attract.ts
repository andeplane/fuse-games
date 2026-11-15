import { createAttractGame } from "fuse-netcode";
import { fuseSurgeGame, DEFAULT_SETTINGS } from "../online/game.js";
import { BOT_NAMES } from "../online/names.js";
import type { LookId } from "../render/looks.js";
import { createPicture } from "./picture.js";

/** The silent demo behind the menus: four bots on the deck, drawn by the match's own picture in the chosen look. */
export function createAttract(host: HTMLElement, look: LookId) {
  const demo = createAttractGame(fuseSurgeGame, DEFAULT_SETTINGS, { bots: 4 });
  const picture = createPicture(host, {
    look,
    board: false,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  return {
    advance: demo.advance,
    tick: demo.tick,
    render(now: number) {
      const view = demo.view().world;
      if (view) picture.draw(view, now, -1, BOT_NAMES);
    },
    setLook: (id: LookId) => picture.setLook(id),
    dispose: () => picture.destroy(),
  };
}
