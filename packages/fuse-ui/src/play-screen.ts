/**
 * A phone's full-screen play: while a round is live the game's stage is the whole screen, the top bar shrinks to its
 * menu button and the page cannot scroll. A stage that is wider than tall and cannot reflow is drawn turned a quarter
 * on an upright phone, so it fills the screen for a player who holds the phone on its side, rotation lock or not.
 *
 * The game says when a round is live (`update`) and which element is its stage; this decides whether the device is a
 * phone and which way it is held, and publishes the answer as `data-fui-play` on the document's root for the styles in
 * `play-screen.css` and for the game's own. Lobbies, results and desktops are left as the page laid them out.
 */

/** `phone`: the stage fills the screen as held. `turned`: it fills it drawn a quarter turn clockwise. */
export type PlayMode = "off" | "phone" | "turned";

/** Uniformly fit the whole board and center it in the stage's unturned coordinates. */
export function fitPlayViewport(
  width: number,
  height: number,
  worldWidth: number,
  worldHeight: number,
): { scale: number; x: number; y: number } {
  const scale = Math.min(width / worldWidth, height / worldHeight);
  return {
    scale,
    x: (width - worldWidth * scale) / 2,
    y: (height - worldHeight * scale) / 2,
  };
}

/** What the layout needs to know about the device; the page adapts a window, a test supplies a fake. */
export interface PlayScreenDevice {
  /** The primary pointer is a finger. */
  touch(): boolean;
  size(): { width: number; height: number };
  /** Hears every change of size or orientation until the function returned is called. */
  onResize(listener: () => void): () => void;
  /**
   * Holds the screen on its side, where the browser allows it (Android, in full screen); `false` lets it turn again.
   * Optional: a refusal changes nothing, the turned drawing covers an upright phone.
   */
  lockLandscape?(lock: boolean): void;
}

export interface PlayScreenOptions {
  /** The playfield and everything drawn over it (touch controls, HUD). It becomes the screen during play. */
  stage: HTMLElement;
  /**
   * The playfield is wider than tall and cannot reflow: an upright phone draws it turned. Leave it out for a
   * playfield that fills any shape (a scrolling camera, a board that reflows).
   */
  wide?: boolean;
  device?: PlayScreenDevice;
  /** A new mode: cancel held input, since the controls have just moved under the thumbs. */
  onChange?: (mode: PlayMode) => void;
}

export interface PlayScreen {
  /** A round is live (or no longer is). */
  update(playing: boolean): void;
  mode(): PlayMode;
  destroy(): void;
}

/** The shorter side of the largest screen treated as a phone, in CSS pixels. */
export const PHONE_SHORT_SIDE = 540;
const STAGE_CLASS = "fui-play-stage";

export function browserPlayDevice(win: Window): PlayScreenDevice {
  return {
    // A window without media queries (a bare DOM) is not a phone.
    touch: () => win.matchMedia?.("(pointer: coarse)").matches ?? false,
    size: () => ({ width: win.innerWidth, height: win.innerHeight }),
    lockLandscape(lock) {
      const orientation = win.screen?.orientation as
        | (ScreenOrientation & { lock?: (to: string) => Promise<void> })
        | undefined;
      try {
        if (lock) orientation?.lock?.("landscape").catch(() => undefined);
        else orientation?.unlock?.();
      } catch {
        /* not supported here */
      }
    },
    onResize(listener) {
      const targets: [EventTarget | null | undefined, string][] = [
        [win, "resize"],
        [win, "orientationchange"],
        [win.visualViewport, "resize"],
      ];
      for (const [target, type] of targets)
        target?.addEventListener(type, listener);
      return () => {
        for (const [target, type] of targets)
          target?.removeEventListener(type, listener);
      };
    },
  };
}

/** The mode a device of this shape plays in. */
export function playModeFor(
  playing: boolean,
  wide: boolean,
  touch: boolean,
  size: { width: number; height: number },
): PlayMode {
  if (!playing || !touch) return "off";
  if (Math.min(size.width, size.height) > PHONE_SHORT_SIDE) return "off";
  return wide && size.height > size.width ? "turned" : "phone";
}

export function createPlayScreen(options: PlayScreenOptions): PlayScreen {
  const { stage } = options;
  const doc = stage.ownerDocument;
  const root = doc.documentElement;
  const device =
    options.device ??
    (doc.defaultView ? browserPlayDevice(doc.defaultView) : undefined);
  let playing = false,
    mode: PlayMode = "off";
  const apply = () => {
    const next = device
      ? playModeFor(playing, !!options.wide, device.touch(), device.size())
      : "off";
    if (next === mode) return;
    mode = next;
    if (mode === "off") {
      delete root.dataset.fuiPlay;
      stage.classList.remove(STAGE_CLASS);
    } else {
      root.dataset.fuiPlay = mode;
      stage.classList.add(STAGE_CLASS);
    }
    // A wide stage plays on its side: hold the screen there for the round, where the browser lets a page do that.
    if (options.wide) device?.lockLandscape?.(mode !== "off");
    options.onChange?.(mode);
  };
  const stop = device?.onResize(apply);
  return {
    update(next) {
      playing = next;
      apply();
    },
    mode: () => mode,
    destroy() {
      stop?.();
      playing = false;
      apply();
    },
  };
}

/** A point in an element's own box, whichever way the stage is drawn. */
export interface LocalPoint {
  x: number;
  y: number;
  /** The element's size along its own axes. */
  width: number;
  height: number;
}

/** The element sits in a stage that is drawn turned right now. */
export function isTurned(element: Element): boolean {
  return (
    element.ownerDocument.documentElement.dataset.fuiPlay === "turned" &&
    !!element.closest(`.${STAGE_CLASS}`)
  );
}

/**
 * A screen point inside a box on the screen, along the axes of the element the box belongs to. Turned, the element's
 * x runs down the screen and its y runs right to left.
 */
export function pointInBox(
  box: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  turned: boolean,
): LocalPoint {
  return turned
    ? {
        x: clientY - box.top,
        y: box.left + box.width - clientX,
        width: box.height,
        height: box.width,
      }
    : {
        x: clientX - box.left,
        y: clientY - box.top,
        width: box.width,
        height: box.height,
      };
}

/** Where a pointer is inside `element`, along the element's own axes, whichever way its stage is drawn. */
export function localPoint(
  element: Element,
  clientX: number,
  clientY: number,
): LocalPoint {
  return pointInBox(
    element.getBoundingClientRect(),
    clientX,
    clientY,
    isTurned(element),
  );
}

/** A box in the frame of the stage: left/right along its own x, top/bottom along its own y. */
export interface StageBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Turns a box measured on the screen into the stage's own frame. Turned a quarter clockwise, the stage's x runs down
 * the screen and its y runs from the screen's right edge (`viewportWidth`) leftwards. Straight, the box is unchanged.
 */
export function boxInStage(
  box: StageBox,
  turned: boolean,
  viewportWidth: number,
): StageBox {
  return turned
    ? {
        left: box.top,
        right: box.bottom,
        top: viewportWidth - box.right,
        bottom: viewportWidth - box.left,
      }
    : {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
      };
}

/** `element`'s box in its stage's frame, so differences between boxes measured this way hold whichever way it is drawn. */
export function stageBox(element: Element): StageBox {
  return boxInStage(
    element.getBoundingClientRect(),
    isTurned(element),
    element.ownerDocument.defaultView?.innerWidth ?? 0,
  );
}
