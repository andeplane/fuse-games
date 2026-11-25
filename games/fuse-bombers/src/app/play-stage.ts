import { createPlayScreen, type PlayMode, type PlayScreen } from "fuse-ui";

export interface BombersPlayScreenOptions {
  /** `#app`, where Phaser draws the arena: it already covers the window, and becomes the stage during play. */
  stage: HTMLElement;
  /**
   * What is drawn over the arena (the round's overlay `#screen`, the touch pads, the round's controls card): it rides on
   * the stage while that is the screen, so it turns with the arena, and goes back where it was after.
   */
  riders: readonly (HTMLElement | undefined)[];
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
  return createPlayScreen({
    stage: options.stage,
    wide: true,
    onChange: (mode) => {
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
}
