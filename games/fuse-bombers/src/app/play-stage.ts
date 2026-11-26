import {
  createPlayScreen,
  fitPlayViewport,
  type PlayMode,
  type PlayScreen,
} from "fuse-ui";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/round-scene.js";

export interface BombersPlayScreenOptions {
  /** `#app`, where Phaser draws the arena: it already covers the window, and becomes the stage during play. */
  stage: HTMLElement;
  /**
   * What is drawn over the arena (the round's overlay `#screen`, the touch pads, the round's controls card): it rides on
   * the stage while that is the screen, so it turns with the arena, and goes back where it was after.
   */
  riders: readonly (HTMLElement | undefined)[];
  resize(width: number, height: number): void;
  /** A new mode: let go of held input, since the pads have just moved under the thumbs. */
  onChange(mode: PlayMode): void;
}

/**
 * Fuse Bombers' full-screen play on a phone (fuse-ui's play screen). The arena is a fixed 16:9 picture, so an upright
 * phone draws it turned. Off, every rider is back in its own place, where screens.css's sibling rules expect it.
 */
export function createBombersPlayScreen(
  options: BombersPlayScreenOptions,
): PlayScreen {
  const homes = new Map<HTMLElement, Comment>();
  let width = VIEW_WIDTH,
    height = VIEW_HEIGHT;
  const fit = (mode: PlayMode) => {
    const { clientWidth, clientHeight } = options.stage;
    if (!clientWidth || !clientHeight) return;
    const scale = fitPlayViewport(
      clientWidth,
      clientHeight,
      VIEW_WIDTH,
      VIEW_HEIGHT,
    ).scale;
    const w = mode === "off" ? VIEW_WIDTH : Math.round(clientWidth / scale),
      h = mode === "off" ? VIEW_HEIGHT : Math.round(clientHeight / scale);
    if (w === width && h === height) return;
    width = w;
    height = h;
    options.resize(w, h);
  };
  const screen = createPlayScreen({
    stage: options.stage,
    wide: true,
    onChange: (mode) => {
      fit(mode);
      for (const rider of options.riders) {
        if (!rider) continue;
        if (mode === "off") {
          homes.get(rider)?.replaceWith(rider);
          homes.delete(rider);
        } else if (!homes.has(rider) && rider.parentNode) {
          const home = rider.ownerDocument.createComment("play-screen");
          rider.replaceWith(home);
          homes.set(rider, home);
          options.stage.append(rider);
        }
      }
      options.onChange(mode);
    },
  });
  const observer = new ResizeObserver(() => fit(screen.mode()));
  observer.observe(options.stage);
  return {
    ...screen,
    destroy() {
      observer.disconnect();
      screen.destroy();
    },
  };
}
